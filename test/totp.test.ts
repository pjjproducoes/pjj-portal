import { describe, expect, it } from 'vitest';
import { createTotpSecret, otpauthUri, verifyTotp } from '../src/totp';

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 vector truncated to six digits', async () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(await verifyTotp(secret, '287082', 59_000)).toBe(true);
    expect(await verifyTotp(secret, '000000', 59_000)).toBe(false);
  });

  it('creates authenticator-compatible enrollment data', () => {
    const secret = createTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri(secret, 'cliente@example.com')).toContain('issuer=PJJ%20Portal');
  });
});
