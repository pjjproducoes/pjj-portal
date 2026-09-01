import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/audit', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('../src/drive', () => ({ streamFile: vi.fn() }));

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
});
