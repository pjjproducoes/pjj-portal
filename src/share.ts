import type { Env } from './env';
import type { Principal } from './auth';
import { audit } from './audit';
import { constantTimeEqual, randomToken, sha256Hex } from './crypto';
import { deliveryViewer } from './delivery-viewer';
import { streamFile } from './drive';
import { error, html, json, parseCookie, readJson, safeInlineMime, validByteRange } from './http';

const cookie=(v:string,max=86400)=>`pjj_share=${encodeURIComponent(v)}; Path=/api/share; HttpOnly; Secure; SameSite=Strict; Max-Age=${max}`;

export async function createGrant(request:Request,env:Env,actor:Principal,rid:string):Promise<Response>{
  let input:{projectId:string;label?:string;pin?:string;expiresAt?:string;maxUses?:number;permission?:'view'|'download'};try{input=await readJson(request)}catch{return error(400,'invalid_json','Dados inválidos.',rid)}
  const project=await env.DB.prepare("SELECT id FROM projects WHERE id=?1 AND status!='trashed'").bind(input.projectId).first();if(!project)return error(404,'project_not_found','Projeto não encontrado.',rid);
  if(input.pin&&!/^\d{4,10}$/.test(input.pin))return error(400,'invalid_pin','Use um PIN de 4 a 10 dígitos.',rid);
  if(input.permission&&input.permission!=='view'&&input.permission!=='download')return error(400,'invalid_permission','Permissão de link inválida.',rid);
  if(input.expiresAt&&(!Number.isFinite(Date.parse(input.expiresAt))||Date.parse(input.expiresAt)<=Date.now()))return error(400,'invalid_expiry','A validade precisa ser uma data futura.',rid);
  if(input.maxUses!==undefined&&(!Number.isSafeInteger(input.maxUses)||input.maxUses<1||input.maxUses>100000))return error(400,'invalid_max_uses','O limite de acessos é inválido.',rid);
  const token=randomToken(),tokenHash=await sha256Hex(token),id=crypto.randomUUID(),pinHash=input.pin?await sha256Hex(tokenHash+':'+input.pin):null;
  await env.DB.prepare('INSERT INTO access_grants(id,project_id,label,token_hash,pin_hash,permission,expires_at,max_uses,created_by) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)')
    .bind(id,input.projectId,input.label?.trim()||null,tokenHash,pinHash,input.permission||'view',input.expiresAt||null,input.maxUses||null,actor.userId).run();
  await audit(env,{requestId:rid,actorType:'admin',actorId:actor.userId,action:'grant.created',targetType:'access_grant',targetId:id});
  return json({grant:{id,projectId:input.projectId,pinRequired:!!input.pin,permission:input.permission||'view'},url:`${env.PUBLIC_ORIGIN}/share/${token}`},201);
}

async function grantFromToken(env:Env,token:string){return env.DB.prepare(`SELECT g.id,g.project_id,g.pin_hash,g.permission,g.expires_at,g.max_uses,g.use_count,p.name project_name
  FROM access_grants g JOIN projects p ON p.id=g.project_id WHERE g.token_hash=?1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>CURRENT_TIMESTAMP)
  AND (g.max_uses IS NULL OR g.use_count<g.max_uses) AND p.status='published'`).bind(await sha256Hex(token)).first<any>()}

