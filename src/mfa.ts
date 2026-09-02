import type { Env } from './env';
import type { Principal } from './auth';
import { createSession } from './auth';
import { decrypt, encrypt, randomToken, sha256Hex } from './crypto';
import { error, json, readJson, sessionCookie } from './http';
import { createTotpSecret, otpauthUri, verifyTotp } from './totp';
import { hashPassword } from './password';

export async function createMfaChallenge(env: Env, userId: string): Promise<string> {
  const token = randomToken();
  await env.DB.prepare(
    "INSERT INTO auth_challenges(id,user_id,token_hash,kind,expires_at) VALUES(?1,?2,?3,'mfa_login',datetime('now','+5 minutes'))"
  ).bind(crypto.randomUUID(), userId, await sha256Hex(token)).run();
  return token;
}

export async function setupMfa(env: Env, actor: Principal, rid: string): Promise<Response> {
  const user = await env.DB.prepare('SELECT email,mfa_enabled FROM users WHERE id=?1').bind(actor.userId).first<{email:string;mfa_enabled:number}>();
  if (!user) return error(404, 'user_not_found', 'Usuário não encontrado.', rid);
  if (user.mfa_enabled) return error(409, 'mfa_already_enabled', 'O segundo fator já está ativo.', rid);
  const secret = createTotpSecret();
  await env.DB.prepare('UPDATE users SET mfa_secret_ciphertext=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2')
    .bind(await encrypt(secret, env.DATA_ENCRYPTION_KEY), actor.userId).run();
  return json({ secret, otpauthUri: otpauthUri(secret, user.email) });
}

export async function enableMfa(request: Request, env: Env, actor: Principal, rid: string): Promise<Response> {
  let input: { code: string };
  try { input = await readJson(request); } catch { return error(400, 'invalid_json', 'Dados inválidos.', rid); }
  const row = await env.DB.prepare('SELECT mfa_secret_ciphertext,mfa_enabled FROM users WHERE id=?1').bind(actor.userId)
    .first<{mfa_secret_ciphertext:string|null;mfa_enabled:number}>();
  if (!row?.mfa_secret_ciphertext) return error(409, 'mfa_setup_required', 'Inicie a configuração do segundo fator.', rid);
  if (row.mfa_enabled) return error(409, 'mfa_already_enabled', 'O segundo fator já está ativo.', rid);
  const secret = await decrypt(row.mfa_secret_ciphertext, env.DATA_ENCRYPTION_KEY);
  if (!await verifyTotp(secret, input.code || '')) return error(400, 'invalid_mfa_code', 'Código inválido.', rid);
  const recoveryCodes = Array.from({ length: 10 }, () => randomToken(8).toUpperCase());
  await env.DB.batch(await Promise.all(recoveryCodes.map(async code => env.DB.prepare(
    'INSERT INTO mfa_recovery_codes(id,user_id,code_hash) VALUES(?1,?2,?3)'
  ).bind(crypto.randomUUID(), actor.userId, await sha256Hex(code)))));
  await env.DB.prepare('UPDATE users SET mfa_enabled=1,updated_at=CURRENT_TIMESTAMP WHERE id=?1').bind(actor.userId).run();
  await env.DB.prepare('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=?1 AND id!=?2 AND revoked_at IS NULL').bind(actor.userId,actor.sessionId).run();
  return json({ enabled: true, recoveryCodes });
}

export async function verifyMfaLogin(request: Request, env: Env, rid: string): Promise<Response> {
  let input: { challengeToken: string; code: string };
  try { input = await readJson(request); } catch { return error(400, 'invalid_json', 'Dados inválidos.', rid); }
  const hash = await sha256Hex(input.challengeToken || '');
  const row = await env.DB.prepare(
    `SELECT c.id challenge_id,c.user_id,u.email,u.display_name,u.role,u.mfa_secret_ciphertext
     FROM auth_challenges c JOIN users u ON u.id=c.user_id
     WHERE c.token_hash=?1 AND c.kind='mfa_login' AND c.used_at IS NULL AND c.expires_at>CURRENT_TIMESTAMP AND c.attempts<5
       AND u.status='active' AND u.mfa_enabled=1 LIMIT 1`
  ).bind(hash).first<{challenge_id:string;user_id:string;email:string;display_name:string;role:'owner'|'admin'|'client';mfa_secret_ciphertext:string}>();
  if (!row) return error(401, 'invalid_mfa_challenge', 'Desafio expirado ou inválido.', rid);
  const secret = await decrypt(row.mfa_secret_ciphertext, env.DATA_ENCRYPTION_KEY);
  let accepted = await verifyTotp(secret, input.code || '');
  if (!accepted && input.code) {
    const recoveryHash = await sha256Hex(input.code.trim().toUpperCase());
    const recovery = await env.DB.prepare('SELECT id FROM mfa_recovery_codes WHERE user_id=?1 AND code_hash=?2 AND used_at IS NULL')
      .bind(row.user_id, recoveryHash).first<{id:string}>();
    if (recovery) {
      accepted = true;
      await env.DB.prepare('UPDATE mfa_recovery_codes SET used_at=CURRENT_TIMESTAMP WHERE id=?1').bind(recovery.id).run();
    }
  }
  if (!accepted) {
    await env.DB.prepare('UPDATE auth_challenges SET attempts=attempts+1 WHERE id=?1').bind(row.challenge_id).run();
    return error(401, 'invalid_mfa_code', 'Código inválido.', rid);
  }
  await env.DB.prepare('UPDATE auth_challenges SET used_at=CURRENT_TIMESTAMP WHERE id=?1').bind(row.challenge_id).run();
  const session = await createSession(env, row.user_id, request);
  return json({ user:{id:row.user_id,email:row.email,displayName:row.display_name,role:row.role},csrfToken:session.csrf }, 200,
    {'set-cookie':sessionCookie(session.token,session.maxAge)});
}

