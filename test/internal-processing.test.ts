import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/drive', () => ({ driveAccessToken: vi.fn() }));

import { sha256Hex } from '../src/crypto';
import { internalRoute } from '../src/internal';

describe('stateless processing endpoint', () => {
  it('does not expose a heartbeat route to a processor', async () => {
    const privateKey = 'processor-test-key';
    const token = await sha256Hex(`${privateKey}|pjj-processor-v1`);
    const request = new Request('https://portal.test/api/internal/jobs/11111111-1111-4111-8111-111111111111/heartbeat', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ progress: 50 })
    });
    const response = await internalRoute(request, {
      DRIVE_SERVICE_ACCOUNT_JSON: JSON.stringify({ private_key: privateKey })
    } as never, 'request-1');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'not_found' } });
  });
});
