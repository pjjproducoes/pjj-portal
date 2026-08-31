import { describe, expect, it } from 'vitest';
import { hostname, validDomain } from '../src/embeds';

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
