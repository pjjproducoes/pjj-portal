import { describe,expect,it,vi } from 'vitest';
vi.mock('../src/audit',()=>({audit:vi.fn(async()=>{})}));
vi.mock('../src/drive',()=>({createResumableUpload:vi.fn(),ensureFolder:vi.fn(),uploadChunk:vi.fn()}));
import { cancelUpload,inferAssetType,startUpload } from '../src/uploads';

describe('resumable upload lifecycle',()=>{
  it('recognizes DSM and DTM TIFFs instead of treating every GeoTIFF as orthophoto',()=>{
    expect(inferAssetType('dsm.tif','image/tiff','auto')).toBe('dsm');
    expect(inferAssetType('odm_dem_dtm.tif','image/tiff','auto')).toBe('dtm');
    expect(inferAssetType('odm_orthophoto.tif','image/tiff','auto')).toBe('orthophoto');
  });

  it('cancels the session and closes the related asset state',async()=>{
    const batched:Array<{sql:string;args:unknown[]}>=[];
    const db={prepare(sql:string){const s={sql,args:[] as unknown[],bind(...args:unknown[]){s.args=args;return s},async first(){return {asset_id:'asset-1'}}};return s},async batch(items:Array<{sql:string;args:unknown[]}>){batched.push(...items);return []}};
    const response=await cancelUpload({DB:db} as never,{role:'owner',userId:'owner-1'} as never,'upload-1','request-1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({status:'cancelled',assetId:'asset-1'});
    expect(batched.map(x=>x.sql)).toEqual(expect.arrayContaining([expect.stringContaining("status='cancelled'"),expect.stringContaining("error_code='upload_cancelled'")]));
  });

  it('does not pretend that an unknown upload was cancelled',async()=>{
    const db={prepare(){const s={bind(){return s},async first(){return null}};return s}};
    const response=await cancelUpload({DB:db} as never,{role:'owner',userId:'owner-1'} as never,'missing','request-1');
    expect(response.status).toBe(404);
  });

  it('returns the active Drive session for the same interrupted file',async()=>{
    const db={prepare(sql:string){const s={bind(){return s},async first(){
      if(sql.includes('FROM projects p'))return {id:'project-1',drive_folder_id:'folder-1'};
      if(sql.includes('FROM upload_sessions u JOIN assets'))return {upload_id:'upload-1',asset_id:'asset-1',received_bytes:8388608,chunk_size_bytes:8388608,total_bytes:16000000};
      return null;
    }};return s}};
    const request=new Request('https://portal.test/api/admin/uploads',{method:'POST',body:JSON.stringify({projectId:'project-1',type:'orthophoto',fileName:'obra.tif',sizeBytes:16000000})});
    const response=await startUpload(request,{DB:db,DRIVE_ROOT_FOLDER_ID:'root'} as never,{role:'owner',userId:'owner-1'} as never,'request-1');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({uploadId:'upload-1',assetId:'asset-1',receivedBytes:8388608,resumed:true});
  });
});
