import { describe, expect, it } from 'vitest';
import { adminV2 } from '../src/admin-v2';
import { portalV2 } from '../src/portal-v2';
import { institutional } from '../src/ui';

describe('administrative UI contract', () => {
  it('exposes the operational flow from cadastro to controlled delivery', async () => {
    const response = adminV2();
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('id="mfaDialog"');
    expect(body).toContain('id="clientDialog"');
    expect(body).toContain('id="projectDialog"');
    expect(body).toContain('id="captureDialog"');
    expect(body).toContain('id="uploadForm"');
    expect(body).toContain('/api/admin/uploads');
    expect(body).toContain('/api/admin/users');
    expect(body).toContain('/api/admin/grants');
    expect(body).toContain('/api/admin/embeds');
    expect(body).toContain('/api/admin/trash');
    expect(body).toContain('/api/auth/mfa/verify-login');
    expect(body).toContain('Revisar');
    expect(body).toContain('B2B2C / embeds');
    expect(body).toContain('Lixeira operacional');
  });
});

describe('client portal UI contract', () => {
  it('keeps private projects, campaigns, filters, comparison, MFA and controlled downloads', async () => {
    const response = portalV2();
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('/api/portal/projects');
    expect(body).toContain('/api/auth/mfa/verify-login');
    expect(body).toContain('Seus projetos');
    expect(body).toContain('Linha do tempo');
    expect(body).toContain('Comparar campanhas');
    expect(body).toContain('Visualizar');
    expect(body).toContain('Baixar');
    expect(body).toContain('access_permission');
  });
});

describe('institutional site contract', () => {
  it('positions PJJ correctly without inventing engineering credentials', async () => {
    const response = institutional();
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Produção audiovisual');
    expect(body).toContain('Imagens aéreas');
    expect(body).toContain('Soluções com drones');
    expect(body).toContain('Ortofoto');
    expect(body).toContain('Modelo 3D');
    expect(body).toContain('não se posiciona como empresa de engenharia');
    expect(body).toContain('/demonstracao');
  });
});
