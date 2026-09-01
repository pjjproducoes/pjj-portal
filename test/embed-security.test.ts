import { describe, expect, it } from 'vitest';
import { hostname, validDomain } from '../src/embeds';

describe('embed domain boundaries', () => {
  it('accepts the configured host and its legitimate subdomains', () => {
    expect(validDomain('cliente.com.br', 'cliente.com.br')).toBe(true);
    expect(validDomain('portal.cliente.com.br', 'cliente.com.br')).toBe(true);
  });

  it('rejects suffix lookalikes and unrelated origins', () => {
    expect(validDomain('cliente.com.br.evil.example', 'cliente.com.br')).toBe(false);
    expect(validDomain('evilcliente.com.br', 'cliente.com.br')).toBe(false);
    expect(validDomain('outro.com.br', 'cliente.com.br')).toBe(false);
  });

  it('normalizes valid URLs and rejects malformed configured domains', () => {
    expect(hostname('https://WWW.Cliente.com.br/path')).toBe('www.cliente.com.br');
    expect(hostname('not a url')).toBeNull();
  });
});
