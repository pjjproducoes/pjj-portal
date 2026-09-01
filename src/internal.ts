import type { Env } from './env';
import { encrypt } from './crypto';
import { error, json, readJson } from './http';
import { sha256Hex } from './crypto';
import { driveAccessToken } from './drive';

async function authorized(request: Request, env: Env): Promise<boolean> {
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!supplied) return false;
  let privateKey = '';
  try { privateKey = JSON.parse(env.DRIVE_SERVICE_ACCOUNT_JSON).private_key || ''; } catch { return false; }
  const expected = await sha256Hex(`${privateKey}|pjj-processor-v1`);
  const [a, b] = await Promise.all([sha256Hex(supplied), sha256Hex(expected)]);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function internalRoute(request: Request, env: Env, rid: string): Promise<Response> {
  if (!await authorized(request, env)) return error(401, 'unauthorized', 'Credencial interna inválida.', rid);
  const path = new URL(request.url).pathname;

  if (path === '/api/internal/drive-token' && request.method === 'GET') {
    return json({ accessToken: await driveAccessToken(env) });
  }

  if (path === '/api/internal/drive-token' && request.method === 'POST') {
    let input: { accessToken?: string; expiresIn?: number };
    try { input = await readJson(request); } catch { return error(400, 'invalid_json', 'Payload inválido.', rid); }
    if (!input.accessToken || input.accessToken.length < 100 || !Number.isFinite(input.expiresIn) || (input.expiresIn || 0) < 120) {
      return error(400, 'invalid_token', 'Token ou validade inválidos.', rid);
    }
    const ttl = Math.min(3600, Math.floor(input.expiresIn! - 30));
    await env.DB.prepare(`INSERT INTO drive_oauth_cache(cache_key,token_ciphertext,expires_at) VALUES('service_account',?1,datetime('now',?2))
      ON CONFLICT(cache_key) DO UPDATE SET token_ciphertext=excluded.token_ciphertext,expires_at=excluded.expires_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(await encrypt(input.accessToken, env.DATA_ENCRYPTION_KEY), `+${ttl} seconds`).run();
    return json({ ok: true, expiresIn: ttl });
  }

  if (path === '/api/internal/jobs/claim' && request.method === 'POST') {
    // The scheduled executor is stateless. Jobs that exceed the execution
    // window return to the queue on the next run; no heartbeat is required.
    await env.DB.prepare(`UPDATE processing_jobs SET status='retrying',progress=0,error_code='runner_interrupted',
      error_message='O executor anterior excedeu a janela de execução; processamento retomado automaticamente.',next_attempt_at=CURRENT_TIMESTAMP
      WHERE status='running' AND started_at<datetime('now','-6 hours')`).run();
    const job = await env.DB.prepare(`SELECT j.id job_id,j.asset_id,a.type,a.original_name,a.original_drive_file_id,
      COALESCE(c.drive_folder_id,p.drive_folder_id) output_folder_id,a.size_bytes
      FROM processing_jobs j JOIN assets a ON a.id=j.asset_id JOIN projects p ON p.id=a.project_id
      LEFT JOIN captures c ON c.id=a.capture_id
      WHERE j.status IN ('queued','retrying') AND (j.next_attempt_at IS NULL OR j.next_attempt_at<=CURRENT_TIMESTAMP)
      ORDER BY j.queued_at LIMIT 1`).first<Record<string, unknown>>();
    if (!job) return new Response(null, { status: 204 });
    const claimed = await env.DB.prepare(`UPDATE processing_jobs SET status='running',attempt=attempt+1,progress=5,
      started_at=CURRENT_TIMESTAMP,error_code=NULL,error_message=NULL
      WHERE id=?1 AND status IN ('queued','retrying')`).bind(job.job_id).run();
    if (!claimed.meta.changes) return new Response(null, { status: 204 });
    await env.DB.prepare("UPDATE assets SET status='validating',error_code=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1")
      .bind(job.asset_id).run();
    return json(job);
  }

  if (path === '/api/internal/backup' && request.method === 'POST') {
    const tables=['schema_migrations','clients','projects','captures','users','project_members','assets','asset_variants','processing_jobs','embeds','embed_domains','access_grants','invitations','mfa_recovery_codes','audit_logs'];
    const data:Record<string,unknown[]>={};
    for(const table of tables){const result=await env.DB.prepare(`SELECT * FROM ${table}`).all();data[table]=result.results}
    return json({format:'pjj-d1-backup-v1',createdAt:new Date().toISOString(),environment:env.ENVIRONMENT,tables:data});
  }

  const match = path.match(/^\/api\/internal\/jobs\/([0-9a-f-]{36})\/(complete|fail)$/);
  if (!match || request.method !== 'POST') return error(404, 'not_found', 'Rota interna não encontrada.', rid);
  const [, jobId, action] = match;
  let input: { metadata?: unknown; variants?: Array<{type:string;driveFileId:string;format:string;mimeType?:string;sizeBytes?:number;sha256?:string}>; error?:string; detail?:string };
  try { input = await readJson(request); } catch { return error(400, 'invalid_json', 'Payload inválido.', rid); }
  const job = await env.DB.prepare("SELECT asset_id,attempt,max_attempts FROM processing_jobs WHERE id=?1 AND status='running'").bind(jobId)
    .first<{asset_id:string;attempt:number;max_attempts:number}>();
  if (!job) return error(409, 'job_not_running', 'Job não está em execução.', rid);
  if (action === 'complete') {
    const variants = Array.isArray(input.variants) ? input.variants : [];
    const statements = variants.map(v => env.DB.prepare(`INSERT INTO asset_variants(id,asset_id,variant_type,drive_file_id,format,mime_type,size_bytes,checksum_sha256,status)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'ready') ON CONFLICT(asset_id,variant_type) DO UPDATE SET drive_file_id=excluded.drive_file_id,
      format=excluded.format,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,checksum_sha256=excluded.checksum_sha256,status='ready',updated_at=CURRENT_TIMESTAMP`)
      .bind(crypto.randomUUID(), job.asset_id, v.type, v.driveFileId, v.format, v.mimeType || null, v.sizeBytes || null, v.sha256 || null));
    const detected=(input.metadata as {detectedType?:string}|undefined)?.detectedType;
    const validTypes=new Set(['orthophoto','dsm','dtm','model_3d','point_cloud','photo','video','pdf','document','source','other']);
    statements.push(env.DB.prepare("UPDATE assets SET status='review',type=CASE WHEN ?3 IS NOT NULL THEN ?3 ELSE type END,metadata_json=?2,error_code=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1")
      .bind(job.asset_id, JSON.stringify(input.metadata || {}),detected&&validTypes.has(detected)?detected:null));
    statements.push(env.DB.prepare("UPDATE processing_jobs SET status='succeeded',progress=100,finished_at=CURRENT_TIMESTAMP,output_json=?2 WHERE id=?1")
      .bind(jobId, JSON.stringify({ metadata: input.metadata || {}, variants })));
    await env.DB.batch(statements);
    await env.DB.prepare(`UPDATE captures SET status='review',updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT capture_id FROM assets WHERE id=?1)
      AND NOT EXISTS(SELECT 1 FROM assets a JOIN processing_jobs j ON j.asset_id=a.id WHERE a.capture_id=captures.id AND j.status NOT IN ('succeeded','cancelled'))`).bind(job.asset_id).run();
    await env.DB.prepare(`UPDATE projects SET status='review',updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT project_id FROM assets WHERE id=?1)
      AND NOT EXISTS(SELECT 1 FROM assets a JOIN processing_jobs j ON j.asset_id=a.id WHERE a.project_id=projects.id AND j.status NOT IN ('succeeded','cancelled'))`).bind(job.asset_id).run();
    return json({ ok: true, status: 'review' });
  }
  const detail = String(input.detail || input.error || 'processing_failed').slice(0, 2000);
  if (job.attempt < job.max_attempts) {
    await env.DB.batch([
      env.DB.prepare("UPDATE processing_jobs SET status='retrying',progress=0,error_code=?2,error_message=?3,next_attempt_at=datetime('now','+5 minutes') WHERE id=?1").bind(jobId, input.error || 'processing_failed', detail),
      env.DB.prepare("UPDATE assets SET status='processing',error_code=?2,error_message=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(job.asset_id, input.error || 'processing_failed', detail)
    ]);
    return json({ ok: true, status: 'retrying' });
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE processing_jobs SET status='failed',error_code=?2,error_message=?3,finished_at=CURRENT_TIMESTAMP WHERE id=?1").bind(jobId, input.error || 'processing_failed', detail),
    env.DB.prepare("UPDATE assets SET status='failed',error_code=?2,error_message=?3,updated_at=CURRENT_TIMESTAMP WHERE id=?1").bind(job.asset_id, input.error || 'processing_failed', detail)
  ]);
  return json({ ok: true, status: 'failed' });
}
