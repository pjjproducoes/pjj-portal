import type { Env } from './env';
import type { Principal } from './auth';
import { audit } from './audit';
import { decodeBase64Url, encodeBase64Url, randomToken, sha256Hex, signValue, verifyValue } from './crypto';
import { deliveryViewer } from './delivery-viewer';
import { streamFile } from './drive';
import { error, html, json, readJson, safeInlineMime, validByteRange } from './http';

export function hostname(value:string|null):string|null { try{return value?new URL(value).hostname.toLowerCase():null}catch{return null} }
function requestHost(request:Request):string|null{return hostname(request.headers.get('origin'))||hostname(request.headers.get('referer'))}
export function validDomain(actual:string, allowed:string):boolean{return actual===allowed||actual.endsWith('.'+allowed)}
function safeObject(value:string|null|undefined):Record<string,any>{try{const parsed=JSON.parse(value||'{}');return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{}}catch{return{}}}
function safeProducts(value:string):string[]{try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed.filter(x=>typeof x==='string'):[]}catch{return[]}}

export async function createEmbed(request:Request,env:Env,actor:Principal,rid:string):Promise<Response>{
  let input:{projectId:string;name:string;domains:string[];products?:string[];expiresAt?:string;mode?:'pjj'|'client'|'white_label';brandName?:string;accent?:string;allowDownloads?:boolean|'on'};
  try{input=await readJson(request)}catch{return error(400,'invalid_json','Dados inválidos.',rid)}
  const domains=[...new Set((input.domains||[]).map(x=>hostname(x.includes('://')?x:`https://${x}`)).filter((x):x is string=>!!x))];
  if(!input.projectId||!input.name?.trim()||!domains.length)return error(400,'invalid_embed','Projeto, nome e domínio são obrigatórios.',rid);
  if(input.expiresAt&&(!Number.isFinite(Date.parse(input.expiresAt))||Date.parse(input.expiresAt)<=Date.now()))return error(400,'invalid_expiry','A validade precisa ser uma data futura.',rid);
  const project=await env.DB.prepare("SELECT p.id,c.name client_name,c.branding_json,c.logo_drive_file_id FROM projects p JOIN clients c ON c.id=p.client_id WHERE p.id=?1 AND p.status!='trashed'").bind(input.projectId).first<{id:string;client_name:string;branding_json:string;logo_drive_file_id:string|null}>();
  if(!project)return error(404,'project_not_found','Projeto não encontrado.',rid);
  const token=randomToken(),id=crypto.randomUUID(),clientBrand=safeObject(project.branding_json);
  const branded=input.mode==='client'||input.mode==='white_label';
  const downloads=input.allowDownloads===true||input.allowDownloads==='on';
  const branding=branded?{mode:input.mode,name:input.brandName?.trim()||clientBrand.name||project.client_name,accent:/^#[0-9a-f]{6}$/i.test(input.accent||'')?input.accent:clientBrand.accent||'#173f35',poweredBy:input.mode==='client',downloads,logo:!!project.logo_drive_file_id}:{mode:'pjj',name:'PJJ Portal',accent:'#173f35',poweredBy:true,downloads,logo:false};
  const statements=[env.DB.prepare('INSERT INTO embeds(id,project_id,name,token_hash,allowed_products_json,branding_json,expires_at,created_by) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)').bind(id,input.projectId,input.name.trim(),await sha256Hex(token),JSON.stringify(input.products||[]),JSON.stringify(branding),input.expiresAt||null,actor.userId)];
  for(const domain of domains)statements.push(env.DB.prepare('INSERT INTO embed_domains(id,embed_id,hostname) VALUES(?1,?2,?3)').bind(crypto.randomUUID(),id,domain));
  await env.DB.batch(statements);await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'embed.created',targetType:'embed',targetId:id,metadata:{domains}});
  return json({embed:{id,projectId:input.projectId,name:input.name,domains},token,url:`${env.PUBLIC_ORIGIN}/embed/${token}`},201);
}

type EmbedAuthorization={id:string;project_id:string;allowed_products_json:string;branding_json:string;project_name:string;domains:string[]};

async function issueEmbedSession(env:Env,embedId:string):Promise<string>{
  const payload=encodeBase64Url(JSON.stringify({embedId,expiresAt:Date.now()+15*60*1000}));
  return `${payload}.${await signValue(payload,env.SESSION_HMAC_KEY)}`;
}

