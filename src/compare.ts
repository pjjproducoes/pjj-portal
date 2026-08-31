import type { Env } from './env';
import type { Principal } from './auth';
import { error, html } from './http';
import { randomToken } from './crypto';

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

export async function comparisonPage(env: Env, actor: Principal, projectId: string, rid: string): Promise<Response> {
  const project = await env.DB.prepare(`SELECT p.name FROM projects p WHERE p.id=?1 AND p.status!='trashed'
    AND (?2 IN ('owner','admin') OR (p.status='published' AND EXISTS(
      SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?3)))`)
    .bind(projectId, actor.role, actor.userId).first<{ name: string }>();
  if (!project) return error(404, 'project_not_found', 'Projeto não encontrado.', rid);
  const rows = await env.DB.prepare(`SELECT a.id,a.title,c.captured_at FROM assets a
    JOIN captures c ON c.id=a.capture_id JOIN asset_variants v ON v.asset_id=a.id
    WHERE a.project_id=?1 AND a.type='orthophoto' AND a.status='published'
      AND c.status='published' AND v.variant_type='cog' AND v.status='ready'
    ORDER BY c.captured_at`).bind(projectId).all<{ id: string; title: string; captured_at: string }>();
  if (rows.results.length < 2) return error(409, 'comparison_unavailable', 'Publique duas ortofotos processadas para comparar campanhas.', rid);
  const nonce = randomToken(12);
  const opts = (selected:number) => rows.results.map((row, index) => `<option value="${esc(row.id)}" ${index === selected ? 'selected' : ''}>${esc(row.captured_at)} — ${esc(row.title)}</option>`).join('');
  const markup = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Comparação — ${esc(project.name)}</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#0d1714;color:#fff;font:14px system-ui}.bar{min-height:68px;background:#173f35;padding:10px 18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}.bar h1{font-size:16px;margin:0 auto 0 0}.bar label{display:flex;gap:7px;align-items:center}.bar select{max-width:260px;background:#fff;color:#13231e;border:0;border-radius:7px;padding:8px}.viewer{height:calc(100vh - 102px);position:relative;overflow:hidden;display:grid;place-items:center}.layer{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden}.layer canvas{max-width:100%;max-height:100%}.top{clip-path:inset(0 50% 0 0)}.divider{position:absolute;top:0;bottom:0;left:50%;width:3px;background:#fff;box-shadow:0 0 10px #000}.slider{position:absolute;left:12px;right:12px;bottom:18px;width:calc(100% - 24px)}.status{height:34px;padding:8px 18px;color:#b8c9c2;background:#14211d}@media(max-width:760px){.bar label{width:100%}.bar select{flex:1;max-width:none}.viewer{height:calc(100vh - 166px)}}</style></head><body><header class="bar"><h1>${esc(project.name)} · antes/depois</h1><label>Antes <select id="before">${opts(0)}</select></label><label>Depois <select id="after">${opts(rows.results.length - 1)}</select></label></header><main class="viewer"><div class="layer"><canvas id="base"></canvas></div><div class="layer top" id="top"><canvas id="overlay"></canvas></div><div class="divider" id="divider"></div><input id="slider" class="slider" type="range" min="0" max="100" value="50" aria-label="Divisor da comparação"></main><footer class="status" id="status">Carregando campanhas…</footer><script type="module" nonce="${nonce}">import{fromUrl}from'https://esm.sh/geotiff@2.1.3';const $=s=>document.querySelector(s),status=$('#status');async function draw(id,canvas){const tif=await fromUrl('/api/portal/assets/'+id+'/content?variant=cog'),img=await tif.getImage(),w=img.getWidth(),h=img.getHeight(),scale=Math.min(1,2200/Math.max(w,h)),ow=Math.max(1,Math.round(w*scale)),oh=Math.max(1,Math.round(h*scale)),r=await img.readRasters({width:ow,height:oh,interleave:true,resampleMethod:'bilinear'}),n=img.getSamplesPerPixel(),out=new Uint8ClampedArray(ow*oh*4);for(let i=0;i<ow*oh;i++){out[i*4]=r[i*n];out[i*4+1]=r[i*n+1]??r[i*n];out[i*4+2]=r[i*n+2]??r[i*n];out[i*4+3]=255}canvas.width=ow;canvas.height=oh;canvas.getContext('2d').putImageData(new ImageData(out,ow,oh),0,0)}async function load(){status.textContent='Carregando campanhas…';try{await Promise.all([draw($('#before').value,$('#base')),draw($('#after').value,$('#overlay'))]);status.textContent='Arraste o controle para comparar'}catch(e){status.textContent='Falha ao abrir comparação: '+e.message}}function slide(){const n=$('#slider').value;$('#top').style.clipPath='inset(0 '+(100-n)+'% 0 0)';$('#divider').style.left=n+'%'}$('#before').onchange=load;$('#after').onchange=load;$('#slider').oninput=slide;load();</script></body></html>`;
  const response = html(markup, nonce);
  response.headers.set('content-security-policy', `default-src 'none'; script-src 'nonce-${nonce}' https://esm.sh; connect-src 'self' https://esm.sh; style-src 'nonce-${nonce}'; frame-ancestors 'self'; base-uri 'none'`);
  return response;
}
