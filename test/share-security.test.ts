import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/audit', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('../src/drive', () => ({ streamFile: vi.fn() }));

import { sharedAsset } from '../src/share';

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
});
