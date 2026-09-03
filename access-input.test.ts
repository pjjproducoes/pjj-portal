import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/audit', () => ({ audit: vi.fn(async () => {}) }));

import { createGrant } from '../src/share';

describe('access issuance validation', () => {
  const db = { prepare() { const statement = { bind() { return statement; }, async first() { return { id: 'project-1' }; } }; return statement; } };
  const actor = { role: 'owner', userId: 'owner-1' } as never;

  it('rejects an already-expired private link', async () => {
    const request = new Request('https://portal.test/api/admin/grants', { method: 'POST', body: JSON.stringify({ projectId: 'project-1', expiresAt: '2020-01-01T00:00:00Z' }) });
    const response = await createGrant(request, { DB: db, PUBLIC_ORIGIN: 'https://portal.test' } as never, actor, 'request-1');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_expiry' } });
  });

  it('rejects a non-positive use limit before persisting the grant', async () => {
    const request = new Request('https://portal.test/api/admin/grants', { method: 'POST', body: JSON.stringify({ projectId: 'project-1', maxUses: 0 }) });
    const response = await createGrant(request, { DB: db, PUBLIC_ORIGIN: 'https://portal.test' } as never, actor, 'request-1');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'invalid_max_uses' } });
  });
});
