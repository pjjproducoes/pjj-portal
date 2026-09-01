import type { Env } from './env';
import type { Principal } from './auth';
import { audit } from './audit';
import { copyDriveFile, ensureFolder, privateDriveFileInfo, streamFile, trashDriveFile } from './drive';
import { error, json, readJson } from './http';

const VARIANTS:Record<string,{assetTypes:string[];format:string;mimeType:string}>={
  cog:{assetTypes:['orthophoto','dsm','dtm'],format:'tif',mimeType:'image/tiff'},
  optimized_glb:{assetTypes:['model_3d'],format:'glb',mimeType:'model/gltf-binary'},
  copc:{assetTypes:['point_cloud'],format:'copc.laz',mimeType:'application/vnd.laszip+binary'}
};

export function driveFileId(value:unknown):string|null{
  const raw=typeof value==='string'?value.trim():'';
  if(/^[A-Za-z0-9_-]{10,200}$/.test(raw))return raw;
  try{
    const url=new URL(raw),fromQuery=url.searchParams.get('id'),fromPath=url.pathname.match(/\/(?:d|file\/d)\/([A-Za-z0-9_-]{10,200})(?:\/|$)/)?.[1];
    const id=fromQuery||fromPath;return id&&/^[A-Za-z0-9_-]{10,200}$/.test(id)?id:null;
  }catch{return null}
}

async function prefix(env:Env,fileId:string,max=128*1024):Promise<Uint8Array>{
  const response=await streamFile(env,fileId,`bytes=0-${max-1}`);
  if(!response.ok&&response.status!==206)throw new Error(`drive_prefix_${response.status}`);
  if(!response.body)return new Uint8Array();
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let total=0;
  while(total<max){const {done,value}=await reader.read();if(done)break;if(!value)continue;const take=value.slice(0,Math.min(value.byteLength,max-total));parts.push(take);total+=take.byteLength;if(take.byteLength<value.byteLength)break}
  await reader.cancel().catch(()=>{});const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}return bytes;
}

function validSignature(type:string,name:string,bytes:Uint8Array):boolean{
  const lower=name.toLowerCase(),ascii=new TextDecoder('latin1').decode(bytes);
  if(type==='cog')return /\.tiff?$/.test(lower)&&bytes.length>=4&&((bytes[0]===0x49&&bytes[1]===0x49&&bytes[2]===0x2a&&bytes[3]===0)||(bytes[0]===0x4d&&bytes[1]===0x4d&&bytes[2]===0&&bytes[3]===0x2a));
  if(type==='optimized_glb')return lower.endsWith('.glb')&&ascii.slice(0,4)==='glTF';
  if(type==='copc')return /\.copc\.laz$/.test(lower)&&ascii.slice(0,4)==='LASF'&&ascii.toLowerCase().includes('copc');
  return false;
}

export async function registerManualVariant(request:Request,env:Env,actor:Principal,assetId:string,rid:string):Promise<Response>{
  let input:{variantType?:string;driveFile?:string;externallyValidated?:boolean};
  try{input=await readJson(request)}catch{return error(400,'invalid_json','Dados do resultado inválidos.',rid)}
  const definition=input.variantType?VARIANTS[input.variantType]:null,sourceId=driveFileId(input.driveFile);
  if(!definition||!sourceId||input.externallyValidated!==true)return error(400,'invalid_manual_variant','Informe o arquivo privado, o formato web e confirme a validação externa.',rid);
  const asset=await env.DB.prepare(`SELECT a.id,a.type,a.title,a.capture_id,a.project_id,a.status,p.drive_folder_id project_folder,c.drive_folder_id capture_folder
    FROM assets a JOIN projects p ON p.id=a.project_id LEFT JOIN captures c ON c.id=a.capture_id WHERE a.id=?1 AND a.status!='trashed'`)
    .bind(assetId).first<{id:string;type:string;title:string;capture_id:string|null;project_id:string;status:string;project_folder:string|null;capture_folder:string|null}>();
  if(!asset)return error(404,'asset_not_found','Produto não encontrado.',rid);
  if(!definition.assetTypes.includes(asset.type))return error(400,'variant_type_mismatch','O formato web escolhido não corresponde ao tipo deste produto.',rid);
  let source:Awaited<ReturnType<typeof privateDriveFileInfo>>,bytes:Uint8Array;
  try{[source,bytes]=await Promise.all([privateDriveFileInfo(env,sourceId),prefix(env,sourceId)])}catch{return error(502,'drive_source_unavailable','O Drive não disponibilizou o resultado informado.',rid)}
  if(source.publiclyShared)return error(409,'drive_source_public','Remova o compartilhamento público do arquivo antes de cadastrá-lo.',rid);
  if(source.mimeType==='application/vnd.google-apps.folder'||!validSignature(input.variantType!,source.name,bytes))return error(415,'invalid_variant_binary','O arquivo não corresponde ao formato web selecionado.',rid);
  let destination:string,copied:Awaited<ReturnType<typeof copyDriveFile>>;
  try{
    destination=await ensureFolder(env,{parentId:asset.capture_folder||asset.project_folder||env.DRIVE_ROOT_FOLDER_ID,entityType:'processed',entityId:asset.id,name:'Processados'});
    copied=await copyDriveFile(env,{sourceFileId:source.id,parentId:destination,name:`${asset.id} — ${source.name}`,assetId:asset.id,variantType:input.variantType!});
  }catch{return error(502,'drive_copy_failed','O Drive não copiou o resultado para a pasta oficial do projeto.',rid)}
  const previous=await env.DB.prepare('SELECT drive_file_id FROM asset_variants WHERE asset_id=?1 AND variant_type=?2').bind(asset.id,input.variantType).first<{drive_file_id:string}>();
  try{
    const statements=[
      env.DB.prepare(`INSERT INTO asset_variants(id,asset_id,variant_type,drive_file_id,format,mime_type,size_bytes,metadata_json,status)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'ready') ON CONFLICT(asset_id,variant_type) DO UPDATE SET drive_file_id=excluded.drive_file_id,
        format=excluded.format,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,metadata_json=excluded.metadata_json,status='ready',updated_at=CURRENT_TIMESTAMP`)
        .bind(crypto.randomUUID(),asset.id,input.variantType,copied.id,definition.format,definition.mimeType,copied.size,JSON.stringify({registration:'manual_external',sourceName:source.name,sourceMd5:source.md5Checksum,externallyValidated:true})),
      env.DB.prepare("UPDATE assets SET status='review',error_code=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(asset.id),
      env.DB.prepare("UPDATE projects SET status='review',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status NOT IN ('published','archived','trashed')").bind(asset.project_id)
    ];
    if(asset.capture_id)statements.push(env.DB.prepare("UPDATE captures SET status='review',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status NOT IN ('published','archived','trashed')").bind(asset.capture_id));
    await env.DB.batch(statements);
  }catch{await trashDriveFile(env,copied.id).catch(()=>{});return error(500,'variant_registration_failed','O resultado foi copiado, mas não pôde ser cadastrado.',rid)}
  if(previous?.drive_file_id&&previous.drive_file_id!==copied.id)await trashDriveFile(env,previous.drive_file_id).catch(()=>{});
  await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'asset.manual_variant_registered',targetType:'asset',targetId:asset.id,metadata:{variantType:input.variantType,driveFileId:copied.id,sizeBytes:copied.size,replaced:!!previous}});
  return json({assetId:asset.id,variant:{type:input.variantType,format:definition.format,sizeBytes:copied.size,status:'ready'},status:'review'},201);
}
