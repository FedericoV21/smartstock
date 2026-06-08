import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE } from '@/app/api/pasarelas/integraciones/route';

const mockModuloGuard = vi.fn();
const mockGetTenantSession = vi.fn();
const mockPuedeGestionarEstructuraCajas = vi.fn();
const mockResolveAndValidateSucursalScope = vi.fn();

vi.mock('@/lib/modulos/guard', () => ({
  moduloGuard: (...args: unknown[]) => mockModuloGuard(...args),
}));

vi.mock('@/lib/api/tenant-session', () => ({
  getTenantSession: (...args: unknown[]) => mockGetTenantSession(...args),
}));

vi.mock('@/lib/api/cajas-config-permissions', () => ({
  puedeGestionarEstructuraCajas: (...args: unknown[]) => mockPuedeGestionarEstructuraCajas(...args),
}));

vi.mock('@/lib/api/sucursal-scope', () => ({
  resolveAndValidateSucursalScope: (...args: unknown[]) => mockResolveAndValidateSucursalScope(...args),
  idsSucursalesOperables: vi.fn(),
}));

vi.mock('@/lib/pasarelas/adapters', () => ({
  getPasarelaAdapter: vi.fn(),
}));

vi.mock('@/lib/pasarelas/secrets', () => ({
  encryptSecretsRecord: vi.fn(() => ({})),
  sanitizeIntegracion: vi.fn((row) => row),
}));

function dbParaBorrarIntegracionLegacy(current: Record<string, unknown>) {
  const currentBuilder = {
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: current, error: null }),
  };

  const transaccionesBuilder = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ count: 0, error: null }),
  };

  const deleteSecondEq = vi.fn().mockResolvedValue({ error: null });
  const deleteBuilder = {
    eq: vi.fn().mockReturnValue({ eq: deleteSecondEq }),
  };

  const legacySecondEq = vi.fn().mockResolvedValue({ error: null });
  const legacyUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ eq: legacySecondEq }),
  });

  const from = vi.fn((table: string) => {
    if (table === 'pasarela_integracion') {
      return {
        select: vi.fn().mockReturnValue(currentBuilder),
        delete: vi.fn().mockReturnValue(deleteBuilder),
      };
    }
    if (table === 'pasarela_transaccion') {
      return {
        select: vi.fn().mockReturnValue(transaccionesBuilder),
      };
    }
    if (table === 'mp_point_config') {
      return {
        update: legacyUpdate,
      };
    }
    throw new Error(`Tabla inesperada: ${table}`);
  });

  return {
    from,
    legacyUpdate,
  };
}

describe('DELETE /api/pasarelas/integraciones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModuloGuard.mockResolvedValue({ allowed: true });
    mockPuedeGestionarEstructuraCajas.mockResolvedValue(true);
    mockResolveAndValidateSucursalScope.mockResolvedValue({ ok: true, sucursalId: 'suc-1' });
  });

  it('apaga la configuracion legacy al borrar una integracion migrada', async () => {
    const db = dbParaBorrarIntegracionLegacy({
      id: 'int-1',
      tenant_id: 'tenant-1',
      sucursal_id: 'suc-1',
      origen_legacy: 'mp_point_config',
      legacy_config_id: 'legacy-point-1',
    });
    mockGetTenantSession.mockResolvedValue({
      tenantId: 'tenant-1',
      rol: 'admin',
      supabase: db,
    });

    const res = await DELETE(
      new Request('http://localhost/api/pasarelas/integraciones?id=int-1', { method: 'DELETE' }),
    );
    const json = (await res.json()) as { ok?: boolean };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(db.legacyUpdate).toHaveBeenCalledWith({ habilitado: false });
  });
});
