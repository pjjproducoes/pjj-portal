import type { Env } from './env';
import type { Principal } from './auth';
import { audit } from './audit';
import { randomToken, sha256Hex } from './crypto';
import { streamFile } from './drive';
import { error, html, json, readJson } from './http';

function hostname(value:string|null):string|null { try{return value?new URL(value).hostname.toLowerCase():null}catch{return null} }
function requestHost(request:Request):string|null{return hostname(request.headers.get('origin'))||hostname(request.headers.get('referer'))}
function validDomain(actual:string, allowed:string):boolean{return actual===allowed||actual.endsWith('.'+allowed)}

export async function createEmbed(request:Request,env:Env,actor:Principal,rid:string):Promise<Response>{
  let input:{projectId:string;name:string;domains:string[];products?:string[];expiresAt?:string};
  try{input=await readJson(request)}catch{return error(400,'invalid_json','Dados inválidos.',rid)}
  const domains=[...new Set((input.domains||[]).map(x=>hostname(x.includes('://')?x:`https://${x}`)).filter((x):x is string=>!!x))];
  if(!input.projectId||!input.name?.trim()||!domains.length)return error(400,'invalid_embed','Projeto, nome e domínio são obrigatórios.',rid);
  const project=await env.DB.prepare("SELECT id FROM projects WHERE id=?1 AND status!='trashed'").bind(input.projectId).first();
  if(!project)return error(404,'project_not_found','Projeto não encontrado.',rid);
  const token=randomToken(),id=crypto.randomUUID();
  const statements=[env.DB.prepare('INSERT INTO embeds(id,project_id,name,token_hash,allowed_products_json,expires_at,created_by) VALUES(?1,?2,?3,?4,?5,?6,?7)').bind(id,input.projectId,input.name.trim(),await sha256Hex(token),JSON.stringify(input.products||[]),input.expiresAt||null,actor.userId)];
  for(const domain of domains)statements.push(env.DB.prepare('INSERT INTO embed_domains(id,embed_id,hostname) VALUES(?1,?2,?3)').bind(crypto.randomUUID(),id,domain));
  await env.DB.batch(statements);await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'embed.created',targetType:'embed',targetId:id,metadata:{domains}});
  return json({embed:{id,projectId:input.projectId,name:input.name,domains},token,url:`${env.PUBLIC_ORIGIN}/embed/${token}`},201);
}

async function authorizedEmbed(request:Request,env:Env,token:string){
  const row=await env.DB.prepare(`SELECT e.id,e.project_id,e.allowed_products_json,e.branding_json,p.name project_name
    FROM embeds e JOIN projects p ON p.id=e.project_id WHERE e.token_hash=?1 AND e.status='active' AND e.revoked_at IS NULL
    AND (e.expires_at IS NULL OR e.expires_at>CURRENT_TIMESTAMP) AND p.status='published'`)
    .bind(await sha256Hex(token)).first<{id:string;project_id:string;allowed_products_json:string;branding_json:string;project_name:string}>();
  if(!row)return null;const actual=requestHost(request);if(!actual)return null;
  const domains=await env.DB.prepare('SELECT hostname FROM embed_domains WHERE embed_id=?1').bind(row.id).all<{hostname:string}>();
  if(!domains.results.some(d=>validDomain(actual,d.hostname)))return null;return{...row,domains:domains.results.map(d=>d.hostname)};
}

export async function embedPage(request:Request,env:Env,token:string,rid:string):Promise<Response>{
  const embed=await authorizedEmbed(request,env,token);if(!embed)return error(403,'embed_denied','Este domínio não está autorizado.',rid);
  const assets=await env.DB.prepare(`SELECT id,type,title,mime_type FROM assets WHERE project_id=?1 AND status='published' ORDER BY created_at DESC`).bind(embed.project_id).all();
  const allowed=JSON.parse(embed.allowed_products_json||'[]') as string[];const visible=(assets.results as any[]).filter(a=>!allowed.length||allowed.includes(a.id)||allowed.includes(a.type));
  const nonce=randomToken(12),ancestors=embed.domains.map(d=>`https://${d} https://*.${d}`).join(' ');
  const items=visible.map((a:any)=>`<li><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.type)}</span><a href="/api/embed/${token}/assets/${a.id}/content" target="_blank" rel="noopener">Abrir</a></li>`).join('');
  const markup=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(embed.project_name)}</title><style nonce="${nonce}">body{margin:0;background:#f3f3ee;color:#172620;font:15px system-ui}.head{padding:20px 24px;background:#163f34;color:#fff}.head small{opacity:.7}ul{list-style:none;margin:0;padding:16px;display:grid;gap:10px}li{display:grid;grid-template-columns:1fr auto auto;gap:16px;align-items:center;background:#fff;padding:16px;border-radius:12px}a{color:#23634f;font-weight:700}</style></head><body><header class="head"><small>PJJ Portal</small><h2>${escapeHtml(embed.project_name)}</h2></header><ul>${items||'<li>Nenhum produto publicado.</li>'}</ul></body></html>`;
  const response=html(markup,nonce);response.headers.set('content-security-policy',`default-src 'none'; style-src 'nonce-${nonce}'; frame-ancestors ${ancestors}; base-uri 'none'`);response.headers.delete('x-frame-options');return response;
}

export async function embedAsset(request:Request,env:Env,token:string,assetId:string,rid:string):Promise<Response>{
  const embed=await authorizedEmbed(request,env,token);if(!embed)return error(403,'embed_denied','Este domínio não está autorizado.',rid);
  const allowed=JSON.parse(embed.allowed_products_json||'[]') as string[];
  const row=await env.DB.prepare("SELECT original_drive_file_id,mime_type,original_name FROM assets WHERE id=?1 AND project_id=?2 AND status='published'").bind(assetId,embed.project_id).first<{original_drive_file_id:string|null;mime_type:string|null;original_name:string}>();
  const typeRow=await env.DB.prepare("SELECT type FROM assets WHERE id=?1").bind(assetId).first<{type:string}>();if(allowed.length&&!allowed.includes(assetId)&&!allowed.includes(typeRow?.type||''))return error(403,'product_denied','Este produto não está liberado no embed.',rid);
  if(!row?.original_drive_file_id)return error(404,'asset_not_found','Arquivo não encontrado.',rid);const upstream=await streamFile(env,row.original_drive_file_id,request.headers.get('range'));if(!upstream.ok&&upstream.status!==206)return error(502,'drive_stream_failed','Falha ao transmitir.',rid);
  const headers=new Headers({'content-type':row.mime_type||'application/octet-stream','cache-control':'private, no-store','accept-ranges':'bytes','x-content-type-options':'nosniff'});for(const h of ['content-length','content-range']){const v=upstream.headers.get(h);if(v)headers.set(h,v)}return new Response(upstream.body,{status:upstream.status,headers});
}
function escapeHtml(v:unknown):string{return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))}