export async function recoverAdminPassword(request:Request,env:Env,rid:string):Promise<Response>{
  let input:{email:string;code:string;newPassword:string};
  try{input=await readJson(request)}catch{return error(400,'invalid_json','Dados inválidos.',rid)}
  const email=input.email?.trim().toLowerCase(),code=input.code?.trim();
  if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!code){
    return error(400,'invalid_recovery','Informe e-mail, código de segurança e a nova senha.',rid);
  }
  let passwordHash:string;
  try{passwordHash=await hashPassword(input.newPassword)}catch{return error(400,'weak_password','Use uma senha com pelo menos 12 caracteres.',rid)}
  const ip=await sha256Hex(request.headers.get('cf-connecting-ip')||'unknown'),key=`password-recovery:${ip}:${email}`;
  const rate=await env.DB.prepare('SELECT attempts,blocked_until FROM rate_limits WHERE key=?1').bind(key).first<{attempts:number;blocked_until:string|null}>();
  if(rate?.blocked_until&&new Date(rate.blocked_until).getTime()>Date.now())return error(429,'temporarily_blocked','Muitas tentativas. Aguarde antes de tentar novamente.',rid);
  const user=await env.DB.prepare(`SELECT id,mfa_secret_ciphertext FROM users WHERE email=?1 AND role IN ('owner','admin') AND status='active' AND mfa_enabled=1 LIMIT 1`)
    .bind(email).first<{id:string;mfa_secret_ciphertext:string|null}>();
  let accepted=false,recoveryId:string|null=null;
  if(user?.mfa_secret_ciphertext){
    try{accepted=await verifyTotp(await decrypt(user.mfa_secret_ciphertext,env.DATA_ENCRYPTION_KEY),code)}catch{accepted=false}
    if(!accepted){
      const recovery=await env.DB.prepare('SELECT id FROM mfa_recovery_codes WHERE user_id=?1 AND code_hash=?2 AND used_at IS NULL LIMIT 1')
        .bind(user.id,await sha256Hex(code.toUpperCase())).first<{id:string}>();
      if(recovery){accepted=true;recoveryId=recovery.id}
    }
  }
  if(!accepted||!user){
    await env.DB.prepare(`INSERT INTO rate_limits(key,window_started_at,attempts,blocked_until) VALUES(?1,CURRENT_TIMESTAMP,1,NULL)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_started_at<datetime('now','-15 minutes') THEN 1 ELSE attempts+1 END,
      window_started_at=CASE WHEN window_started_at<datetime('now','-15 minutes') THEN CURRENT_TIMESTAMP ELSE window_started_at END,
      blocked_until=CASE WHEN attempts>=5 THEN datetime('now','+30 minutes') ELSE blocked_until END,updated_at=CURRENT_TIMESTAMP`).bind(key).run();
    return error(401,'invalid_recovery','Não foi possível confirmar o código de segurança.',rid);
  }
  const statements=[
    env.DB.prepare('UPDATE users SET password_hash=?2,failed_login_count=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1').bind(user.id,passwordHash),
    env.DB.prepare('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=?1 AND revoked_at IS NULL').bind(user.id),
    env.DB.prepare('UPDATE auth_challenges SET used_at=CURRENT_TIMESTAMP WHERE user_id=?1 AND used_at IS NULL').bind(user.id),
    env.DB.prepare('DELETE FROM rate_limits WHERE key=?1').bind(key)
  ];
  if(recoveryId)statements.push(env.DB.prepare('UPDATE mfa_recovery_codes SET used_at=CURRENT_TIMESTAMP WHERE id=?1').bind(recoveryId));
  await env.DB.batch(statements);
  await env.DB.prepare(`INSERT INTO audit_logs(request_id,actor_type,actor_id,action,target_type,target_id,outcome,ip_hash)
    VALUES(?1,'admin',?2,'auth.password_recovered','user',?2,'success',?3)`).bind(rid,user.id,ip).run();
  return json({reset:true});
}
