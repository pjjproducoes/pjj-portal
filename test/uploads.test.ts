import { describe,expect,it,vi } from 'vitest';
vi.mock('../src/audit',()=>({audit:vi.fn(async()=>{})}));
import { cancelUpload } from '../src/uploads';

describe('resumable upload lifecycle',()=>{
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
});
