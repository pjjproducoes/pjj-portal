import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/audit',()=>({audit:vi.fn(async()=>{})}));
import { publishEntity, unpublishAsset } from '../src/lifecycle';

describe('publication workflow',()=>{
  beforeEach(()=>vi.clearAllMocks());

  it('publishes the approved asset, its capture and its project together',async()=>{
    const batched:Array<{sql:string;args:unknown[]}>=[];
    const db={
      prepare(sql:string){
        const statement={sql,args:[] as unknown[],bind(...args:unknown[]){statement.args=args;return statement},async first(){
          if(sql.includes('SELECT status,project_id,capture_id'))return {status:'review',project_id:'project-1',capture_id:'capture-1'};
          return null;
        },async run(){return {meta:{changes:1}}}};
        return statement;
      },
      async batch(statements:Array<{sql:string;args:unknown[]}>){batched.push(...statements);return []}
    };
    const response=await publishEntity({DB:db} as never,{role:'owner',userId:'owner-1'} as never,'asset','asset-1','request-1');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({id:'asset-1',status:'published',projectId:'project-1',captureId:'capture-1'});
    expect(batched.map(x=>x.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining('UPDATE assets'),expect.stringContaining('UPDATE projects'),expect.stringContaining('UPDATE captures')
    ]));
  });

  it('refuses to publish an asset that has not reached review',async()=>{
    const db={prepare(){const statement={bind(){return statement},async first(){return {status:'processing',project_id:'project-1',capture_id:null}}};return statement}};
    const response=await publishEntity({DB:db} as never,{role:'owner',userId:'owner-1'} as never,'asset','asset-1','request-1');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({error:{code:'asset_not_ready'}});
  });

  it('withdraws a published asset without deleting its Drive data',async()=>{
    const batched:Array<{sql:string}>=[];
    const db={prepare(sql:string){const statement={sql,bind(){return statement},async first(){return sql.includes('SELECT id,project_id')?{id:'asset-1',project_id:'project-1',capture_id:'capture-1',status:'published'}:null}};return statement},async batch(items:Array<{sql:string}>){batched.push(...items);return []}};
    const response=await unpublishAsset({DB:db} as never,{role:'owner',userId:'owner-1'} as never,'asset-1','request-1');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({id:'asset-1',status:'review'});
    expect(batched.map(x=>x.sql).some(sql=>sql.includes("UPDATE assets SET status='review'"))).toBe(true);
  });
});
