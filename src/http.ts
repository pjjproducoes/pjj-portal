const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'cache-control': 'no-store'
};

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

export function html(markup: string, nonce: string, status = 200): Response {
  return new Response(markup, { status, headers: {
    ...SECURITY_HEADERS,
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; img-src 'self' data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`
  }});
}

export function error(status: number, code: string, message: string, requestId: string): Response {
  return json({ error: { code, message, requestId } }, status);
}

export function requestId(request: Request): string {
  return request.headers.get('cf-ray') || crypto.randomUUID();
}

export function parseCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('cookie') || '';
  for (const part of cookies.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionCookie(value: string, maxAge: number): string {
  return `pjj_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return 'pjj_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}

export function safeInlineMime(value: string): boolean {
  return /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm)|audio\/(mpeg|mp4|ogg)|application\/pdf|model\/gltf-binary)$/.test(value.toLowerCase());
}

export async function readJson<T>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('payload_too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('payload_too_large');
  return JSON.parse(text) as T;
}
