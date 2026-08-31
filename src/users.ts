import type { Env } from './env';
import type { Principal } from './auth';
import { audit } from './audit';
import { error, json, readJson } from './http';
import { hashPassword } from './password';

export async function createPortalUser(request: Request, env: Env, actor: Principal, rid: string): Promise<Response> {
  let input: { email:string; displayName:string; password:string; projectIds?:string[]; permission?:'view'|'download' };
  try { input = await readJson(request); } catch { return error(400,'invalid_json','Dados inválidos.',rid); }
  const email=input.email?.trim().toLowerCase(), name=input.displayName?.trim();
  if(!email||!/^\S+@\S+\.\S+$/.test(email)||!name) return error(400,'invalid_user','Nome ou e-mail inválido.',rid);
  let passwordHash:string; try{passwordHash=await hashPassword(input.password)}catch{return error(400,'weak_password','Use uma senha com pelo menos 12 caracteres.',rid)}
  const id=crypto.randomUUID();
  const ids=[...new Set((input.projectIds||[]).filter(x=>/^[0-9a-f-]{36}$/.test(x)))];
  const statements=[env.DB.prepare("INSERT INTO users(id,email,display_name,role,password_hash,status) VALUES(?1,?2,?3,'client',?4,'active')").bind(id,email,name,passwordHash)];
  for(const projectId of ids) statements.push(env.DB.prepare("INSERT INTO project_members(project_id,user_id,permission) SELECT id,?2,?3 FROM projects WHERE id=?1 AND status!='trashed'").bind(projectId,id,input.permission||'view'));
  try{await env.DB.batch(statements)}catch{return error(409,'user_exists','Já existe um usuário com esse e-mail.',rid)}
  await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'portal_user.created',targetType:'user',targetId:id,metadata:{projectCount:ids.length}});
  return json({user:{id,email,displayName:name,role:'client'},projectCount:ids.length},201);
}

export async function listPortalUsers(env:Env):Promise<Response>{
  const rows=await env.DB.prepare("SELECT id,email,display_name,status,last_login_at,created_at FROM users WHERE role='client' ORDER BY created_at DESC").all();
  return json({items:rows.results});
}
