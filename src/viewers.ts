import type { Env } from './env';
import type { Principal } from './auth';
import { deliveryViewer } from './delivery-viewer';
import { error } from './http';

export async function viewerPage(env:Env,actor:Principal,assetId:string,rid:string):Promise<Response>{
  const asset=await env.DB.prepare(`SELECT a.id,a.project_id,a.type,a.title,a.mime_type,a.status,a.downloadable,a.metadata_json,
      (SELECT m.permission FROM project_members m WHERE m.project_id=p.id AND m.user_id=?3) member_permission FROM assets a JOIN projects p ON p.id=a.project_id
    WHERE a.id=?1 AND a.status!='trashed' AND (?2 IN ('owner','admin') OR (a.status='published' AND EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?3)))`)
    .bind(assetId,actor.role,actor.userId).first<{id:string;project_id:string;type:string;title:string;mime_type:string|null;status:string;downloadable:number;metadata_json:string|null;member_permission:string|null}>();
  if(!asset)return error(404,'asset_not_found','Produto não encontrado.',rid);
  const preferred=asset.type==='model_3d'?'optimized_glb':asset.type==='point_cloud'?'copc':['orthophoto','dsm','dtm'].includes(asset.type)?'cog':null;
  const variant=preferred?await env.DB.prepare("SELECT variant_type FROM asset_variants WHERE asset_id=?1 AND variant_type=?2 AND status='ready'").bind(assetId,preferred).first<{variant_type:string}>():null;
  const related=await env.DB.prepare(`SELECT a.id,a.type,a.title,c.captured_at FROM assets a LEFT JOIN captures c ON c.id=a.capture_id
    WHERE a.project_id=?1 AND a.status!='trashed' AND (?2 IN ('owner','admin') OR a.status='published') ORDER BY c.captured_at DESC,a.created_at DESC LIMIT 200`)
    .bind(asset.project_id,actor.role).all<{id:string;type:string;title:string;captured_at:string|null}>();
  const visualVariant=variant?.variant_type;
  const contentUrl=preferred&&!visualVariant?null:`/api/portal/assets/${assetId}/content${visualVariant?`?variant=${encodeURIComponent(visualVariant)}`:'?inline=1'}`;
  return deliveryViewer({
    title:asset.title,
    type:asset.type,
    metadataJson:asset.metadata_json,
    contentUrl,
    downloadUrl:(['owner','admin'].includes(actor.role)||(asset.downloadable&&['download','manage'].includes(asset.member_permission||'')))?`/api/portal/assets/${assetId}/content`:null,
    brand:'PJJ Portal',
    navigation:related.results.map(item=>({url:`/viewer/${item.id}`,label:`${item.captured_at?item.captured_at.slice(0,10)+' · ':''}${item.type.replaceAll('_',' ')} · ${item.title}`,current:item.id===assetId})),
    frameAncestors:"'self'"
  });
}
