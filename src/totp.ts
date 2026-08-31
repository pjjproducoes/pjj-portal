const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function createTotpSecret(bytes = 20): string {
  const input = crypto.getRandomValues(new Uint8Array(bytes));
  let bits = '', result = '';
  for (const byte of input) bits += byte.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) result += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]!;
  return result;
}

function decodeBase32(value: string): Uint8Array {
  let bits = '';
  for (const char of value.replace(/=+$/g, '').toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('invalid_totp_secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const output = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < output.length; i++) output[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return output;
}

async function codeAt(secret: string, counter: number): Promise<string> {
  const message = new ArrayBuffer(8);
  const view = new DataView(message);
  view.setUint32(4, counter, false);
  const raw = decodeBase32(secret);
  const key = await crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = digest[digest.length - 1]! & 15;
  const number = ((digest[offset]! & 127) << 24 | digest[offset + 1]! << 16 | digest[offset + 2]! << 8 | digest[offset + 3]!) % 1_000_000;
  return number.toString().padStart(6, '0');
}

export async function verifyTotp(secret: string, supplied: string, now = Date.now()): Promise<boolean> {
  if (!/^\d{6}$/.test(supplied)) return false;
  const counter = Math.floor(now / 30_000);
  for (const drift of [-1, 0, 1]) if (await codeAt(secret, counter + drift) === supplied) return true;
  return false;
}

export function otpauthUri(secret: string, email: string): string {
  const issuer = 'PJJ Portal';
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