export function sharePage(token:string):Response{
  const nonce=randomToken(12),markup=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Entrega PJJ</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#163f34;font:15px/1.5 system-ui;color:#172620;padding:clamp(18px,5vw,60px)}.box{width:min(920px,100%);margin:auto;background:#f7f7f3;padding:clamp(22px,5vw,46px);border-radius:20px}input,button{width:100%;padding:12px;margin-top:10px;border-radius:9px;border:1px solid #ccd5d0}button{background:#163f34;color:white;font-weight:700}#items{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}article{display:flex;flex-direction:column;min-height:145px;padding:17px;background:#fff;border:1px solid #dfe3de;border-radius:12px}article small{color:#647068}article strong{font-size:18px;margin:6px 0}article div{display:flex;gap:7px;margin-top:auto}a{padding:9px 11px;background:#173f35;color:#fff;border-radius:8px;font-weight:700;text-decoration:none}a.alt{background:#e9efeb;color:#173f35}</style></head><body><main class="box"><h1>Entrega privada</h1><form id="access"><label>PIN, se solicitado</label><input id="pin" inputmode="numeric" autocomplete="one-time-code"><button>Acessar</button><p id="message"></p></form><section id="project" hidden><h2 id="name"></h2><p>Produtos publicados e protegidos pela PJJ Produções.</p><div id="items"></div></section></main><script nonce="${nonce}">const token=${JSON.stringify(token)},f=document.querySelector('#access'),m=document.querySelector('#message');f.onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/share/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,pin:document.querySelector('#pin').value})}),d=await r.json();if(!r.ok){m.textContent=d.error?.message||'Acesso negado';return}f.hidden=true;load()};async function load(){const r=await fetch('/api/share/project'),d=await r.json();if(!r.ok){m.textContent=d.error?.message;return}document.querySelector('#project').hidden=false;document.querySelector('#name').textContent=d.project.name;const host=document.querySelector('#items');host.replaceChildren();if(!d.assets.length){host.textContent='Nenhum produto publicado.';return}for(const asset of d.assets){const card=document.createElement('article'),kind=document.createElement('small'),title=document.createElement('strong'),actions=document.createElement('div'),view=document.createElement('a');kind.textContent=String(asset.type||'produto').replaceAll('_',' ');title.textContent=asset.title||'Arquivo';view.target='_blank';view.rel='noopener';view.href='/api/share/assets/'+encodeURIComponent(asset.id)+'/viewer';view.textContent='Visualizar';actions.append(view);if(d.permission==='download'&&asset.downloadable){const download=document.createElement('a');download.className='alt';download.href='/api/share/assets/'+encodeURIComponent(asset.id)+'/content';download.textContent='Baixar';actions.append(download)}card.append(kind,title,actions);host.append(card)}}</script></body></html>`;return html(markup,nonce)
}

