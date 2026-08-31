import type { Env } from './env';
import type { Principal } from './auth';
import { streamFile } from './drive';
import { error, json, safeInlineMime } from './http';
import { audit } from './audit';

function canManage(actor: Principal): boolean { return actor.role === 'owner' || actor.role === 'admin'; }

export async function portalProjects(env: Env, actor: Principal): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT p.id,p.name,p.slug,p.description,p.location_text,p.status,p.published_at,c.name client_name,c.branding_json
     FROM projects p JOIN clients c ON c.id=p.client_id
     WHERE p.status!='trashed' AND (?1 IN ('owner','admin') OR (p.status='published' AND EXISTS(
       SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?2)))
     ORDER BY COALESCE(p.published_at,p.updated_at) DESC`
  ).bind(actor.role, actor.userId).all();
  return json({ items: result.results });
}

export async function portalProject(env: Env, actor: Principal, projectId: string, rid: string): Promise<Response> {
  const project = await env.DB.prepare(
    `SELECT p.id,p.name,p.description,p.location_text,p.status,p.settings_json,c.name client_name,c.branding_json
     FROM projects p JOIN clients c ON c.id=p.client_id WHERE p.id=?1 AND p.status!='trashed'
       AND (?2 IN ('owner','admin') OR (p.status='published' AND EXISTS(
         SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?3)))`
  ).bind(projectId, actor.role, actor.userId).first();
  if (!project) return error(404, 'project_not_found', 'Projeto não encontrado.', rid);
  const captures = await env.DB.prepare(
    `SELECT id,captured_at,title,description,status,metrics_json FROM captures
     WHERE project_id=?1 AND status!='trashed' AND (?2 IN ('owner','admin') OR status='published') ORDER BY captured_at DESC`
  ).bind(projectId, actor.role).all();
  const assets = await env.DB.prepare(
    `SELECT a.id,a.capture_id,a.type,a.title,a.original_name,a.mime_type,a.size_bytes,a.status,a.downloadable,a.metadata_json,
       EXISTS(SELECT 1 FROM asset_variants v WHERE v.asset_id=a.id AND v.status='ready') has_ready_variant
     FROM assets a WHERE a.project_id=?1 AND a.status!='trashed' AND (?2 IN ('owner','admin') OR a.status='published')
     ORDER BY a.created_at DESC`
  ).bind(projectId, actor.role).all();
  const comparison = await env.DB.prepare(`SELECT COUNT(DISTINCT a.id) total FROM assets a JOIN captures c ON c.id=a.capture_id
    JOIN asset_variants v ON v.asset_id=a.id AND v.variant_type='cog' AND v.status='ready'
    WHERE a.project_id=?1 AND a.type='orthophoto' AND a.status='published' AND c.status='published'`).bind(projectId).first<{ total:number }>();
  return json({ project, captures: captures.results, assets: assets.results, comparisonAvailable: (comparison?.total ?? 0) >= 2 });
}

export async function assetContent(request: Request, env: Env, actor: Principal, assetId: string, rid: string): Promise<Response> {
  const variant = new URL(request.url).searchParams.get('variant');
  const inlineRequested = new URL(request.url).searchParams.get('inline') === '1';
  const row = await env.DB.prepare(
    `SELECT a.id,a.original_name,a.mime_type,a.original_drive_file_id,a.downloadable,a.status,
       v.drive_file_id variant_drive_file_id,v.mime_type variant_mime_type,v.format
     FROM assets a JOIN projects p ON p.id=a.project_id
     LEFT JOIN asset_variants v ON v.asset_id=a.id AND v.variant_type=?4 AND v.status='ready'
     WHERE a.id=?1 AND a.status!='trashed' AND (?2 IN ('owner','admin') OR (a.status='published' AND EXISTS(
       SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?3))) LIMIT 1`
  ).bind(assetId, actor.role, actor.userId, variant).first<{
    original_name:string;mime_type:string|null;original_drive_file_id:string|null;downloadable:number;status:string;
    variant_drive_file_id:string|null;variant_mime_type:string|null;format:string|null;
  }>();
  if (!row) return error(404, 'asset_not_found', 'Arquivo não encontrado.', rid);
  if (!canManage(actor) && !row.downloadable && !variant) return error(403, 'download_disabled', 'Download não autorizado.', rid);
  const fileId = variant ? row.variant_drive_file_id : row.original_drive_file_id;
  if (!fileId) return error(409, variant ? 'variant_not_ready' : 'file_not_ready', 'A visualização ainda não está pronta.', rid);
  const upstream = await streamFile(env, fileId, request.headers.get('range'));
  if (!upstream.ok && upstream.status !== 206) return error(502, 'drive_stream_failed', 'Não foi possível transmitir o arquivo.', rid);
  const responseMime = variant ? row.variant_mime_type || 'application/octet-stream' : row.mime_type || 'application/octet-stream';
  const safeInline = safeInlineMime(responseMime);
  const headers = new Headers({
    'content-type': responseMime,
    'cache-control': 'private, no-store', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff',
    'content-disposition': `${variant || (inlineRequested && safeInline) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.original_name)}`
  });
  for (const name of ['content-length','content-range','etag','last-modified']) {
    const value = upstream.headers.get(name); if (value) headers.set(name, value);
  }
  await audit(env,{requestId:rid,actorType:actor.role==='client'?'client':'admin',actorId:actor.userId,action:variant||inlineRequested?'asset.viewed':'asset.downloaded',targetType:'asset',targetId:assetId,metadata:{variant:variant||null}});
  return new Response(upstream.body, { status: upstream.status, headers });
}