async function validEmbedSession(env:Env,value:string|null,embedId:string):Promise<boolean>{
  if(!value)return false;const [payload,signature,...extra]=value.split('.');if(!payload||!signature||extra.length)return false;
  if(!await verifyValue(payload,signature,env.SESSION_HMAC_KEY))return false;
  const decoded=decodeBase64Url(payload);if(!decoded)return false;
  try{const claim=JSON.parse(decoded) as {embedId?:string;expiresAt?:number};return claim.embedId===embedId&&Number.isFinite(claim.expiresAt)&&claim.expiresAt!>Date.now()}catch{return false}
}

async function authorizedEmbed(request:Request,env:Env,token:string,session:string|null=null):Promise<EmbedAuthorization|null>{
  const row=await env.DB.prepare(`SELECT e.id,e.project_id,e.allowed_products_json,e.branding_json,p.name project_name
    FROM embeds e JOIN projects p ON p.id=e.project_id WHERE e.token_hash=?1 AND e.status='active' AND e.revoked_at IS NULL
    AND (e.expires_at IS NULL OR e.expires_at>CURRENT_TIMESTAMP) AND p.status='published'`)
    .bind(await sha256Hex(token)).first<{id:string;project_id:string;allowed_products_json:string;branding_json:string;project_name:string}>();
  if(!row)return null;
  const domains=await env.DB.prepare('SELECT hostname FROM embed_domains WHERE embed_id=?1').bind(row.id).all<{hostname:string}>();
  const allowedDomains=domains.results.map(d=>d.hostname);
  if(await validEmbedSession(env,session,row.id))return{...row,domains:allowedDomains};
  const actual=requestHost(request);if(!actual||!domains.results.some(d=>validDomain(actual,d.hostname)))return null;return{...row,domains:allowedDomains};
}

export async function embedPage(request:Request,env:Env,token:string,rid:string):Promise<Response>{
  const embed=await authorizedEmbed(request,env,token);if(!embed)return error(403,'embed_denied','Este domínio não está autorizado.',rid);
  const assets=await env.DB.prepare(`SELECT a.id,a.type,a.title,a.mime_type,c.captured_at,EXISTS(SELECT 1 FROM asset_variants v WHERE v.asset_id=a.id AND v.status='ready') has_variant FROM assets a LEFT JOIN captures c ON c.id=a.capture_id WHERE a.project_id=?1 AND a.status='published' ORDER BY c.captured_at DESC,a.created_at DESC`).bind(embed.project_id).all();
  const allowed=safeProducts(embed.allowed_products_json);const visible=(assets.results as any[]).filter(a=>!allowed.length||allowed.includes(a.id)||allowed.includes(a.type));
  const session=await issueEmbedSession(env,embed.id),nonce=randomToken(12),ancestors=embed.domains.flatMap(d=>[`https://${d}`,`https://*.${d}`]).join(' '),branding=safeObject(embed.branding_json),brand=branding.name||'PJJ Portal',accent=/^#[0-9a-f]{6}$/i.test(String(branding.accent||''))?String(branding.accent):'#173f35',brandLogo=branding.logo===true?`<img src="/api/embed/${token}/logo?session=${encodeURIComponent(session)}" alt="">`:'';
  const items=visible.map((a:any)=>`<article><div><small>${a.captured_at?escapeHtml(new Date(a.captured_at).toLocaleDateString('pt-BR')):'PRODUTO PJJ'}</small><strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.type)}${a.has_variant?' · visualização otimizada':''}</span></div><a href="/embed/${token}/assets/${a.id}?session=${encodeURIComponent(session)}">Explorar</a></article>`).join('');
  const powered=branding.poweredBy===false?'':`<footer>Entregue com tecnologia PJJ Produções</footer>`;
  const markup=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(embed.project_name)}</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f3f3ee;color:#172620;font:15px/1.5 system-ui}.head{padding:24px clamp(18px,4vw,42px);background:${accent};color:#fff}.brandline{display:flex;align-items:center;gap:10px}.brandline img{width:auto;height:34px;max-width:150px;object-fit:contain}.head small{opacity:.86;text-transform:uppercase;letter-spacing:.12em}.head h1{font-size:clamp(25px,5vw,44px);margin:8px 0}.grid{padding:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}article{display:flex;flex-direction:column;min-height:170px;background:#fff;padding:19px;border:1px solid #dddcd5;border-radius:15px}article small,article span{display:block;color:#6f756f}article strong{display:block;font-size:19px;margin:8px 0}article a{margin-top:auto;align-self:flex-start;background:${accent};color:#fff;text-decoration:none;border-radius:8px;padding:9px 13px;font-weight:750}footer{padding:12px 20px;text-align:center;color:#6f756f;font-size:12px}</style></head><body><header class="head"><div class="brandline">${brandLogo}<small>${escapeHtml(brand)}</small></div><h1>${escapeHtml(embed.project_name)}</h1></header><main class="grid">${items||'<article>Nenhum produto publicado.</article>'}</main>${powered}</body></html>`;
  await audit(env,{requestId:rid,actorType:'embed',actorId:embed.id,action:'embed.viewed',targetType:'project',targetId:embed.project_id,metadata:{host:requestHost(request)}});
  const response=html(markup,nonce);response.headers.set('content-security-policy',`default-src 'none'; img-src 'self'; style-src 'nonce-${nonce}'; frame-ancestors ${ancestors}; base-uri 'none'`);response.headers.delete('x-frame-options');return response;
}