export async function authenticateGrant(request:Request,env:Env,rid:string):Promise<Response>{
  let input:{token:string;pin?:string};try{input=await readJson(request)}catch{return error(400,'invalid_json','Dados inválidos.',rid)}
  const ipHash=await sha256Hex(request.headers.get('cf-connecting-ip')||'unknown'),tokenHash=await sha256Hex(input.token||''),rateKey=`share:${ipHash}:${tokenHash.slice(0,16)}`;
  const rate=await env.DB.prepare('SELECT attempts,blocked_until FROM rate_limits WHERE key=?1').bind(rateKey).first<{attempts:number;blocked_until:string|null}>();
  if(rate?.blocked_until&&new Date(rate.blocked_until).getTime()>Date.now())return error(429,'temporarily_blocked','Muitas tentativas. Aguarde antes de tentar novamente.',rid);
  const grant=await grantFromToken(env,input.token||'');if(!grant)return error(403,'grant_denied','Link inválido, expirado ou esgotado.',rid);
  if(grant.pin_hash){const supplied=await sha256Hex(tokenHash+':'+(input.pin||''));if(!await constantTimeEqual(supplied,grant.pin_hash)){
    await env.DB.prepare(`INSERT INTO rate_limits(key,window_started_at,attempts,blocked_until) VALUES(?1,CURRENT_TIMESTAMP,1,NULL)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_started_at<datetime('now','-15 minutes') THEN 1 ELSE attempts+1 END,
      window_started_at=CASE WHEN window_started_at<datetime('now','-15 minutes') THEN CURRENT_TIMESTAMP ELSE window_started_at END,
      blocked_until=CASE WHEN attempts>=7 THEN datetime('now','+30 minutes') ELSE blocked_until END,updated_at=CURRENT_TIMESTAMP`).bind(rateKey).run();
    await audit(env,{requestId:rid,actorType:'grant',actorId:grant.id,action:'grant.pin_denied',targetType:'access_grant',targetId:grant.id,outcome:'denied',ipHash});
    return error(403,'invalid_pin','PIN inválido.',rid)
  }}
  await env.DB.prepare('DELETE FROM rate_limits WHERE key=?1').bind(rateKey).run();
  // Consume the grant with a conditional write. The token lookup above is only
  // an early rejection; this update is the concurrency boundary that prevents
  // two simultaneous requests from both consuming the final allowed use.
  const consumed=await env.DB.prepare(`UPDATE access_grants SET use_count=use_count+1 WHERE id=?1
    AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)
    AND (max_uses IS NULL OR use_count<max_uses)`).bind(grant.id).run();
  if(!consumed.meta.changes){
    await audit(env,{requestId:rid,actorType:'grant',actorId:grant.id,action:'grant.exhausted',targetType:'access_grant',targetId:grant.id,outcome:'denied',ipHash});
    return error(403,'grant_denied','Link inválido, expirado ou esgotado.',rid);
  }
  const session=randomToken();await env.DB.prepare("INSERT INTO sessions(id,grant_id,token_hash,csrf_hash,expires_at,idle_expires_at) VALUES(?1,?2,?3,?4,datetime('now','+24 hours'),datetime('now','+30 minutes'))").bind(crypto.randomUUID(),grant.id,await sha256Hex(session),await sha256Hex(randomToken())).run();
  await audit(env,{requestId:rid,actorType:'grant',actorId:grant.id,action:'grant.authenticated',targetType:'access_grant',targetId:grant.id,ipHash});
  return json({authenticated:true},200,{'set-cookie':cookie(session)});
}

async function grantSession(request:Request,env:Env){const token=parseCookie(request,'pjj_share');if(!token)return null;const row=await env.DB.prepare(`SELECT s.id session_id,g.id,g.project_id,g.permission,p.name project_name FROM sessions s JOIN access_grants g ON g.id=s.grant_id JOIN projects p ON p.id=g.project_id
 WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP AND s.idle_expires_at>CURRENT_TIMESTAMP AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>CURRENT_TIMESTAMP) AND p.status='published'`).bind(await sha256Hex(token)).first<any>();if(row)await env.DB.prepare("UPDATE sessions SET last_seen_at=CURRENT_TIMESTAMP,idle_expires_at=datetime('now','+30 minutes') WHERE id=?1").bind(row.session_id).run();return row}

export async function sharedProject(request:Request,env:Env,rid:string):Promise<Response>{const g=await grantSession(request,env);if(!g)return error(401,'share_auth_required','Acesso expirado.',rid);const assets=await env.DB.prepare("SELECT id,title,type,status,downloadable FROM assets WHERE project_id=?1 AND status='published' ORDER BY created_at DESC").bind(g.project_id).all();return json({project:{id:g.project_id,name:g.project_name},assets:assets.results,permission:g.permission})}

