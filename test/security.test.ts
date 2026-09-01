import { describe, expect, it } from 'vitest';
import { hostname, validDomain } from '../src/embeds';
import { safeInlineMime, sessionCookie, validByteRange } from '../src/http';

describe('embed domain isolation', () => {
  it('accepts the exact host and its subdomains', () => {
    expect(validDomain('cliente.com.br','cliente.com.br')).toBe(true);
    expect(validDomain('portal.cliente.com.br','cliente.com.br')).toBe(true);
  });

  it('rejects suffix confusion and malformed origins', () => {
    expect(validDomain('cliente.com.br.atacante.test','cliente.com.br')).toBe(false);
    expect(validDomain('outrocliente.com.br','cliente.com.br')).toBe(false);
    expect(hostname('não é uma URL')).toBeNull();
  });
});

describe('media and cookie hardening', () => {
  it('allows only known viewer media to render inline', () => {
    expect(safeInlineMime('image/jpeg')).toBe(true);
    expect(safeInlineMime('application/pdf')).toBe(true);
    expect(safeInlineMime('text/html')).toBe(false);
    expect(safeInlineMime('image/svg+xml')).toBe(false);
  });

  it('creates a strict secure session cookie', () => {
    const value = sessionCookie('token', 3600);
    expect(value).toContain('HttpOnly');
    expect(value).toContain('Secure');
    expect(value).toContain('SameSite=Strict');
  });

  it('accepts one bounded byte range and rejects amplification ranges', () => {
    expect(validByteRange('bytes=0-1048575')).toBe(true);
    expect(validByteRange('bytes=1048576-')).toBe(true);
    expect(validByteRange('bytes=-4096')).toBe(true);
    expect(validByteRange('bytes=10-1')).toBe(false);
    expect(validByteRange('bytes=0-1,20-30')).toBe(false);
    expect(validByteRange('items=0-1')).toBe(false);
  });
});
