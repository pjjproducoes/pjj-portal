import type { Env } from './env';
import type { Principal } from './auth';
import { audit } from './audit';
import { restoreDriveFile, trashDriveFile, uploadSmallDriveFile } from './drive';
import { error, json, readJson } from './http';

const tables={client:'clients',project:'projects',capture:'captures',asset:'assets'} as const;
const LOGO_MAX_BYTES=2*1024*1024;

export function detectedLogoMime(bytes:Uint8Array):'image/png'|'image/jpeg'|'image/webp'|null{
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return'image/png';
  if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return'image/jpeg';
  if(bytes.length>=12&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return'image/webp';
  return null;
}

async function boundedBody(request:Request,maxBytes:number):Promise<Uint8Array|null>{
  if(!request.body)return null;const reader=request.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  for(;;){const {done,value}=await reader.read();if(done)break;if(value){total+=value.byteLength;if(total>maxBytes){await reader.cancel();return null}chunks.push(value)}}
  if(!total)return null;const result=new Uint8Array(total);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength}return result;
}

export async function uploadClientLogo(request:Request,env:Env,actor:Principal,clientId:string,rid:string):Promise<Response>{
  const client=await env.DB.prepare("SELECT id,drive_folder_id,logo_drive_file_id,branding_json FROM clients WHERE id=?1 AND status!='trashed'").bind(clientId).first<{id:string;drive_folder_id:string|null;logo_drive_file_id:string|null;branding_json:string}>();
  if(!client)return error(404,'client_not_found','Cliente não encontrado.',rid);if(!client.drive_folder_id)return error(409,'client_drive_missing','A pasta privada do cliente não está disponível.',rid);
  const bytes=await boundedBody(request,LOGO_MAX_BYTES);if(!bytes)return error(413,'logo_too_large','Envie uma imagem PNG, JPEG ou WebP de até 2 MB.',rid);
  const mime=detectedLogoMime(bytes),declared=request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if(!mime||!['image/png','image/jpeg','image/jpg','image/webp'].includes(declared||'')||(declared==='image/jpg'?'image/jpeg':declared)!==mime)return error(415,'invalid_logo','O conteúdo precisa ser uma imagem PNG, JPEG ou WebP válida.',rid);
  const extension=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';let fileId:string;
  try{fileId=await uploadSmallDriveFile(env,{name:`logo-${clientId}.${extension}`,mimeType:mime,parentId:client.drive_folder_id,bytes,entityType:'client_logo',entityId:clientId})}catch{return error(502,'drive_unavailable','O Drive não recebeu a identidade visual.',rid)}
  let branding:Record<string,unknown>={};try{branding=JSON.parse(client.branding_json||'{}')}catch{}branding.logo=true;branding.logoMime=mime;
  await env.DB.prepare('UPDATE clients SET logo_drive_file_id=?2,branding_json=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1').bind(clientId,fileId,JSON.stringify(branding)).run();
  let previousRemoved=true;if(client.logo_drive_file_id&&client.logo_drive_file_id!==fileId)try{await trashDriveFile(env,client.logo_drive_file_id)}catch{previousRemoved=false}
  await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'client.logo_updated',targetType:'client',targetId:clientId,metadata:{mime,sizeBytes:bytes.byteLength,previousRemoved}});return json({clientId,logo:true,mime});
}