export async function sharedAsset(request:Request,env:Env,assetId:string,rid:string):Promise<Response>{
  const g=await grantSession(request,env);if(!g)return error(401,'share_auth_required','Acesso expirado.',rid);const variant=new URL(request.url).searchParams.get('variant');if(variant&&!/^[a-z0-9_-]{1,64}$/.test(variant))return error(400,'invalid_variant','Variante inválida.',rid);
  const a=await env.DB.prepare(`SELECT a.original_drive_file_id,a.original_name,a.mime_type,a.downloadable,v.drive_file_id variant_drive_file_id,v.mime_type variant_mime_type FROM assets a LEFT JOIN asset_variants v ON v.asset_id=a.id AND v.variant_type=?3 AND v.status='ready' WHERE a.id=?1 AND a.project_id=?2 AND a.status='published'`).bind(assetId,g.project_id,variant).first<any>();if(!a)return error(404,'asset_not_found','Arquivo não encontrado.',rid);
  const fileId=variant?a.variant_drive_file_id:a.original_drive_file_id,mime=(variant?a.variant_mime_type:a.mime_type)||'application/octet-stream',download=!variant&&g.permission==='download'&&a.downloadable,inline=!!variant||(!download&&safeInlineMime(mime));if(!fileId)return error(409,variant?'variant_not_ready':'file_not_ready','A visualização ainda não está pronta.',rid);if(!download&&!inline)return error(403,'download_disabled','Este link permite apenas visualizações compatíveis.',rid);
  const range=request.headers.get('range');if(!validByteRange(range))return error(416,'invalid_range','O intervalo solicitado é inválido.',rid);const upstream=await streamFile(env,fileId,range,request.method==='HEAD'?'HEAD':'GET');if(!upstream.ok&&upstream.status!==206)return error(502,'drive_stream_failed','Falha na transmissão.',rid);const h=new Headers({'content-type':mime,'cache-control':'private, no-store','accept-ranges':'bytes','content-disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(a.original_name)}`,'content-security-policy':"sandbox; default-src 'none'",'x-content-type-options':'nosniff'});for(const k of ['content-length','content-range','etag','last-modified']){const v=upstream.headers.get(k);if(v)h.set(k,v)}await audit(env,{requestId:rid,actorType:'grant',actorId:g.id,action:download?'asset.downloaded':'asset.viewed',targetType:'asset',targetId:assetId,metadata:{variant:variant||null}});return new Response(request.method==='HEAD'?null:upstream.body,{status:upstream.status,headers:h})
}

export async function sharedViewer(request:Request,env:Env,assetId:string,rid:string):Promise<Response>{
  const g=await grantSession(request,env);if(!g)return error(401,'share_auth_required','Acesso expirado.',rid);const a=await env.DB.prepare("SELECT id,type,title,metadata_json,downloadable FROM assets WHERE id=?1 AND project_id=?2 AND status='published'").bind(assetId,g.project_id).first<{id:string;type:string;title:string;metadata_json:string|null;downloadable:number}>();if(!a)return error(404,'asset_not_found','Produto não encontrado.',rid);
  const preferred=a.type==='model_3d'?'optimized_glb':a.type==='point_cloud'?'copc':['orthophoto','dsm','dtm'].includes(a.type)?'cog':null,variant=preferred?await env.DB.prepare("SELECT variant_type FROM asset_variants WHERE asset_id=?1 AND variant_type=?2 AND status='ready'").bind(assetId,preferred).first<{variant_type:string}>():null,base=`/api/share/assets/${assetId}/content`;
  const related=await env.DB.prepare(`SELECT a.id,a.type,a.title,c.captured_at FROM assets a LEFT JOIN captures c ON c.id=a.capture_id WHERE a.project_id=?1 AND a.status='published' ORDER BY c.captured_at DESC,a.created_at DESC LIMIT 200`).bind(g.project_id).all<{id:string;type:string;title:string;captured_at:string|null}>();
  await audit(env,{requestId:rid,actorType:'grant',actorId:g.id,action:'asset.viewer_opened',targetType:'asset',targetId:assetId});return deliveryViewer({title:a.title,type:a.type,metadataJson:a.metadata_json,contentUrl:preferred&&!variant?null:`${base}${variant?`?variant=${encodeURIComponent(variant.variant_type)}`:''}`,downloadUrl:g.permission==='download'&&a.downloadable?base:null,brand:'Entrega PJJ',navigation:related.results.map(item=>({url:`/api/share/assets/${item.id}/viewer`,label:`${item.captured_at?item.captured_at.slice(0,10)+' · ':''}${item.type.replaceAll('_',' ')} · ${item.title}`,current:item.id===assetId})),frameAncestors:"'self'"});
}
