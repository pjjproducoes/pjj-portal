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
  if(!email||!/^\S+@\S+\.\S+$/.test(email)||!name) return error(400,'invalid_user','Nome ou e-mail inválido.',rid);
  const id=crypto.randomUUID(),token=randomToken();
  const ids=[...new Set((input.projectIds||[]).filter(x=>/^[0-9a-f-]{36}$/.test(x)))];
  const statements=[env.DB.prepare("INSERT INTO users(id,email,display_name,role,status) VALUES(?1,?2,?3,'client','invited')").bind(id,email,name),
    env.DB.prepare("INSERT INTO invitations(id,user_id,token_hash,expires_at,created_by) VALUES(?1,?2,?3,datetime('now','+7 days'),?4)").bind(crypto.randomUUID(),id,await sha256Hex(token),actor.userId)];
  for(const projectId of ids) statements.push(env.DB.prepare("INSERT INTO project_members(project_id,user_id,permission) SELECT id,?2,?3 FROM projects WHERE id=?1 AND status!='trashed'").bind(projectId,id,input.permission||'view'));
  try{await env.DB.batch(statements)}catch{return error(409,'user_exists','Já existe um usuário com esse e-mail.',rid)}
  await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'portal_user.created',targetType:'user',targetId:id,metadata:{projectCount:ids.length}});
  return json({user:{id,email,displayName:name,role:'client',status:'invited'},projectCount:ids.length,inviteUrl:`${env.PUBLIC_ORIGIN}/invite/${token}`,expiresInSeconds:604800},201);
}

export async function listPortalUsers(env:Env):Promise<Response>{
  const rows=await env.DB.prepare("SELECT id,email,display_name,status,last_login_at,created_at FROM users WHERE role='client' ORDER BY created_at DESC").all();
  return json({items:rows.results});
}

export async function acceptInvitation(request:Request,env:Env,rid:string):Promise<Response>{
  let input:{token:string;password:string};try{input=await readJson(request)}catch{return error(400,'invalid_json','Dados inválidos.',rid)}
  const invitation=await env.DB.prepare(`SELECT i.id,i.user_id FROM invitations i JOIN users u ON u.id=i.user_id WHERE i.token_hash=?1 AND i.used_at IS NULL AND i.expires_at>CURRENT_TIMESTAMP AND u.status='invited'`)
    .bind(await sha256Hex(input.token||'')).first<{id:string;user_id:string}>();if(!invitation)return error(410,'invite_invalid','O convite expirou ou já foi usado.',rid);
  let passwordHash:string;try{passwordHash=await hashPassword(input.password)}catch{return error(400,'weak_password','Use uma senha com pelo menos 12 caracteres.',rid)}
  await env.DB.batch([env.DB.prepare('UPDATE invitations SET used_at=CURRENT_TIMESTAMP WHERE id=?1').bind(invitation.id),env.DB.prepare("UPDATE users SET password_hash=?2,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(invitation.user_id,passwordHash)]);
  return json({accepted:true});
}
