import type { Env } from './env';
import type { Principal } from './auth';
import { audit } from './audit';
import { error, json, readJson } from './http';
import { hashPassword } from './password';
import { randomToken, sha256Hex } from './crypto';

export async function createPortalUser(request: Request, env: Env, actor: Principal, rid: string): Promise<Response> {
  let input: { email:string; displayName:string; projectIds?:string[]; permission?:'view'|'download' };
  try { input = await readJson(request); } catch { return error(400,'invalid_json','Dados inválidos.',rid); }
  const email=input.email?.trim().toLowerCase(), name=input.displayName?.trim();
  if(!email||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||!name||name.length>120) return error(400,'invalid_user','Nome ou e-mail inválido.',rid);
  if(input.permission&&!['view','download'].includes(input.permission))return error(400,'invalid_permission','Permissão de portal inválida.',rid);
  const id=crypto.randomUUID(),token=randomToken();
  const supplied=input.projectIds||[],ids=[...new Set(supplied.filter(x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)))];
  if(!ids.length||ids.length!==new Set(supplied).size||ids.length>100)return error(400,'invalid_projects','Selecione projetos válidos para este usuário.',rid);
  const projects=await Promise.all(ids.map(projectId=>env.DB.prepare("SELECT id FROM projects WHERE id=?1 AND status!='trashed'").bind(projectId).first()));
  if(projects.some(project=>!project))return error(400,'invalid_projects','Um projeto selecionado não está disponível.',rid);
  const statements=[env.DB.prepare("INSERT INTO users(id,email,display_name,role,status) VALUES(?1,?2,?3,'client','invited')").bind(id,email,name),
    env.DB.prepare("INSERT INTO invitations(id,user_id,token_hash,expires_at,created_by) VALUES(?1,?2,?3,datetime('now','+7 days'),?4)").bind(crypto.randomUUID(),id,await sha256Hex(token),actor.userId)];
  for(const projectId of ids) statements.push(env.DB.prepare("INSERT INTO project_members(project_id,user_id,permission) SELECT id,?2,?3 FROM projects WHERE id=?1 AND status!='trashed'").bind(projectId,id,input.permission||'view'));
  try{await env.DB.batch(statements)}catch{return error(409,'user_exists','Já existe um usuário com esse e-mail.',rid)}
  await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'portal_user.created',targetType:'user',targetId:id,metadata:{projectCount:ids.length}});
  return json({user:{id,email,displayName:name,role:'client',status:'invited'},projectCount:ids.length,inviteUrl:`${env.PUBLIC_ORIGIN}/invite/${token}`,expiresInSeconds:604800},201);
}

export async function listPortalUsers(env:Env):Promise<Response>{
  const rows=await env.DB.prepare(`SELECT u.id,u.email,u.display_name,u.status,u.last_login_at,u.created_at,
    group_concat(m.project_id) project_ids,group_concat(DISTINCT m.permission) permissions
    FROM users u LEFT JOIN project_members m ON m.user_id=u.id WHERE u.role='client'
    GROUP BY u.id ORDER BY u.created_at DESC`).all();
  return json({items:rows.results});
}

export async function updatePortalUser(request:Request,env:Env,actor:Principal,userId:string,rid:string):Promise<Response>{
  let input:{displayName?:string;status?:'active'|'disabled';projectIds?:string[];permission?:'view'|'download'};try{input=await readJson(request)}catch{return error(400,'invalid_json','Dados inválidos.',rid)}
  const user=await env.DB.prepare("SELECT id,status,password_hash FROM users WHERE id=?1 AND role='client'").bind(userId).first<{id:string;status:string;password_hash:string|null}>();if(!user)return error(404,'user_not_found','Usuário do portal não encontrado.',rid);
  if(input.status&&!['active','disabled'].includes(input.status))return error(400,'invalid_status','Status de usuário inválido.',rid);if(input.status==='active'&&!user.password_hash)return error(409,'invitation_pending','O convite precisa ser aceito antes da reativação.',rid);
  if(input.permission&&!['view','download'].includes(input.permission))return error(400,'invalid_permission','Permissão de portal inválida.',rid);
  const name=input.displayName?.trim();if(input.displayName!==undefined&&(!name||name.length>120))return error(400,'invalid_user','Nome inválido.',rid);
  const statements:D1PreparedStatement[]=[];if(name)statements.push(env.DB.prepare('UPDATE users SET display_name=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1').bind(userId,name));
  if(input.status){statements.push(env.DB.prepare('UPDATE users SET status=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1').bind(userId,input.status));if(input.status==='disabled')statements.push(env.DB.prepare('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=?1 AND revoked_at IS NULL').bind(userId))}
  let projectCount:number|undefined;
  if(input.projectIds!==undefined){const supplied=input.projectIds,ids=[...new Set(supplied.filter(x=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)))];if(ids.length!==new Set(supplied).size||ids.length>100)return error(400,'invalid_projects','Selecione projetos válidos.',rid);const projects=await Promise.all(ids.map(projectId=>env.DB.prepare("SELECT id FROM projects WHERE id=?1 AND status!='trashed'").bind(projectId).first()));if(projects.some(project=>!project))return error(400,'invalid_projects','Um projeto selecionado não está disponível.',rid);projectCount=ids.length;statements.push(env.DB.prepare('DELETE FROM project_members WHERE user_id=?1').bind(userId));for(const projectId of ids)statements.push(env.DB.prepare('INSERT INTO project_members(project_id,user_id,permission) VALUES(?1,?2,?3)').bind(projectId,userId,input.permission||'view'))}
  if(!statements.length)return error(400,'empty_update','Nenhuma alteração válida.',rid);await env.DB.batch(statements);await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'portal_user.updated',targetType:'user',targetId:userId,metadata:{status:input.status||user.status,projectCount}});return json({userId,updated:true,status:input.status||user.status,projectCount});
}

export async function acceptInvitation(request:Request,env:Env,rid:string):Promise<Response>{
  let input:{token:string;password:string};try{input=await readJson(request)}catch{return error(400,'invalid_json','Dados inválidos.',rid)}
  const invitation=await env.DB.prepare(`SELECT i.id,i.user_id FROM invitations i JOIN users u ON u.id=i.user_id WHERE i.token_hash=?1 AND i.used_at IS NULL AND i.expires_at>CURRENT_TIMESTAMP AND u.status='invited'`)
    .bind(await sha256Hex(input.token||'')).first<{id:string;user_id:string}>();if(!invitation)return error(410,'invite_invalid','O convite expirou ou já foi usado.',rid);
  let passwordHash:string;try{passwordHash=await hashPassword(input.password)}catch{return error(400,'weak_password','Use uma senha com pelo menos 12 caracteres.',rid)}
  await env.DB.batch([env.DB.prepare('UPDATE invitations SET used_at=CURRENT_TIMESTAMP WHERE id=?1').bind(invitation.id),env.DB.prepare("UPDATE users SET password_hash=?2,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(invitation.user_id,passwordHash)]);
  await audit(env,{requestId:rid,actorType:'client',actorId:invitation.user_id,action:'portal_invitation.accepted',targetType:'user',targetId:invitation.user_id});
  return json({accepted:true});
}
