import type { Env } from './env';
import type { Principal } from './auth';
import { deliveryViewer } from './delivery-viewer';
import { error } from './http';

export async function viewerPage(env:Env,actor:Principal,assetId:string,rid:string):Promise<Response>{
  const asset=await env.DB.prepare(`SELECT a.id,a.type,a.title,a.mime_type,a.status,a.downloadable,a.metadata_json,
      (SELECT m.permission FROM project_members m WHERE m.project_id=p.id AND m.user_id=?3) member_permission FROM assets a JOIN projects p ON p.id=a.project_id
    WHERE a.id=?1 AND a.status!='trashed' AND (?2 IN ('owner','admin') OR (a.status='published' AND EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=?3)))`)
    .bind(assetId,actor.role,actor.userId).first<{id:string;type:string;title:string;mime_type:string|null;status:string;downloadable:number;metadata_json:string|null;member_permission:string|null}>();
  if(!asset)return error(404,'asset_not_found','Produto não encontrado.',rid);
  const preferred=asset.type==='model_3d'?'optimized_glb':asset.type==='point_cloud'?'copc':['orthophoto','dsm','dtm'].includes(asset.type)?'cog':null;
  const variant=preferred?await env.DB.prepare("SELECT variant_type FROM asset_variants WHERE asset_id=?1 AND variant_type=?2 AND status='ready'").bind(assetId,preferred).first<{variant_type:string}>():null;
  const visualVariant=variant?.variant_type;
  const contentUrl=preferred&&!visualVariant?null:`/api/portal/assets/${assetId}/content${visualVariant?`?variant=${encodeURIComponent(visualVariant)}`:'?inline=1'}`;
  return deliveryViewer({
    title:asset.title,
    type:asset.type,
    metadataJson:asset.metadata_json,
    contentUrl,
    downloadUrl:(['owner','admin'].includes(actor.role)||(asset.downloadable&&['download','manage'].includes(asset.member_permission||'')))?`/api/portal/assets/${assetId}/content`:null,
    brand:'PJJ Portal',
    frameAncestors:"'self'"
  });
}
