import type { Env } from './env';
import { audit } from './audit';
import { principal, createSession, validCsrf } from './auth';
import { constantTimeEqual, randomToken, sha256Hex } from './crypto';
import { clearSessionCookie, error, json, readJson, requestId, sessionCookie } from './http';
import { hashPassword, verifyPassword } from './password';
import { cancelUpload, putChunk, startUpload, uploadStatus } from './uploads';
import { createCapture, createClient, createProject, listCaptures, listClients, listProjects } from './admin';
import { createMfaChallenge, enableMfa, recoverAdminPassword, setupMfa, verifyMfaLogin } from './mfa';
import { adminUi, institutional, invitationUi, portalUi, privacyUi } from './ui';
import { assetContent, portalProject, portalProjects } from './portal';
import { acceptInvitation, createPortalUser, listPortalUsers, updatePortalUser } from './users';
import { createEmbed, embedAsset, embedLogo, embedPage, embedViewer } from './embeds';
import { listAssets, publishEntity, purgeEntity, retryJob, rollbackAsset, trashEntity, unpublishAsset } from './lifecycle';
import { viewerPage } from './viewers';
import { authenticateGrant, createGrant, sharePage, sharedAsset, sharedProject, sharedViewer } from './share';
import { internalRoute } from './internal';
import { adminOverview, listAccess, listAudit, listTrash, removeClientLogo, restoreEntity, revokeAccess, updateEntity, uploadClientLogo } from './admin-ops';
import { reviewPage } from './review';
import { comparisonPage } from './compare';
import { operationsUi } from './ops-ui';
import { demoAsset, demoIndex, demoProject, demoViewer } from './demo';
import { registerManualVariant } from './manual-variants';

function route(path: string, pattern: RegExp): RegExpMatchArray | null {
  return path.match(pattern);
}

async function ipHash(request: Request): Promise<string> {
  return sha256Hex(request.headers.get('cf-connecting-ip') || 'unknown');
}

async function bootstrap(request: Request, env: Env, rid: string): Promise<Response> {
  const existing = await env.DB.prepare("SELECT id FROM users WHERE role='owner' LIMIT 1").first();
  if (existing) return error(409, 'already_bootstrapped', 'A conta proprietária já existe.', rid);
  const secret = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!secret || !await constantTimeEqual(await sha256Hex(secret), env.ADMIN_BOOTSTRAP_HASH)) {
    await audit(env, { requestId: rid, actorType: 'system', action: 'auth.bootstrap', targetType: 'user', outcome: 'denied', ipHash: await ipHash(request) });
    return error(401, 'unauthorized', 'Credencial inválida.', rid);
  }
  let input: { email: string; displayName: string; password: string };
  try { input = await readJson(request); }
  catch { return error(400, 'invalid_json', 'Dados inválidos.', rid); }
  const email = input.email?.trim().toLowerCase();
  const displayName = input.displayName?.trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !displayName || displayName.length > 100) {
    return error(400, 'invalid_user', 'Nome ou e-mail inválido.', rid);
  }
  let passwordHash: string;
  try { passwordHash = await hashPassword(input.password); }
  catch { return error(400, 'weak_password', 'Use uma senha com pelo menos 12 caracteres.', rid); }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users(id,email,display_name,role,password_hash,status) VALUES(?1,?2,?3,'owner',?4,'active')"
  ).bind(id, email, displayName, passwordHash).run();
  await audit(env, { requestId: rid, actorType: 'admin', actorId: id, action: 'auth.bootstrap', targetType: 'user', targetId: id, ipHash: await ipHash(request) });
  return json({ user: { id, email, displayName, role: 'owner' } }, 201);
}

