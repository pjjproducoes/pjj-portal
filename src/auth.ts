import type { Env } from './env';
import { randomToken, sha256Hex } from './crypto';
import { parseCookie } from './http';

export interface Principal {
  sessionId: string;
  userId: string;
  role: 'owner' | 'admin' | 'client';
  csrfHash: string;
  mfaEnabled: boolean;
}

export async function createSession(env: Env, userId: string, request: Request): Promise<{ token: string; csrf: string; maxAge: number }> {
  const token = randomToken();
  const csrf = randomToken();
  const maxAge = 8 * 60 * 60;
  const ip = request.headers.get('cf-connecting-ip') || '';
  const agent = request.headers.get('user-agent') || '';
  await env.DB.prepare(
    `INSERT INTO sessions(id,user_id,token_hash,csrf_hash,ip_hash,user_agent_hash,expires_at,idle_expires_at)
     VALUES(?1,?2,?3,?4,?5,?6,datetime('now','+8 hours'),datetime('now','+30 minutes'))`
  ).bind(crypto.randomUUID(), userId, await sha256Hex(token), await sha256Hex(csrf), await sha256Hex(ip), await sha256Hex(agent)).run();
  return { token, csrf, maxAge };
}

export async function principal(env: Env, request: Request): Promise<Principal | null> {
  const token = parseCookie(request, 'pjj_session');
  if (!token) return null;
  const agentHash = await sha256Hex(request.headers.get('user-agent') || '');
  const row = await env.DB.prepare(
    `SELECT s.id session_id,s.user_id,s.csrf_hash,u.role,u.mfa_enabled
     FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP
       AND s.idle_expires_at>CURRENT_TIMESTAMP AND s.user_agent_hash=?2 AND u.status='active' LIMIT 1`
  ).bind(await sha256Hex(token),agentHash).first<{ session_id: string; user_id: string; csrf_hash: string; role: Principal['role']; mfa_enabled:number }>();
  if (!row) return null;
  await env.DB.prepare("UPDATE sessions SET last_seen_at=CURRENT_TIMESTAMP,idle_expires_at=datetime('now','+30 minutes') WHERE id=?1").bind(row.session_id).run();
  return { sessionId: row.session_id, userId: row.user_id, role: row.role, csrfHash: row.csrf_hash, mfaEnabled: row.mfa_enabled === 1 };
}

export async function validCsrf(request: Request, actor: Principal): Promise<boolean> {
  const token = request.headers.get('x-csrf-token');
  return !!token && await sha256Hex(token) === actor.csrfHash;
}
