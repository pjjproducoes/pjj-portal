import { describe, expect, it } from 'vitest';
import { constantTimeEqual, decrypt, encrypt, randomToken, sha256Hex } from '../src/crypto';
import { hashPassword, verifyPassword } from '../src/password';

describe('cryptographic primitives', () => {
  it('generates independent opaque tokens', () => {
    const first = randomToken();
    const second = randomToken();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.length).toBeGreaterThanOrEqual(40);
  });

  it('hashes and compares without plaintext shortcuts', async () => {
    expect(await sha256Hex('pjj')).toHaveLength(64);
    expect(await constantTimeEqual('same', 'same')).toBe(true);
    expect(await constantTimeEqual('same', 'different')).toBe(false);
  });

  it('encrypts authenticated values and rejects tampering', async () => {
    const key = randomToken(32);
    const ciphertext = await encrypt('private-drive-session-url', key);
    expect(ciphertext).not.toContain('private-drive-session-url');
    expect(await decrypt(ciphertext, key)).toBe('private-drive-session-url');
    await expect(decrypt(ciphertext.slice(0, -2) + 'aa', key)).rejects.toBeTruthy();
  });
});

describe('password hashing', () => {
  it('uses a salted, versioned representation', async () => {
    const first = await hashPassword('Uma senha realmente forte 2026!');
    const second = await hashPassword('Uma senha realmente forte 2026!');
    expect(first).not.toBe(second);
    expect(first.startsWith('pbkdf2-sha256$100000$')).toBe(true);
    expect(await verifyPassword('Uma senha realmente forte 2026!', first)).toBe(true);
    expect(await verifyPassword('senha errada', first)).toBe(false);
  });

  it('rejects weak passwords', async () => {
    await expect(hashPassword('curta')).rejects.toThrow('weak_password');
  });
});