async function login(request: Request, env: Env, rid: string): Promise<Response> {
  let input: { email: string; password: string };
  try { input = await readJson(request); }
  catch { return error(400, 'invalid_json', 'Dados inválidos.', rid); }
  const email = input.email?.trim().toLowerCase();
  const ip = await ipHash(request);
  const rateKey = `login:${ip}:${email || 'invalid'}`;
  const rate = await env.DB.prepare("SELECT attempts,blocked_until FROM rate_limits WHERE key=?1").bind(rateKey).first<{ attempts:number; blocked_until:string|null }>();
  if (rate?.blocked_until && new Date(rate.blocked_until).getTime() > Date.now()) {
    return error(429, 'temporarily_blocked', 'Muitas tentativas. Aguarde antes de tentar novamente.', rid);
  }
  const user = email ? await env.DB.prepare(
    "SELECT id,email,display_name,role,password_hash,status,locked_until,mfa_enabled FROM users WHERE email=?1 LIMIT 1"
  ).bind(email).first<{ id:string; email:string; display_name:string; role:'owner'|'admin'|'client'; password_hash:string|null; status:string; locked_until:string|null; mfa_enabled:number }>() : null;
  const valid = !!user?.password_hash && user.status === 'active' && (!user.locked_until || new Date(user.locked_until).getTime() <= Date.now()) &&
    await verifyPassword(input.password || '', user.password_hash);
  if (!valid) {
    await env.DB.prepare(
      `INSERT INTO rate_limits(key,window_started_at,attempts,blocked_until) VALUES(?1,CURRENT_TIMESTAMP,1,NULL)
       ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_started_at<datetime('now','-15 minutes') THEN 1 ELSE attempts+1 END,
       window_started_at=CASE WHEN window_started_at<datetime('now','-15 minutes') THEN CURRENT_TIMESTAMP ELSE window_started_at END,
       blocked_until=CASE WHEN attempts>=9 THEN datetime('now','+30 minutes') ELSE blocked_until END,updated_at=CURRENT_TIMESTAMP`
    ).bind(rateKey).run();
    await audit(env, { requestId: rid, actorType: 'system', action: 'auth.login', targetType: 'user', targetId: user?.id ?? null, outcome: 'denied', ipHash: ip });
    return error(401, 'invalid_credentials', 'E-mail ou senha inválidos.', rid);
  }
  await env.DB.prepare('DELETE FROM rate_limits WHERE key=?1').bind(rateKey).run();
  if (user.mfa_enabled) {
    const challengeToken = await createMfaChallenge(env, user.id);
    return json({ mfaRequired: true, challengeToken }, 202);
  }
  const session = await createSession(env, user.id, request);
  await env.DB.prepare("UPDATE users SET failed_login_count=0,locked_until=NULL,last_login_at=CURRENT_TIMESTAMP WHERE id=?1").bind(user.id).run();
  await audit(env, { requestId: rid, actorType: user.role === 'client' ? 'client' : 'admin', actorId: user.id, action: 'auth.login', targetType: 'session', outcome: 'success', ipHash: ip });
  return json(
    { user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role }, csrfToken: session.csrf },
    200,
    { 'set-cookie': sessionCookie(session.token, session.maxAge) }
  );
}

