import type { Env } from './env';
import type { Principal } from './auth';
import { audit } from './audit';
import { constantTimeEqual, randomToken, sha256Hex } from './crypto';
import { streamFile } from './drive';
import { error, html, json, parseCookie, readJson } from './http';

const cookie=(v:string,max=86400)=>`pjj_share=${encodeURIComponent(v)}; Path=/api/share; HttpOnly; Secure; SameSite=Lax; Max-Age=${max}`;

export async function createGrant(request:Request,env:Env,actor:Principal,rid:string):Promise<Response>{
  let input:{projectId:string;label?:string;pin?:string;expiresAt?:string;maxUses?:number;permission?:'view'|'download'};try{input=await readJson(request)}catch{return error(400,'invalid_json','Dados inválidos.',rid)}
  const project=await env.DB.prepare("SELECT id FROM projects WHERE id=?1 AND status!='trashed'").bind(input.projectId).first();if(!project)return error(404,'project_not_found','Projeto não encontrado.',rid);
  if(input.pin&&!/^\d{4,10}$/.test(input.pin))return error(400,'invalid_pin','Use um PIN de 4 a 10 dígitos.',rid);
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
  const nonce=randomToken(12),markup=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Entrega PJJ</title><style nonce="${nonce}">body{margin:0;min-height:100vh;display:grid;place-items:center;background:#163f34;font:15px system-ui;color:#172620}.box{width:min(650px,92%);background:#fff;padding:32px;border-radius:20px}input,button{width:100%;padding:12px;margin-top:10px;border-radius:9px;border:1px solid #ccd5d0}button{background:#163f34;color:white;font-weight:700}#items{display:grid;gap:8px}a{padding:12px;background:#eef2ed;color:#173f35;border-radius:8px;font-weight:700}</style></head><body><main class="box"><h1>Entrega privada</h1><form id="access"><label>PIN, se solicitado</label><input id="pin" inputmode="numeric" autocomplete="one-time-code"><button>Acessar</button><p id="message"></p></form><section id="project" hidden><h2 id="name"></h2><div id="items"></div></section></main><script nonce="${nonce}">const token=${JSON.stringify(token)},f=document.querySelector('#access'),m=document.querySelector('#message');f.onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/share/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,pin:document.querySelector('#pin').value})}),d=await r.json();if(!r.ok){m.textContent=d.error?.message||'Acesso negado';return}f.hidden=true;load()};async function load(){const r=await fetch('/api/share/project'),d=await r.json();if(!r.ok){m.textContent=d.error?.message;return}document.querySelector('#project').hidden=false;document.querySelector('#name').textContent=d.project.name;document.querySelector('#items').innerHTML=d.assets.map(a=>'<a target="_blank" rel="noopener" href="/api/share/assets/'+a.id+'/content">'+(d.permission==='download'?'Baixar ':'Visualizar ')+a.title+'</a>').join('')||'Nenhum produto publicado.'}</script></body></html>`;return html(markup,nonce)
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
  const session=randomToken();await env.DB.batch([env.DB.prepare("INSERT INTO sessions(id,grant_id,token_hash,csrf_hash,expires_at,idle_expires_at) VALUES(?1,?2,?3,?4,datetime('now','+24 hours'),datetime('now','+30 minutes'))").bind(crypto.randomUUID(),grant.id,await sha256Hex(session),await sha256Hex(randomToken())),env.DB.prepare('UPDATE access_grants SET use_count=use_count+1 WHERE id=?1').bind(grant.id)]);
  await audit(env,{requestId:rid,actorType:'grant',actorId:grant.id,action:'grant.authenticated',targetType:'access_grant',targetId:grant.id,ipHash});
  return json({authenticated:true},200,{'set-cookie':cookie(session)});
}

async function grantSession(request:Request,env:Env){const token=parseCookie(request,'pjj_share');if(!token)return null;return env.DB.prepare(`SELECT g.id,g.project_id,g.permission,p.name project_name FROM sessions s JOIN access_grants g ON g.id=s.grant_id JOIN projects p ON p.id=g.project_id
 WHERE s.token_hash=?1 AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP AND s.idle_expires_at>CURRENT_TIMESTAMP AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>CURRENT_TIMESTAMP) AND p.status='published'`).bind(await sha256Hex(token)).first<any>()}

export async function sharedProject(request:Request,env:Env,rid:string):Promise<Response>{const g=await grantSession(request,env);if(!g)return error(401,'share_auth_required','Acesso expirado.',rid);const assets=await env.DB.prepare("SELECT id,title,type,status FROM assets WHERE project_id=?1 AND status='published' ORDER BY created_at DESC").bind(g.project_id).all();return json({project:{id:g.project_id,name:g.project_name},assets:assets.results,permission:g.permission})}
export async function sharedAsset(request:Request,env:Env,assetId:string,rid:string):Promise<Response>{const g=await grantSession(request,env);if(!g)return error(401,'share_auth_required','Acesso expirado.',rid);const a=await env.DB.prepare("SELECT original_drive_file_id,original_name,mime_type,downloadable FROM assets WHERE id=?1 AND project_id=?2 AND status='published'").bind(assetId,g.project_id).first<any>();if(!a||!a.original_drive_file_id)return error(404,'asset_not_found','Arquivo não encontrado.',rid);const download=g.permission==='download'&&a.downloadable;const upstream=await streamFile(env,a.original_drive_file_id,request.headers.get('range'));if(!upstream.ok&&upstream.status!==206)return error(502,'drive_stream_failed','Falha na transmissão.',rid);const h=new Headers({'content-type':a.mime_type||'application/octet-stream','cache-control':'private, no-store','content-disposition':`${download?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(a.original_name)}`,'x-content-type-options':'nosniff'});for(const k of ['content-length','content-range']){const v=upstream.headers.get(k);if(v)h.set(k,v)}await audit(env,{requestId:rid,actorType:'grant',actorId:g.id,action:download?'asset.downloaded':'asset.viewed',targetType:'asset',targetId:assetId});return new Response(upstream.body,{status:upstream.status,headers:h})}
