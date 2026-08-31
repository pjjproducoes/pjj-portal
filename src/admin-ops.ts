import type { Env } from './env';
import type { Principal } from './auth';
import { audit } from './audit';
import { restoreDriveFile } from './drive';
import { error, json, readJson } from './http';

const tables={client:'clients',project:'projects',capture:'captures',asset:'assets'} as const;
export async function adminOverview(env:Env):Promise<Response>{
  const [counts,jobs,failures]=await Promise.all([
    env.DB.prepare(`SELECT (SELECT count(*) FROM clients WHERE status='active') clients,(SELECT count(*) FROM projects WHERE status!='trashed') projects,(SELECT count(*) FROM assets WHERE status!='trashed') assets,(SELECT count(*) FROM users WHERE status='active') users`).first(),
    env.DB.prepare(`SELECT j.id,j.asset_id,j.status,j.progress,j.attempt,j.max_attempts,j.error_code,j.error_message,j.queued_at,j.started_at,a.title,a.type FROM processing_jobs j JOIN assets a ON a.id=j.asset_id ORDER BY j.queued_at DESC LIMIT 30`).all(),
    env.DB.prepare(`SELECT count(*) total FROM processing_jobs WHERE status='failed'`).first()
  ]);return json({counts,jobs:jobs.results,failures});
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
export async function updateEntity(request:Request,env:Env,actor:Principal,kind:'client'|'project',id:string,rid:string):Promise<Response>{
  let input:Record<string,unknown>;try{input=await readJson(request)}catch{return error(400,'invalid_json','Dados inválidos.',rid)}
  const allowed=kind==='client'?['name','legal_name','primary_contact_name','email','phone','notes','status','branding_json']:['name','description','location_text','status','visibility','settings_json'];
  const entries=Object.entries(input).filter(([k])=>allowed.includes(k));if(!entries.length)return error(400,'empty_update','Nenhuma alteração válida.',rid);
  for(const [k,v] of entries)if((k.endsWith('_json'))&&typeof v!=='string')input[k]=JSON.stringify(v);
  const sets=entries.map(([k],i)=>`${k}=?${i+2}`).join(',');const stmt=env.DB.prepare(`UPDATE ${kind==='client'?'clients':'projects'} SET ${sets},updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status!='trashed'`).bind(id,...entries.map(([k])=>input[k]??null));const result=await stmt.run();
  if(!result.meta.changes)return error(404,`${kind}_not_found`,'Registro não encontrado.',rid);await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:`${kind}.updated`,targetType:kind,targetId:id});return json({id,updated:true});
}