async function authenticated(request: Request, env: Env, rid: string): Promise<{ actor: NonNullable<Awaited<ReturnType<typeof principal>>> } | Response> {
  const actor = await principal(env, request);
  if (!actor) return error(401, 'authentication_required', 'Faça login para continuar.', rid);
  if (!['GET','HEAD','OPTIONS'].includes(request.method) && !await validCsrf(request, actor)) {
    return error(403, 'invalid_csrf', 'A sessão não confirmou esta operação.', rid);
  }
  return { actor };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const rid = requestId(request);
    const url = new URL(request.url);
    try {
      if (['GET','HEAD'].includes(request.method) && url.pathname === '/') return institutional();
      if (['GET','HEAD'].includes(request.method) && (url.pathname === '/privacidade' || url.pathname === '/privacy')) return privacyUi();
      if (['GET','HEAD'].includes(request.method) && (url.pathname === '/admin' || url.pathname === '/admin/')) return adminUi();
      if (['GET','HEAD'].includes(request.method) && url.pathname === '/admin/operations') return operationsUi();
      if (['GET','HEAD'].includes(request.method) && (url.pathname === '/portal' || url.pathname === '/portal/')) return portalUi();
      if (['GET','HEAD'].includes(request.method) && (url.pathname === '/demonstracao' || url.pathname === '/demonstracao/')) return demoIndex(env);
      const publicDemoProject = route(url.pathname, /^\/demonstracao\/([0-9a-f-]{36})$/);
      if (publicDemoProject?.[1] && request.method === 'GET') return demoProject(env, publicDemoProject[1], rid);
      const publicDemoViewer = route(url.pathname, /^\/demonstracao\/viewer\/([0-9a-f-]{36})$/);
      if (publicDemoViewer?.[1] && request.method === 'GET') return demoViewer(env, publicDemoViewer[1], rid);
      const publicDemoAsset = route(url.pathname, /^\/api\/demo\/assets\/([0-9a-f-]{36})\/content$/);
      if (publicDemoAsset?.[1] && ['GET','HEAD'].includes(request.method)) return demoAsset(request, env, publicDemoAsset[1], rid);
      const invitePage = route(url.pathname, /^\/invite\/([A-Za-z0-9_-]{40,64})$/);
      if (invitePage?.[1] && request.method === 'GET') return invitationUi(invitePage[1]);
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json({ ok: true, environment: env.ENVIRONMENT, storage: 'google-drive', requestId: rid });
      }
      if (url.pathname.startsWith('/api/internal/')) return internalRoute(request, env, rid);
      if (request.method === 'POST' && url.pathname === '/api/auth/bootstrap') return bootstrap(request, env, rid);
      if (request.method === 'POST' && url.pathname === '/api/auth/login') return login(request, env, rid);
      if (request.method === 'POST' && url.pathname === '/api/auth/recover-password') return recoverAdminPassword(request,env,rid);
      if (request.method === 'POST' && url.pathname === '/api/auth/mfa/verify-login') return verifyMfaLogin(request, env, rid);
      if (request.method === 'POST' && url.pathname === '/api/auth/accept-invite') return acceptInvitation(request, env, rid);
      const share = route(url.pathname, /^\/share\/([A-Za-z0-9_-]{40,64})$/);
      if (share?.[1] && request.method === 'GET') return sharePage(share[1]);
      if (url.pathname === '/api/share/auth' && request.method === 'POST') return authenticateGrant(request, env, rid);
      if (url.pathname === '/api/share/project' && request.method === 'GET') return sharedProject(request, env, rid);
      const shareAsset = route(url.pathname, /^\/api\/share\/assets\/([0-9a-f-]{36})\/content$/);
      if (shareAsset?.[1] && ['GET','HEAD'].includes(request.method)) return sharedAsset(request, env, shareAsset[1], rid);
      const shareViewer = route(url.pathname, /^\/api\/share\/assets\/([0-9a-f-]{36})\/viewer$/);
      if (shareViewer?.[1] && request.method === 'GET') return sharedViewer(request, env, shareViewer[1], rid);
      const publicEmbed = route(url.pathname, /^\/embed\/([A-Za-z0-9_-]{40,64})$/);
      if (publicEmbed?.[1] && request.method === 'GET') return embedPage(request, env, publicEmbed[1], rid);
      const publicEmbedViewer = route(url.pathname, /^\/embed\/([A-Za-z0-9_-]{40,64})\/assets\/([0-9a-f-]{36})$/);
      if (publicEmbedViewer?.[1] && publicEmbedViewer[2] && request.method === 'GET') return embedViewer(request, env, publicEmbedViewer[1], publicEmbedViewer[2], rid);
      const publicEmbedAsset = route(url.pathname, /^\/api\/embed\/([A-Za-z0-9_-]{40,64})\/assets\/([0-9a-f-]{36})\/content$/);
      if (publicEmbedAsset?.[1] && publicEmbedAsset[2] && ['GET','HEAD'].includes(request.method)) return embedAsset(request, env, publicEmbedAsset[1], publicEmbedAsset[2], rid);
      const publicEmbedLogo = route(url.pathname, /^\/api\/embed\/([A-Za-z0-9_-]{40,64})\/logo$/);
      if (publicEmbedLogo?.[1] && ['GET','HEAD'].includes(request.method)) return embedLogo(request, env, publicEmbedLogo[1], rid);

      const auth = await authenticated(request, env, rid);
      if (auth instanceof Response) return auth;
      const { actor } = auth;

      if (request.method === 'GET' && url.pathname === '/api/auth/me') {
        const user = await env.DB.prepare('SELECT id,email,display_name,role,mfa_enabled FROM users WHERE id=?1').bind(actor.userId).first();
        const csrfToken=randomToken();
        await env.DB.prepare('UPDATE sessions SET csrf_hash=?1 WHERE id=?2').bind(await sha256Hex(csrfToken),actor.sessionId).run();
        return json({ user:{...user,mfaEnabled:actor.mfaEnabled}, csrfToken });
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        await env.DB.prepare('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?1').bind(actor.sessionId).run();
        await audit(env, { requestId: rid, actorType: actor.role === 'client' ? 'client' : 'admin', actorId: actor.userId, action: 'auth.logout', targetType: 'session', targetId: actor.sessionId });
        return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/mfa/setup') return setupMfa(env, actor, rid);
      if (request.method === 'POST' && url.pathname === '/api/auth/mfa/enable') return enableMfa(request, env, actor, rid);

      if (request.method === 'GET' && url.pathname === '/api/portal/projects') return portalProjects(env, actor);
      const portalProjectMatch = route(url.pathname, /^\/api\/portal\/projects\/([0-9a-f-]{36})$/);
      if (portalProjectMatch?.[1] && request.method === 'GET') return portalProject(env, actor, portalProjectMatch[1], rid);
      const portalAssetMatch = route(url.pathname, /^\/api\/portal\/assets\/([0-9a-f-]{36})\/content$/);
      if (portalAssetMatch?.[1] && ['GET','HEAD'].includes(request.method)) return assetContent(request, env, actor, portalAssetMatch[1], rid);
      const viewer = route(url.pathname, /^\/viewer\/([0-9a-f-]{36})$/);
      if (viewer?.[1] && request.method === 'GET') return viewerPage(env, actor, viewer[1], rid);
      const comparison = route(url.pathname, /^\/compare\/([0-9a-f-]{36})$/);
      if (comparison?.[1] && request.method === 'GET') return comparisonPage(env, actor, comparison[1], rid);

      if (!['owner','admin'].includes(actor.role)) return error(403, 'forbidden', 'Você não possui permissão administrativa.', rid);
      if (!actor.mfaEnabled) return error(403, 'mfa_required', 'Ative o segundo fator para acessar a administração.', rid);
      const review = route(url.pathname, /^\/admin\/review\/([0-9a-f-]{36})$/);
      if (review?.[1] && request.method === 'GET') return reviewPage(env, actor, review[1], rid);
      if (url.pathname === '/api/admin/users' && request.method === 'GET') return listPortalUsers(env);
      if (url.pathname === '/api/admin/users' && request.method === 'POST') return createPortalUser(request, env, actor, rid);
      const portalUser=route(url.pathname,/^\/api\/admin\/users\/([0-9a-f-]{36})$/);
      if(portalUser?.[1]&&request.method==='PATCH')return updatePortalUser(request,env,actor,portalUser[1],rid);
      if (url.pathname === '/api/admin/embeds' && request.method === 'POST') return createEmbed(request, env, actor, rid);
      if (url.pathname === '/api/admin/grants' && request.method === 'POST') return createGrant(request, env, actor, rid);
      if (url.pathname === '/api/admin/assets' && request.method === 'GET') return listAssets(env, url);
      if (url.pathname === '/api/admin/overview' && request.method === 'GET') return adminOverview(env);
      if (url.pathname === '/api/admin/access' && request.method === 'GET') return listAccess(env);
      if (url.pathname === '/api/admin/audit' && request.method === 'GET') return listAudit(env,url);
      if (url.pathname === '/api/admin/trash' && request.method === 'GET') return listTrash(env);
      const clientLogo = route(url.pathname, /^\/api\/admin\/clients\/([0-9a-f-]{36})\/logo$/);
      if(clientLogo?.[1]&&request.method==='POST')return uploadClientLogo(request,env,actor,clientLogo[1],rid);
      if(clientLogo?.[1]&&request.method==='DELETE')return removeClientLogo(env,actor,clientLogo[1],rid);
      const revoke = route(url.pathname, /^\/api\/admin\/(grants|embeds|sessions)\/([0-9a-f-]{36})\/revoke$/);
      if(revoke?.[1]&&revoke[2]&&request.method==='POST')return revokeAccess(env,actor,revoke[1].slice(0,-1) as 'grant'|'embed'|'session',revoke[2],rid);
      const restore = route(url.pathname, /^\/api\/admin\/(clients|projects|captures|assets)\/([0-9a-f-]{36})\/restore$/);
      if(restore?.[1]&&restore[2]&&request.method==='POST')return restoreEntity(env,actor,restore[1].slice(0,-1) as 'client'|'project'|'capture'|'asset',restore[2],rid);
      const purge = route(url.pathname, /^\/api\/admin\/(clients|projects|captures|assets)\/([0-9a-f-]{36})\/purge$/);
      if(purge?.[1]&&purge[2]&&request.method==='DELETE')return purgeEntity(env,actor,purge[1].slice(0,-1) as 'client'|'project'|'capture'|'asset',purge[2],rid);
      const update = route(url.pathname, /^\/api\/admin\/(clients|projects|captures|assets)\/([0-9a-f-]{36})$/);
      if(update?.[1]&&update[2]&&request.method==='PATCH')return updateEntity(request,env,actor,update[1].slice(0,-1) as 'client'|'project'|'capture'|'asset',update[2],rid);
      const publish = route(url.pathname, /^\/api\/admin\/(projects|captures|assets)\/([0-9a-f-]{36})\/publish$/);
      if (publish?.[1] && publish[2] && request.method === 'POST') return publishEntity(env, actor, publish[1].slice(0,-1) as 'project'|'capture'|'asset', publish[2], rid);
      const unpublish = route(url.pathname, /^\/api\/admin\/assets\/([0-9a-f-]{36})\/unpublish$/);
      if (unpublish?.[1] && request.method === 'POST') return unpublishAsset(env, actor, unpublish[1], rid);
      const rollback = route(url.pathname, /^\/api\/admin\/assets\/([0-9a-f-]{36})\/rollback$/);
      if (rollback?.[1] && request.method === 'POST') return rollbackAsset(env, actor, rollback[1], rid);
      const manualVariant = route(url.pathname, /^\/api\/admin\/assets\/([0-9a-f-]{36})\/variants$/);
      if (manualVariant?.[1] && request.method === 'POST') return registerManualVariant(request,env,actor,manualVariant[1],rid);
      const retry = route(url.pathname, /^\/api\/admin\/jobs\/([0-9a-f-]{36})\/retry$/);
      if (retry?.[1] && request.method === 'POST') return retryJob(env, actor, retry[1], rid);
      const trash = route(url.pathname, /^\/api\/admin\/(clients|projects|captures|assets)\/([0-9a-f-]{36})$/);
      if (trash?.[1] && trash[2] && request.method === 'DELETE') return trashEntity(env, actor, trash[1].slice(0,-1) as 'client'|'project'|'capture'|'asset', trash[2], rid);
      if (url.pathname === '/api/admin/clients' && request.method === 'GET') return listClients(env, url);
      if (url.pathname === '/api/admin/clients' && request.method === 'POST') return createClient(request, env, actor, rid);
      if (url.pathname === '/api/admin/projects' && request.method === 'GET') return listProjects(env, url);
      if (url.pathname === '/api/admin/projects' && request.method === 'POST') return createProject(request, env, actor, rid);
      const captures = route(url.pathname, /^\/api\/admin\/projects\/([0-9a-f-]{36})\/captures$/);
      if (captures?.[1] && request.method === 'GET') return listCaptures(env, captures[1]);
      if (captures?.[1] && request.method === 'POST') return createCapture(request, env, actor, captures[1], rid);
      if (request.method === 'POST' && url.pathname === '/api/admin/uploads') return startUpload(request, env, actor, rid);
      const upload = route(url.pathname, /^\/api\/admin\/uploads\/([0-9a-f-]{36})$/);
      if (upload?.[1] && request.method === 'GET') return uploadStatus(env, actor, upload[1], rid);
      if (upload?.[1] && request.method === 'PUT') return putChunk(request, env, actor, upload[1], rid);
      if (upload?.[1] && request.method === 'DELETE') return cancelUpload(env, actor, upload[1], rid);
      return error(404, 'not_found', 'Rota não encontrada.', rid);
    } catch (caught) {
      console.error(JSON.stringify({ requestId: rid, path: url.pathname, error: caught instanceof Error ? caught.message : 'unknown' }));
      return error(500, 'internal_error', 'Não foi possível concluir a operação.', rid);
    }
  }
};