export async function embedAsset(request:Request,env:Env,token:string,assetId:string,rid:string):Promise<Response>{
  const url=new URL(request.url),session=url.searchParams.get('session'),variant=url.searchParams.get('variant');
  if(variant&&!/^[a-z0-9_-]{1,64}$/.test(variant))return error(400,'invalid_variant','Variante inválida.',rid);
  const embed=await authorizedEmbed(request,env,token,session);if(!embed)return error(403,'embed_denied','Este domínio não está autorizado.',rid);
  const allowed=safeProducts(embed.allowed_products_json);
  const row=await env.DB.prepare(`SELECT a.type,a.original_drive_file_id,a.mime_type,a.original_name,v.drive_file_id variant_drive_file_id,v.mime_type variant_mime_type FROM assets a LEFT JOIN asset_variants v ON v.asset_id=a.id AND v.variant_type=?3 AND v.status='ready' WHERE a.id=?1 AND a.project_id=?2 AND a.status='published'`).bind(assetId,embed.project_id,variant).first<{type:string;original_drive_file_id:string|null;mime_type:string|null;original_name:string;variant_drive_file_id:string|null;variant_mime_type:string|null}>();
  if(!row)return error(404,'asset_not_found','Arquivo não encontrado.',rid);if(allowed.length&&!allowed.includes(assetId)&&!allowed.includes(row.type))return error(403,'product_denied','Este produto não está liberado no embed.',rid);
  const branding=safeObject(embed.branding_json),canDownload=branding.downloads===true,fileId=variant?row.variant_drive_file_id:row.original_drive_file_id,mime=(variant?row.variant_mime_type:row.mime_type)||'application/octet-stream';
  if(!fileId)return error(409,variant?'variant_not_ready':'file_not_ready','A visualização ainda não está pronta.',rid);if(!variant&&!canDownload&&!safeInlineMime(mime))return error(403,'download_disabled','Este embed permite somente visualização.',rid);
  const range=request.headers.get('range');if(!validByteRange(range))return error(416,'invalid_range','O intervalo solicitado é inválido.',rid);const upstream=await streamFile(env,fileId,range,request.method==='HEAD'?'HEAD':'GET');if(!upstream.ok&&upstream.status!==206)return error(502,'drive_stream_failed','Falha ao transmitir.',rid);
  const inline=!!variant||!canDownload||safeInlineMime(mime),headers=new Headers({'content-type':mime,'cache-control':'private, no-store','accept-ranges':'bytes','content-disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,'content-security-policy':"sandbox; default-src 'none'",'x-content-type-options':'nosniff'});for(const h of ['content-length','content-range','etag','last-modified']){const v=upstream.headers.get(h);if(v)headers.set(h,v)}await audit(env,{requestId:rid,actorType:'embed',actorId:embed.id,action:variant||!canDownload?'asset.viewed':'asset.downloaded',targetType:'asset',targetId:assetId,metadata:{variant:variant||null}});return new Response(request.method==='HEAD'?null:upstream.body,{status:upstream.status,headers});
}

export async function embedLogo(request:Request,env:Env,token:string,rid:string):Promise<Response>{
  const session=new URL(request.url).searchParams.get('session'),embed=await authorizedEmbed(request,env,token,session);if(!embed)return error(403,'embed_denied','Este domínio não está autorizado.',rid);
  const embedBrand=safeObject(embed.branding_json);if(embedBrand.logo!==true)return error(404,'logo_not_found','Identidade visual não configurada.',rid);
  const client=await env.DB.prepare(`SELECT c.logo_drive_file_id,c.branding_json FROM projects p JOIN clients c ON c.id=p.client_id WHERE p.id=?1`).bind(embed.project_id).first<{logo_drive_file_id:string|null;branding_json:string}>();
  if(!client?.logo_drive_file_id)return error(404,'logo_not_found','Identidade visual não configurada.',rid);const clientBrand=safeObject(client.branding_json),mime=String(clientBrand.logoMime||'');
  if(!['image/png','image/jpeg','image/webp'].includes(mime))return error(409,'logo_invalid','Identidade visual indisponível.',rid);
  const range=request.headers.get('range');if(!validByteRange(range))return error(416,'invalid_range','O intervalo solicitado é inválido.',rid);const upstream=await streamFile(env,client.logo_drive_file_id,range,request.method==='HEAD'?'HEAD':'GET');if(!upstream.ok&&upstream.status!==206)return error(502,'drive_stream_failed','Falha ao transmitir a identidade visual.',rid);
  const headers=new Headers({'content-type':mime,'cache-control':'private, no-store','accept-ranges':'bytes','content-disposition':'inline','content-security-policy':"sandbox; default-src 'none'",'x-content-type-options':'nosniff'});for(const name of ['content-length','content-range','etag','last-modified']){const value=upstream.headers.get(name);if(value)headers.set(name,value)}return new Response(request.method==='HEAD'?null:upstream.body,{status:upstream.status,headers});
}

export async function embedViewer(request:Request,env:Env,token:string,assetId:string,rid:string):Promise<Response>{
  const session=new URL(request.url).searchParams.get('session'),embed=await authorizedEmbed(request,env,token,session);if(!embed)return error(403,'embed_denied','Este domínio não está autorizado.',rid);
  const row=await env.DB.prepare(`SELECT a.id,a.type,a.title,a.metadata_json,a.downloadable FROM assets a WHERE a.id=?1 AND a.project_id=?2 AND a.status='published'`).bind(assetId,embed.project_id).first<{id:string;type:string;title:string;metadata_json:string|null;downloadable:number}>();
  if(!row)return error(404,'asset_not_found','Produto não encontrado.',rid);const allowed=safeProducts(embed.allowed_products_json);if(allowed.length&&!allowed.includes(assetId)&&!allowed.includes(row.type))return error(403,'product_denied','Este produto não está liberado no embed.',rid);
  const preferred=row.type==='model_3d'?'optimized_glb':row.type==='point_cloud'?'copc':['orthophoto','dsm','dtm'].includes(row.type)?'cog':null,variant=preferred?await env.DB.prepare("SELECT variant_type FROM asset_variants WHERE asset_id=?1 AND variant_type=?2 AND status='ready'").bind(assetId,preferred).first<{variant_type:string}>():null,branding=safeObject(embed.branding_json),ancestors=embed.domains.flatMap(d=>[`https://${d}`,`https://*.${d}`]).join(' '),base=`/api/embed/${token}/assets/${assetId}/content`,sessionQuery=`session=${encodeURIComponent(session||'')}`;
  await audit(env,{requestId:rid,actorType:'embed',actorId:embed.id,action:'asset.viewer_opened',targetType:'asset',targetId:assetId});
  return deliveryViewer({title:row.title,type:row.type,metadataJson:row.metadata_json,contentUrl:preferred&&!variant?null:`${base}?${sessionQuery}${variant?`&variant=${encodeURIComponent(variant.variant_type)}`:''}`,downloadUrl:branding.downloads===true?`${base}?${sessionQuery}`:null,brand:branding.name||'PJJ Portal',logoUrl:branding.logo===true?`/api/embed/${token}/logo?${sessionQuery}`:null,accent:branding.accent,frameAncestors:ancestors});
}
function escapeHtml(v:unknown):string{return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))}
