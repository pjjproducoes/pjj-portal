import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/audit', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('../src/drive', () => ({ streamFile: vi.fn() }));

import { authenticateGrant, sharedAsset } from '../src/share';

describe('shared-link download boundary', () => {
  it('does not turn a view-only link into an attachment download', async () => {
    let queries = 0;
    const db = { prepare() { const statement = { bind() { return statement; }, async first() {
      queries += 1;
      if (queries === 1) return { session_id: 'session-1', id: 'grant-1', project_id: 'project-1', permission: 'view', project_name: 'Projeto' };
      return { original_drive_file_id: 'drive-1', original_name: 'dados.laz', mime_type: 'application/octet-stream', downloadable: 1 };
    }, async run() { return {}; } }; return statement; } };
    const request = new Request('https://portal.test/api/share/assets/asset-1/content', { headers: { cookie: 'pjj_share=session-token' } });
    const response = await sharedAsset(request, { DB: db } as never, 'asset-1', 'request-1');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'download_disabled' } });
  });

  it('atomically rejects a final use already consumed by another request', async () => {
    const statements: string[] = [];
    const db = { prepare(sql:string) { statements.push(sql); const statement = {
      bind() { return statement; },
      async first() {
        if (sql.includes('FROM rate_limits')) return null;
        if (sql.includes('FROM access_grants')) return {
          id:'grant-1', project_id:'project-1', pin_hash:null, permission:'view',
          expires_at:null, max_uses:1, use_count:0, project_name:'Projeto'
        };
        return null;
      },
      async run() {
        if (sql.startsWith('UPDATE access_grants SET use_count')) return { meta:{ changes:0 } };
        return { meta:{ changes:1 } };
      }
    }; return statement; } };
    const request = new Request('https://portal.test/api/share/auth', {
      method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ token:'valid-token' })
    });
    const response = await authenticateGrant(request, { DB:db } as never, 'request-2');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error:{ code:'grant_denied' } });
    expect(statements.some(sql => sql.startsWith('INSERT INTO sessions'))).toBe(false);
    expect(statements.find(sql => sql.startsWith('UPDATE access_grants SET use_count'))).toContain('use_count<max_uses');
  });
});
