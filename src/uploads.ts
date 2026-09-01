import type { Env } from './env';
import type { Principal } from './auth';
import { createResumableUpload, ensureFolder, uploadChunk } from './drive';
import { decrypt, encrypt } from './crypto';
import { error, json, readJson } from './http';
import { audit } from './audit';

const TYPES = new Set(['orthophoto','dsm','dtm','model_3d','point_cloud','photo','video','pdf','document','source','other']);
const CHUNK_SIZE = 8 * 1024 * 1024;

interface StartUpload {
  projectId: string;
  captureId?: string;
  type?: string;
  title?: string;
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
  replacesAssetId?: string;
}

export function inferAssetType(fileName:string,mimeType:string,declared?:string):string{
  if(declared&&declared!=='auto'&&TYPES.has(declared))return declared;
  const extension=fileName.toLowerCase().split('.').pop()||'',mime=mimeType.toLowerCase();
  if(['tif','tiff','geotiff'].includes(extension)||mime.includes('tiff'))return 'orthophoto';
  if(['las','laz','copc'].includes(extension))return 'point_cloud';
  if(['glb','gltf','obj','fbx','dae','ply','stl'].includes(extension))return 'model_3d';
  if(extension==='pdf'||mime==='application/pdf')return 'pdf';
  if(mime.startsWith('image/')||['jpg','jpeg','png','webp','heic'].includes(extension))return 'photo';
  if(mime.startsWith('video/')||['mp4','mov','m4v','webm','avi'].includes(extension))return 'video';
  if(['doc','docx','xls','xlsx','csv','txt'].includes(extension))return 'document';
  return 'other';
}

