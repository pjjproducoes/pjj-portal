import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/audit', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('../src/drive', () => ({ streamFile: vi.fn(async()=>new Response('pdf',{headers:{'content-type':'application/pdf'}})) }));

import { assetContent, portalProject } from '../src/portal';

describe('portal resource isolation', () => {
  const deniedDb = { prepare() { const statement = { bind() { return statement; }, async first() { return null; } }; return statement; } };
  const client = { role: 'client', userId: 'client-a' } as never;

  it('does not disclose a project outside the client membership', async () => {
    const response = await portalProject({ DB: deniedDb } as never, client, 'project-b', 'request-1');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'project_not_found' } });
  });

  it('does not disclose a file outside the client membership', async () => {
    const request = new Request('https://portal.test/api/portal/assets/asset-b/content');
    const response = await assetContent(request, { DB: deniedDb } as never, client, 'asset-b', 'request-1');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'asset_not_found' } });
  });

  it('does not turn project view permission into download permission', async () => {
    const db={prepare(){const statement={bind(){return statement},async first(){return{
      id:'asset-a',original_name:'relatorio.pdf',mime_type:'application/pdf',original_drive_file_id:'drive-a',
      downloadable:1,status:'published',member_permission:'view',variant_drive_file_id:null,variant_mime_type:null,format:null
    }}};return statement}};
    const request=new Request('https://portal.test/api/portal/assets/asset-a/content');
    const response=await assetContent(request,{DB:db} as never,client,'asset-a','request-2');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({error:{code:'download_disabled'}});
  });

  it('still permits safe inline viewing to a view-only member', async () => {
    const db={prepare(){const statement={bind(){return statement},async first(){return{
      id:'asset-a',original_name:'relatorio.pdf',mime_type:'application/pdf',original_drive_file_id:'drive-a',
      downloadable:1,status:'published',member_permission:'view',variant_drive_file_id:null,variant_mime_type:null,format:null
    }}};return statement}};
    const request=new Request('https://portal.test/api/portal/assets/asset-a/content?inline=1');
    const response=await assetContent(request,{DB:db} as never,client,'asset-a','request-3');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('inline');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
  });
});
