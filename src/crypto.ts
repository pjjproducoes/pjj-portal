function bytesToBase64Url(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

export function encodeBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

export function decodeBase64Url(value: string): string | null {
  try { return new TextDecoder().decode(base64UrlToBytes(value)); }
  catch { return null; }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signValue(value: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifyValue(value: string, signature: string, secret: string): Promise<boolean> {
  try {
    return crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      base64UrlToBytes(signature).buffer as ArrayBuffer,
      new TextEncoder().encode(value)
    );
  } catch { return false; }
}

export function randomToken(size = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function aesKey(encoded: string): Promise<CryptoKey> {
  const bytes = base64UrlToBytes(encoded);
  if (bytes.byteLength !== 32) throw new Error('invalid_data_encryption_key');
  return crypto.subtle.importKey('raw', bytes.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(value: string, encodedKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(encodedKey), new TextEncoder().encode(value));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decrypt(value: string, encodedKey: string): Promise<string> {
  const [version, iv, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !ciphertext) throw new Error('invalid_ciphertext');
  const ivBytes = base64UrlToBytes(iv);
  const ciphertextBytes = base64UrlToBytes(ciphertext);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes.buffer as ArrayBuffer },
    await aesKey(encodedKey),
    ciphertextBytes.buffer as ArrayBuffer
  );
  return new TextDecoder().decode(plain);
}

export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const a = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(left));
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(right));
  const av = new Uint8Array(a), bv = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i]! ^ bv[i]!;
  return diff === 0;
}