export async function startUpload(request: Request, env: Env, actor: Principal, rid: string): Promise<Response> {
  let input: StartUpload;
  try { input = await readJson<StartUpload>(request); }
  catch { return error(400, 'invalid_json', 'Os dados do arquivo são inválidos.', rid); }
  const name = input.fileName?.trim();
  if (!name || name.length > 255 || /[\/\0]/.test(name) || (input.type!=='auto'&&input.type!==undefined&&!TYPES.has(input.type)) ||
      !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > 5 * 1024 ** 4) {
    return error(400, 'invalid_upload_metadata', 'Nome, tipo ou tamanho do arquivo é inválido.', rid);
  }
  const assetType=inferAssetType(name,input.mimeType||'',input.type);
  const project = await env.DB.prepare(
    `SELECT p.id,p.drive_folder_id FROM projects p
     WHERE p.id=?1 AND p.status NOT IN ('trashed','archived')
       AND (?2 IN ('owner','admin') OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?3 AND m.permission='manage'))`
  ).bind(input.projectId, actor.role, actor.userId).first<{ id: string; drive_folder_id: string | null }>();
  if (!project) return error(404, 'project_not_found', 'Projeto não encontrado.', rid);
  let version=1,replacesAssetId:string|null=null;
  if(input.replacesAssetId){
    const replaced=await env.DB.prepare(`SELECT id,version FROM assets WHERE id=?1 AND project_id=?2 AND status!='trashed'`)
      .bind(input.replacesAssetId,input.projectId).first<{id:string;version:number}>();
    if(!replaced)return error(400,'invalid_replacement','A versão anterior não pertence a este projeto.',rid);
    replacesAssetId=replaced.id;version=replaced.version+1;
  }
  let destinationFolder = project.drive_folder_id || env.DRIVE_ROOT_FOLDER_ID;
  if (input.captureId) {
    const capture = await env.DB.prepare("SELECT id,drive_folder_id FROM captures WHERE id=?1 AND project_id=?2 AND status!='trashed'").bind(input.captureId, input.projectId).first<{id:string;drive_folder_id:string}>();
    if (!capture) return error(400, 'invalid_capture', 'A captação não pertence ao projeto.', rid);
    try { destinationFolder = await ensureFolder(env, { parentId:capture.drive_folder_id, entityType:'original', entityId:capture.id, name:'Original' }); }
    catch { return error(502, 'drive_unavailable', 'O Drive não localizou a pasta da captação.', rid); }
  }
  // A refresh, browser crash or temporary loss of connection must not create a
  // second asset.  The resumable Drive session is still valid for 23 hours, so
  // hand the same session back to the authenticated operator.
  const resumable = await env.DB.prepare(
    `SELECT u.id upload_id,u.asset_id,u.received_bytes,u.chunk_size_bytes,u.total_bytes
       FROM upload_sessions u JOIN assets a ON a.id=u.asset_id
      WHERE a.project_id=?1 AND a.capture_id IS ?2 AND a.original_name=?3
        AND a.size_bytes=?4 AND a.status='uploading' AND u.status='active'
        AND u.expires_at>CURRENT_TIMESTAMP
      ORDER BY u.updated_at DESC LIMIT 1`
  ).bind(input.projectId, input.captureId ?? null, name, input.sizeBytes).first<{
    upload_id:string;asset_id:string;received_bytes:number;chunk_size_bytes:number;total_bytes:number;
  }>();
  if(resumable){
    await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'upload.resumed',targetType:'asset',targetId:resumable.asset_id,metadata:{receivedBytes:resumable.received_bytes}});
    return json({uploadId:resumable.upload_id,assetId:resumable.asset_id,chunkSize:resumable.chunk_size_bytes,receivedBytes:resumable.received_bytes,totalBytes:resumable.total_bytes,resumed:true,expiresInSeconds:82_800});
  }
  const duplicate = await env.DB.prepare(
    `SELECT id FROM assets WHERE project_id=?1 AND capture_id IS ?2 AND original_name=?3
       AND size_bytes=?4 AND status NOT IN ('trashed','failed') LIMIT 1`
  ).bind(input.projectId, input.captureId ?? null, name, input.sizeBytes).first();
  if (duplicate) return error(409, 'possible_duplicate', 'Já existe um arquivo com o mesmo nome e tamanho nesta captação.', rid);

  const assetId = crypto.randomUUID();
  const uploadId = crypto.randomUUID();
  const mime = input.mimeType || 'application/octet-stream';
  let sessionUrl: string;
  try {
    sessionUrl = await createResumableUpload(env, {
      name, mimeType: mime, size: input.sizeBytes, parentId: destinationFolder, assetId, projectId: input.projectId
    });
  } catch {
    await audit(env, { requestId: rid, actorType: 'admin', actorId: actor.userId, action: 'upload.init', targetType: 'project', targetId: input.projectId, outcome: 'failure' });
    return error(502, 'drive_unavailable', 'O Drive não iniciou o upload. Tente novamente.', rid);
  }
  const encryptedUrl = await encrypt(sessionUrl, env.DATA_ENCRYPTION_KEY);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assets(id,project_id,capture_id,type,title,original_name,mime_type,size_bytes,version,replaces_asset_id,status)
       VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'uploading')`
    ).bind(assetId, input.projectId, input.captureId ?? null, assetType, input.title?.trim() || name, name, mime, input.sizeBytes, version, replacesAssetId),
    env.DB.prepare(
      `INSERT INTO upload_sessions(id,asset_id,drive_session_url_ciphertext,total_bytes,chunk_size_bytes,expires_at)
       VALUES(?1,?2,?3,?4,?5,datetime('now','+23 hours'))`
    ).bind(uploadId, assetId, encryptedUrl, input.sizeBytes, CHUNK_SIZE)
  ]);
  await audit(env, { requestId: rid, actorType: 'admin', actorId: actor.userId, action: 'upload.started', targetType: 'asset', targetId: assetId, metadata: { sizeBytes: input.sizeBytes, declaredType: input.type||'auto', inferredType:assetType, version, replacesAssetId } });
  return json({ uploadId, assetId, inferredType:assetType, chunkSize: CHUNK_SIZE, receivedBytes: 0, expiresInSeconds: 82_800 }, 201);
}

export async function uploadStatus(env: Env, actor: Principal, uploadId: string, rid: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT u.id,u.asset_id,u.total_bytes,u.received_bytes,u.chunk_size_bytes,u.status,u.expires_at
     FROM upload_sessions u JOIN assets a ON a.id=u.asset_id JOIN projects p ON p.id=a.project_id
     WHERE u.id=?1 AND (?2 IN ('owner','admin') OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?3))`
  ).bind(uploadId, actor.role, actor.userId).first();
  return row ? json(row) : error(404, 'upload_not_found', 'Upload não encontrado.', rid);
}

