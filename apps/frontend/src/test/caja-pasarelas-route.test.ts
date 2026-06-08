import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/configuracion/cajas/[id]/pasarelas/route';

const mockModuloGuard = vi.fn();
const mockGetTenantSession = vi.fn();
const mockIdsSucursalesOperables = vi.fn();

vi.mock('@/lib/modulos/guard', () => ({
  moduloGuard: (...args: unknown[]) => mockModuloGuard(...args),
}));

vi.mock('@/lib/api/tenant-session', () => ({
  getTenantSession: (...args: unknown[]) => mockGetTenantSession(...args),
}));

vi.mock('@/lib/api/sucursal-scope', () => ({
  idsSucursalesOperables: (...args: unknown[]) => mockIdsSucursalesOperables(...args),
}));

vi.mock('@/lib/pasarelas/secrets', () => ({
  sanitizeIntegracion: vi.fn((row) => row),
}));

function dbCajaPasarelas() {
  const cajaBuilder = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: 'caja-1',
        tenant_id: 'tenant-1',
        sucursal_id: 'suc-1',
        numero: 1,
        nombre: 'Caja 1',
        activa: true,
      },
      error: null,
    }),
  };

  const linksBuilder = {
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'link-ok',
          caja_id: 'caja-1',
          integracion_id: 'int-ok',
          habilitado: true,
          alias: null,
          orden: 10,
        },
        {
          id: 'link-old',
          caja_id: 'caja-1',
          integracion_id: 'int-old',
          habilitado: true,
          alias: null,
          orden: 20,
        },
      ],
      error: null,
    }),
  };

  const integracionesBuilder = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'int-ok',
          tenant_id: 'tenant-1',
          sucursal_id: 'suc-1',
          proveedor: 'mercado_pago',
          canal: 'qr',
          tipo: 'mp_qr',
          nombre: 'QR',
          estado: 'activa',
          config_publica: {},
        },
        {
          id: 'int-old',
          tenant_id: 'tenant-1',
          sucursal_id: 'suc-2',
          proveedor: 'mercado_pago',
          canal: 'terminal',
          tipo: 'mp_point',
          nombre: 'Mercado Pago Point',
          estado: 'activa',
          config_publica: {},
        },
      ],
      error: null,
    }),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'caja') return { select: vi.fn().mockReturnValue(cajaBuilder) };
      if (table === 'pasarela_caja') return { select: vi.fn().mockReturnValue(linksBuilder) };
      if (table === 'pasarela_integracion') return { select: vi.fn().mockReturnValue(integracionesBuilder) };
      throw new Error(`Tabla inesperada: ${table}`);
    }),
  };
}

describe('GET /api/configuracion/cajas/[id]/pasarelas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModuloGuard.mockResolvedValue({ allowed: true });
    mockIdsSucursalesOperables.mockResolvedValue({ ok: true, ids: ['suc-1'] });
  });

  it('no devuelve enlaces viejos de integraciones de otra sucursal', async () => {
    mockGetTenantSession.mockResolvedValue({
      tenantId: 'tenant-1',
      supabase: dbCajaPasarelas(),
    });

    const res = await GET(
      new Request('http://localhost/api/configuracion/cajas/caja-1/pasarelas?solo_habilitadas=1'),
      { params: Promise.resolve({ id: 'caja-1' }) },
    );
    const json = (await res.json()) as { pasarelas?: Array<{ id: string }> };

    expect(res.status).toBe(200);
    expect(json.pasarelas?.map((p) => p.id)).toEqual(['int-ok']);
  });
});
