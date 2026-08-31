import { constantTimeEqual, randomToken } from './crypto';

// A bounded cost is required in Workers so authentication cannot exhaust the
// request CPU budget. MFA and login throttling provide the additional layers.
const ITERATIONS = 100_000;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt.buffer as ArrayBuffer, iterations }, key, 256);
  let value = '';
  for (const byte of new Uint8Array(bits)) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 128) throw new Error('weak_password');
  const saltText = randomToken(16);
  const salt = Uint8Array.from(atob(saltText.replace(/-/g, '+').replace(/_/g, '/') + '=='), char => char.charCodeAt(0));
  return `pbkdf2-sha256$${ITERATIONS}$${saltText}$${await derive(password, salt, ITERATIONS)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, expected] = encoded.split('$');
  if (algorithm !== 'pbkdf2-sha256' || !iterationsText || !saltText || !expected) return false;
  const iterations = Number(iterationsText);
  if (!Number.isSafeInteger(iterations) || iterations < ITERATIONS) return false;
  const salt = Uint8Array.from(atob(saltText.replace(/-/g, '+').replace(/_/g, '/') + '=='), char => char.charCodeAt(0));
  return constantTimeEqual(await derive(password, salt, iterations), expected);
}