export async function putChunk(request: Request, env: Env, actor: Principal, uploadId: string, rid: string): Promise<Response> {
  const contentRange = request.headers.get('content-range') || '';
  const match = contentRange.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!match || !request.body) return error(400, 'invalid_chunk', 'O intervalo do chunk é inválido.', rid);
  const start = Number(match[1]), end = Number(match[2]), total = Number(match[3]);
  const row = await env.DB.prepare(
    `SELECT u.*,a.project_id,a.id asset_id FROM upload_sessions u JOIN assets a ON a.id=u.asset_id
     WHERE u.id=?1 AND u.status='active' AND u.expires_at>CURRENT_TIMESTAMP
       AND (?2 IN ('owner','admin') OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=a.project_id AND m.user_id=?3 AND m.permission='manage'))`
  ).bind(uploadId, actor.role, actor.userId).first<{
    id:string; asset_id:string; project_id:string; drive_session_url_ciphertext:string;
    total_bytes:number; received_bytes:number; chunk_size_bytes:number;
  }>();
  if (!row) return error(404, 'upload_not_found', 'Upload inexistente ou expirado.', rid);
  if (total !== row.total_bytes || start !== row.received_bytes || end < start || end >= total ||
      (end - start + 1 > row.chunk_size_bytes && end !== total - 1)) {
    return json({ error: { code: 'chunk_conflict', message: 'Retome pelo último byte confirmado.', requestId: rid }, receivedBytes: row.received_bytes }, 409);
  }
  let drive: Response;
  try {
    drive = await uploadChunk(env, await decrypt(row.drive_session_url_ciphertext, env.DATA_ENCRYPTION_KEY), request.body, contentRange, request.headers.get('content-type') || 'application/octet-stream');
  } catch {
    return error(502, 'drive_unavailable', 'Não foi possível enviar o chunk ao Drive.', rid);
  }
  if (drive.status === 308) {
    const confirmed = Number((drive.headers.get('range') || '').match(/-(\d+)$/)?.[1] ?? -1) + 1;
    if (confirmed < start || confirmed > total) return error(502, 'drive_invalid_progress', 'O Drive retornou progresso inválido.', rid);
    await env.DB.prepare('UPDATE upload_sessions SET received_bytes=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1').bind(uploadId, confirmed).run();
    return json({ status: 'active', receivedBytes: confirmed, totalBytes: total });
  }
  if (!drive.ok) {
    await env.DB.batch([
      env.DB.prepare("UPDATE upload_sessions SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(uploadId),
      env.DB.prepare("UPDATE assets SET status='failed',error_code='drive_chunk_failed',error_message=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(row.asset_id, `Drive HTTP ${drive.status}`)
    ]);
    await audit(env, { requestId: rid, actorType: 'admin', actorId: actor.userId, action: 'upload.failed', targetType: 'asset', targetId: row.asset_id, outcome: 'failure', metadata: { driveStatus: drive.status } });
    return error(502, 'drive_upload_failed', 'O Drive recusou o arquivo.', rid);
  }
  const completed = await drive.json<{ id: string; size?: string; md5Checksum?: string }>();
  if (!completed.id) return error(502, 'drive_invalid_response', 'O Drive não confirmou o arquivo.', rid);
  const jobId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("UPDATE upload_sessions SET status='completed',received_bytes=total_bytes,updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(uploadId),
    env.DB.prepare("UPDATE assets SET original_drive_file_id=?2,size_bytes=?3,status='received',metadata_json=?4,updated_at=CURRENT_TIMESTAMP WHERE id=?1")
      .bind(row.asset_id, completed.id, Number(completed.size || total), JSON.stringify({ md5Checksum: completed.md5Checksum ?? null })),
    env.DB.prepare("INSERT INTO processing_jobs(id,asset_id,kind,status) VALUES(?1,?2,'detect_and_validate','queued')").bind(jobId, row.asset_id),
    env.DB.prepare("UPDATE projects SET status='processing',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status IN ('draft','review')").bind(row.project_id),
    env.DB.prepare("UPDATE captures SET status='processing',updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT capture_id FROM assets WHERE id=?1) AND status IN ('draft','uploading','review')").bind(row.asset_id)
  ]);
  await audit(env, { requestId: rid, actorType: 'admin', actorId: actor.userId, action: 'upload.completed', targetType: 'asset', targetId: row.asset_id, metadata: { jobId } });
  return json({ status: 'completed', assetId: row.asset_id, jobId });
}

export async function cancelUpload(env: Env, actor: Principal, uploadId: string, rid: string): Promise<Response> {
  const row=await env.DB.prepare(`SELECT u.asset_id FROM upload_sessions u JOIN assets a ON a.id=u.asset_id
    WHERE u.id=?1 AND u.status='active' AND (?2 IN ('owner','admin') OR EXISTS(
      SELECT 1 FROM project_members m WHERE m.project_id=a.project_id AND m.user_id=?3 AND m.permission='manage'))`)
    .bind(uploadId,actor.role,actor.userId).first<{asset_id:string}>();
  if(!row)return error(404,'upload_not_found','Upload ativo não encontrado.',rid);
  await env.DB.batch([
    env.DB.prepare("UPDATE upload_sessions SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status='active'").bind(uploadId),
    env.DB.prepare("UPDATE assets SET status='failed',error_code='upload_cancelled',error_message='Upload cancelado pelo administrador.',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status='uploading'").bind(row.asset_id)
  ]);
  await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'upload.cancelled',targetType:'asset',targetId:row.asset_id});
  return json({status:'cancelled',assetId:row.asset_id});
}