export async function removeClientLogo(env:Env,actor:Principal,clientId:string,rid:string):Promise<Response>{
  const client=await env.DB.prepare("SELECT logo_drive_file_id,branding_json FROM clients WHERE id=?1 AND status!='trashed'").bind(clientId).first<{logo_drive_file_id:string|null;branding_json:string}>();
  if(!client)return error(404,'client_not_found','Cliente não encontrado.',rid);if(!client.logo_drive_file_id)return json({clientId,logo:false});
  try{await trashDriveFile(env,client.logo_drive_file_id)}catch{return error(502,'drive_unavailable','O Drive não removeu a identidade visual.',rid)}
  let branding:Record<string,unknown>={};try{branding=JSON.parse(client.branding_json||'{}')}catch{}delete branding.logo;delete branding.logoMime;
  await env.DB.prepare('UPDATE clients SET logo_drive_file_id=NULL,branding_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1').bind(clientId,JSON.stringify(branding)).run();
  await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'client.logo_removed',targetType:'client',targetId:clientId});return json({clientId,logo:false});
}
export async function adminOverview(env:Env):Promise<Response>{
  const [counts,jobs,failures,assets]=await Promise.all([
    env.DB.prepare(`SELECT (SELECT count(*) FROM clients WHERE status='active') clients,(SELECT count(*) FROM projects WHERE status!='trashed') projects,(SELECT count(*) FROM assets WHERE status!='trashed') assets,(SELECT count(*) FROM users WHERE status='active') users`).first(),
    env.DB.prepare(`SELECT j.id,j.asset_id,j.status,j.progress,j.attempt,j.max_attempts,j.error_code,j.error_message,j.queued_at,j.started_at,a.title asset_title,a.type,a.status asset_status FROM processing_jobs j JOIN assets a ON a.id=j.asset_id ORDER BY j.queued_at DESC LIMIT 30`).all(),
    env.DB.prepare(`SELECT count(*) total FROM processing_jobs WHERE status='failed'`).first(),
    env.DB.prepare(`SELECT a.id,a.project_id,a.capture_id,a.title,a.type,a.version,a.replaces_asset_id,a.status,a.error_code,a.error_message,a.created_at,p.name project_name,
      EXISTS(SELECT 1 FROM assets newer WHERE newer.replaces_asset_id=a.id AND newer.status!='trashed') has_replacement
      FROM assets a JOIN projects p ON p.id=a.project_id WHERE a.status!='trashed' ORDER BY a.created_at DESC LIMIT 100`).all()
  ]);return json({counts,jobs:jobs.results,assets:assets.results,failures});
}
export async function listAccess(env:Env):Promise<Response>{
  const [grants,embeds,sessions]=await Promise.all([
    env.DB.prepare(`SELECT g.id,g.project_id,g.label,g.permission,g.expires_at,g.max_uses,g.use_count,g.revoked_at,g.created_at,p.name project_name FROM access_grants g JOIN projects p ON p.id=g.project_id ORDER BY g.created_at DESC LIMIT 200`).all(),
    env.DB.prepare(`SELECT e.id,e.project_id,e.name,e.allowed_products_json,e.branding_json,e.status,e.expires_at,e.revoked_at,e.created_at,p.name project_name,group_concat(d.hostname) domains FROM embeds e JOIN projects p ON p.id=e.project_id LEFT JOIN embed_domains d ON d.embed_id=e.id GROUP BY e.id ORDER BY e.created_at DESC LIMIT 200`).all(),
    env.DB.prepare(`SELECT s.id,s.user_id,s.created_at,s.last_seen_at,s.expires_at,s.idle_expires_at,s.revoked_at,u.email FROM sessions s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC LIMIT 100`).all()
  ]);return json({grants:grants.results,embeds:embeds.results,sessions:sessions.results});
}
export async function listAudit(env:Env,url:URL):Promise<Response>{
  const q=url.searchParams.get('q')?.trim()||null,limit=Math.min(200,Math.max(1,Number(url.searchParams.get('limit')||100)));
  const rows=await env.DB.prepare(`SELECT id,request_id,actor_type,actor_id,action,target_type,target_id,outcome,metadata_json,created_at FROM audit_logs WHERE ?1 IS NULL OR action LIKE '%'||?1||'%' OR target_type LIKE '%'||?1||'%' OR target_id=?1 ORDER BY id DESC LIMIT ?2`).bind(q,limit).all();return json({items:rows.results});
}
export async function listTrash(env:Env):Promise<Response>{
  const [clients,projects,captures,assets]=await Promise.all([
    env.DB.prepare("SELECT id,name label,status,trashed_at FROM clients WHERE status='trashed' ORDER BY trashed_at DESC").all(),
    env.DB.prepare("SELECT id,name label,status,trashed_at FROM projects WHERE status='trashed' ORDER BY trashed_at DESC").all(),
    env.DB.prepare("SELECT id,COALESCE(title,captured_at) label,status,trashed_at FROM captures WHERE status='trashed' ORDER BY trashed_at DESC").all(),
    env.DB.prepare("SELECT id,title label,status,trashed_at FROM assets WHERE status='trashed' ORDER BY trashed_at DESC").all()
  ]);
  return json({clients:clients.results,projects:projects.results,captures:captures.results,assets:assets.results});
}
export async function revokeAccess(env:Env,actor:Principal,kind:'grant'|'embed'|'session',id:string,rid:string):Promise<Response>{
  const table=kind==='grant'?'access_grants':kind==='embed'?'embeds':'sessions';
  const result=await env.DB.prepare(`UPDATE ${table} SET revoked_at=CURRENT_TIMESTAMP${kind==='embed'?',status=\'disabled\'':''} WHERE id=?1 AND revoked_at IS NULL`).bind(id).run();
  if(!result.meta.changes)return error(404,'access_not_found','Acesso não encontrado ou já revogado.',rid);
  await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:`${kind}.revoked`,targetType:kind,targetId:id});return json({id,revoked:true});
}
export async function restoreEntity(env:Env,actor:Principal,kind:keyof typeof tables,id:string,rid:string):Promise<Response>{
  const table=tables[kind],driveColumn=kind==='asset'?'original_drive_file_id':'drive_folder_id';
  const row=await env.DB.prepare(`SELECT ${driveColumn} drive_id FROM ${table} WHERE id=?1 AND status='trashed'`).bind(id).first<{drive_id:string|null}>();
  if(!row)return error(404,'trashed_not_found','Item excluído não encontrado.',rid);if(row.drive_id)try{await restoreDriveFile(env,row.drive_id)}catch{return error(502,'drive_restore_failed','O Drive não restaurou o item.',rid)}
  const status=kind==='client'?'active':'draft';await env.DB.prepare(`UPDATE ${table} SET status=?2,trashed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id,status).run();
  await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:`${kind}.restored`,targetType:kind,targetId:id});return json({id,status});
}
export async function updateEntity(request:Request,env:Env,actor:Principal,kind:'client'|'project'|'capture'|'asset',id:string,rid:string):Promise<Response>{
  let input:Record<string,unknown>;try{input=await readJson(request)}catch{return error(400,'invalid_json','Dados inválidos.',rid)}
  if(kind==='capture'&&input.metrics&&typeof input.metrics==='object'&&!Array.isArray(input.metrics)){input.metrics_json=input.metrics;delete input.metrics}
  if(kind==='project'&&input.cover_asset_id==='')input.cover_asset_id=null;
  const allowed=kind==='client'?['name','legal_name','primary_contact_name','email','phone','notes','status','branding_json']:
    kind==='project'?['name','description','location_text','latitude','longitude','cover_asset_id','status','visibility','settings_json']:
    kind==='capture'?['title','description','captured_at','status','metrics_json']:
    ['title','type','downloadable','status','metadata_json'];
  const entries=Object.entries(input).filter(([k])=>allowed.includes(k));if(!entries.length)return error(400,'empty_update','Nenhuma alteração válida.',rid);
  const statusValues:Record<typeof kind,string[]>={client:['active','archived'],project:['draft','processing','review','archived'],capture:['draft','uploading','processing','review','archived'],asset:['uploading','received','validating','processing','review','failed','archived']};
  if(input.status!==undefined&&!statusValues[kind].includes(String(input.status)))return error(400,'invalid_status','Use o fluxo específico de publicação, retirada ou lixeira.',rid);
  if(kind==='asset'&&input.type!==undefined&&!['orthophoto','dsm','dtm','model_3d','point_cloud','photo','video','pdf','document','source','other'].includes(String(input.type)))return error(400,'invalid_asset_type','Tipo de produto inválido.',rid);
  if(kind==='asset'&&input.downloadable!==undefined&&typeof input.downloadable!=='boolean')return error(400,'invalid_download_permission','A permissão de download é inválida.',rid);
  if(kind==='client'&&input.email!==undefined&&input.email!==null&&(typeof input.email!=='string'||input.email.length>254||!/^\S+@\S+\.\S+$/.test(input.email)))return error(400,'invalid_email','E-mail inválido.',rid);
  if(entries.some(([key,value])=>['name','title'].includes(key)&&(!String(value||'').trim()||String(value).length>180)))return error(400,'invalid_name','Informe um nome válido.',rid);
  if(kind==='capture'&&input.captured_at&&Number.isNaN(Date.parse(String(input.captured_at))))return error(400,'invalid_capture_date','Informe uma data de captação válida.',rid);
  if(kind==='project'&&input.visibility&&!['private','shared','public_demo'].includes(String(input.visibility)))return error(400,'invalid_visibility','Visibilidade inválida.',rid);
  if(kind==='project'&&input.cover_asset_id){const cover=await env.DB.prepare("SELECT id FROM assets WHERE id=?1 AND project_id=?2 AND type='photo' AND status='published'").bind(input.cover_asset_id,id).first();if(!cover)return error(400,'invalid_cover','A capa precisa ser uma fotografia publicada deste projeto.',rid)}
  if(kind==='project'&&input.latitude!==undefined&&(typeof input.latitude!=='number'||!Number.isFinite(input.latitude)||input.latitude< -90||input.latitude>90))return error(400,'invalid_coordinates','Latitude inválida.',rid);
  if(kind==='project'&&input.longitude!==undefined&&(typeof input.longitude!=='number'||!Number.isFinite(input.longitude)||input.longitude< -180||input.longitude>180))return error(400,'invalid_coordinates','Longitude inválida.',rid);
  for(const [k,v] of entries)if(k.endsWith('_json')){
    if(typeof v==='string'){try{const parsed=JSON.parse(v);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return error(400,'invalid_metadata','Metadados precisam formar um objeto válido.',rid)}catch{return error(400,'invalid_metadata','Metadados precisam formar um objeto válido.',rid)}}
    else if(v&&typeof v==='object'&&!Array.isArray(v))input[k]=JSON.stringify(v);else return error(400,'invalid_metadata','Metadados precisam formar um objeto válido.',rid);
  }
  const table=kind==='client'?'clients':kind==='project'?'projects':kind==='capture'?'captures':'assets';
  const sets=entries.map(([k],i)=>`${k}=?${i+2}`).join(',');const stmt=env.DB.prepare(`UPDATE ${table} SET ${sets},updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status!='trashed'`).bind(id,...entries.map(([k])=>input[k]??null));const result=await stmt.run();
  if(!result.meta.changes)return error(404,`${kind}_not_found`,'Registro não encontrado.',rid);await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:`${kind}.updated`,targetType:kind,targetId:id});return json({id,updated:true});
}
