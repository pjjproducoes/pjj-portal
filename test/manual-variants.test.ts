import { beforeEach, describe, expect, it, vi } from 'vitest';

const drive=vi.hoisted(()=>({
  copyDriveFile:vi.fn(),ensureFolder:vi.fn(),privateDriveFileInfo:vi.fn(),streamFile:vi.fn(),trashDriveFile:vi.fn(async()=>{})
}));
vi.mock('../src/drive',()=>drive);
vi.mock('../src/audit',()=>({audit:vi.fn(async()=>{})}));
import { driveFileId, registerManualVariant } from '../src/manual-variants';

describe('manual registration of externally processed results',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    drive.ensureFolder.mockResolvedValue('processed-folder');
    drive.copyDriveFile.mockResolvedValue({id:'private-copy',name:'modelo.glb',mimeType:'model/gltf-binary',size:2048,md5Checksum:'abc',publiclyShared:false});
    drive.streamFile.mockResolvedValue(new Response(new Uint8Array([0x67,0x6c,0x54,0x46,2,0,0,0]),{status:206}));
  });

  it('accepts a Drive id or canonical private file URL',()=>{
    expect(driveFileId('1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(driveFileId('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view')).toBe('1AbCdEfGhIjKlMnOp');
    expect(driveFileId('https://example.com/not-drive')).toBeNull();
  });

  it('rejects a source that is public on Drive before copying it',async()=>{
    drive.privateDriveFileInfo.mockResolvedValue({id:'1AbCdEfGhIjKlMnOp',name:'modelo.glb',mimeType:'model/gltf-binary',size:2048,md5Checksum:null,publiclyShared:true});
    const db={prepare(){const statement={bind(){return statement},async first(){return{id:'asset-1',type:'model_3d',title:'Modelo',capture_id:null,project_id:'project-1',status:'received',project_folder:'project-folder',capture_folder:null}}};return statement}};
    const request=new Request('https://portal.test/api/admin/assets/asset-1/variants',{method:'POST',body:JSON.stringify({variantType:'optimized_glb',driveFile:'1AbCdEfGhIjKlMnOp',externallyValidated:true})});
    const response=await registerManualVariant(request,{DB:db} as never,{role:'owner',userId:'owner-1'} as never,'asset-1','request-1');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({error:{code:'drive_source_public'}});
    expect(drive.copyDriveFile).not.toHaveBeenCalled();
  });

  it('copies a valid GLB into the official private hierarchy and moves it to review',async()=>{
    drive.privateDriveFileInfo.mockResolvedValue({id:'1AbCdEfGhIjKlMnOp',name:'modelo.glb',mimeType:'model/gltf-binary',size:2048,md5Checksum:'abc',publiclyShared:false});
    const batches:Array<Array<{sql:string}>>=[];
    const db={prepare(sql:string){const statement={sql,bind(){return statement},async first(){return sql.includes('SELECT a.id,a.type')?{id:'asset-1',type:'model_3d',title:'Modelo',capture_id:'capture-1',project_id:'project-1',status:'received',project_folder:'project-folder',capture_folder:'capture-folder'}:null}};return statement},async batch(items:Array<{sql:string}>){batches.push(items);return[]}};
    const request=new Request('https://portal.test/api/admin/assets/asset-1/variants',{method:'POST',body:JSON.stringify({variantType:'optimized_glb',driveFile:'1AbCdEfGhIjKlMnOp',externallyValidated:true})});
    const response=await registerManualVariant(request,{DB:db} as never,{role:'owner',userId:'owner-1'} as never,'asset-1','request-1');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({assetId:'asset-1',variant:{type:'optimized_glb',status:'ready'},status:'review'});
    expect(drive.copyDriveFile).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({parentId:'processed-folder',assetId:'asset-1'}));
    expect(batches[0]!.map(x=>x.sql)).toEqual(expect.arrayContaining([expect.stringContaining('INSERT INTO asset_variants'),expect.stringContaining("UPDATE assets SET status='review'")]));
  });
});
