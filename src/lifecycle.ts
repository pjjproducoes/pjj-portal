import type { Env } from './env';
import type { Principal } from './auth';
import { audit } from './audit';
import { error, json } from './http';
import { trashDriveFile } from './drive';

export async function listAssets(env:Env,url:URL):Promise<Response>{
  const projectId=url.searchParams.get('projectId'),captureId=url.searchParams.get('captureId');
  const rows=await env.DB.prepare(`SELECT a.id,a.project_id,a.capture_id,a.type,a.title,a.original_name,a.mime_type,a.size_bytes,a.status,a.error_code,a.error_message,a.created_at,
    j.id job_id,j.status job_status,j.progress job_progress,j.error_message job_error
    FROM assets a LEFT JOIN processing_jobs j ON j.id=(SELECT id FROM processing_jobs WHERE asset_id=a.id ORDER BY queued_at DESC LIMIT 1)
    WHERE a.status!='trashed' AND (?1 IS NULL OR a.project_id=?1) AND (?2 IS NULL OR a.capture_id=?2) ORDER BY a.created_at DESC LIMIT 200`)
    .bind(projectId,captureId).all();return json({items:rows.results});
}

export async function publishEntity(env:Env,actor:Principal,kind:'project'|'capture'|'asset',id:string,rid:string):Promise<Response>{
  const table=kind==='project'?'projects':kind==='capture'?'captures':'assets';
  if(kind==='asset'){
    const row=await env.DB.prepare("SELECT status,project_id,capture_id FROM assets WHERE id=?1").bind(id).first<{status:string;project_id:string;capture_id:string|null}>();
    if(!row)return error(404,'asset_not_found','Produto não encontrado.',rid);
    if(!['review','published'].includes(row.status))return error(409,'asset_not_ready','O produto precisa passar pela validação antes de ser publicado.',rid);
    const statements=[env.DB.prepare("UPDATE assets SET status='published',published_at=COALESCE(published_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(id),
      env.DB.prepare("UPDATE projects SET status='published',published_at=COALESCE(published_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status!='trashed'").bind(row.project_id)];
    if(row.capture_id)statements.push(env.DB.prepare("UPDATE captures SET status='published',published_at=COALESCE(published_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status!='trashed'").bind(row.capture_id));
    await env.DB.batch(statements);
    await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'asset.published',targetType:'asset',targetId:id,metadata:{projectId:row.project_id,captureId:row.capture_id,parentsPublished:true}});
    return json({id,status:'published',projectId:row.project_id,captureId:row.capture_id});
  }
  const result=await env.DB.prepare(`UPDATE ${table} SET status='published',published_at=COALESCE(published_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status!='trashed'`).bind(id).run();
  if(!result.meta.changes)return error(404,`${kind}_not_found`,'Registro não encontrado.',rid);
  await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:`${kind}.published`,targetType:kind,targetId:id});return json({id,status:'published'});
}

export async function retryJob(env:Env,actor:Principal,jobId:string,rid:string):Promise<Response>{
  const result=await env.DB.prepare(`UPDATE processing_jobs SET status='queued',attempt=0,progress=0,error_code=NULL,error_message=NULL,next_attempt_at=NULL,queued_at=CURRENT_TIMESTAMP,started_at=NULL,finished_at=NULL
    WHERE id=?1 AND status='failed'`).bind(jobId).run();if(!result.meta.changes)return error(409,'job_not_retryable','O job não está com falha ou não existe.',rid);
  await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'job.retried',targetType:'processing_job',targetId:jobId});return json({id:jobId,status:'queued'});
}

export async function trashEntity(env:Env,actor:Principal,kind:'client'|'project'|'capture'|'asset',id:string,rid:string):Promise<Response>{
  const table=kind==='client'?'clients':kind==='project'?'projects':kind==='capture'?'captures':'assets';
  const driveColumn=kind==='asset'?'original_drive_file_id':'drive_folder_id';
  const row=await env.DB.prepare(`SELECT ${driveColumn} drive_id FROM ${table} WHERE id=?1 AND status!='trashed'`).bind(id).first<{drive_id:string|null}>();
  if(!row)return error(404,`${kind}_not_found`,'Registro não encontrado.',rid);
  if(kind==='client'){
    const active=await env.DB.prepare("SELECT 1 FROM projects WHERE client_id=?1 AND status!='trashed' LIMIT 1").bind(id).first();
    if(active)return error(409,'client_has_projects','Remova os projetos do cliente antes.',rid);
  }
  if(kind==='project'){
    const active=await env.DB.prepare("SELECT 1 FROM assets WHERE project_id=?1 AND status!='trashed' LIMIT 1").bind(id).first();
    if(active)return error(409,'project_has_assets','Remova os produtos do projeto antes.',rid);
  }
  if(row.drive_id)try{await trashDriveFile(env,row.drive_id)}catch{return error(502,'drive_trash_failed','O Drive não moveu o item para a lixeira.',rid)}
  await env.DB.prepare(`UPDATE ${table} SET status='trashed',trashed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1`).bind(id).run();
  await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:`${kind}.trashed`,targetType:kind,targetId:id});return json({id,status:'trashed',recoverable:true});
}
