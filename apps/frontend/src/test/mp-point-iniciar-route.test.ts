import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/pagos/mp-point/iniciar/route';

const mockModuloGuard = vi.fn();
const mockGetTenantSession = vi.fn();
const mockRejectIfVisor = vi.fn();
const mockAuditLogPosnet = vi.fn();
const mockGetMpPointClient = vi.fn();
const mockLoadMpPointConfig = vi.fn();
const mockDecryptAccessToken = vi.fn();

vi.mock('@/lib/modulos/guard', () => ({
  moduloGuard: (...args: unknown[]) => mockModuloGuard(...args),
}));

vi.mock('@/lib/api/tenant-session', () => ({
  getTenantSession: (...args: unknown[]) => mockGetTenantSession(...args),
  rejectIfVisor: (...args: unknown[]) => mockRejectIfVisor(...args),
}));

vi.mock('@/lib/mp-point/audit-log', () => ({
  auditLogPosnet: (...args: unknown[]) => mockAuditLogPosnet(...args),
}));

vi.mock('@/lib/mp-point/client', () => ({
  getMpPointClient: (...args: unknown[]) => mockGetMpPointClient(...args),
  MpPointError: class MpPointError extends Error {
    status: number;
    code: string;

    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('@/lib/mp-point/load-config', () => ({
  loadMpPointConfig: (...args: unknown[]) => mockLoadMpPointConfig(...args),
  decryptAccessToken: (...args: unknown[]) => mockDecryptAccessToken(...args),
}));

function createSupabaseMock(total: number) {
  const maybeSingle = vi
    .fn()
    .mockResolvedValueOnce({
      data: {
        id: 'comp-1',
        tenant_id: 'tenant-1',
        sucursal_id: 'suc-1',
        estado: 'borrador',
        mp_point_intent_id: null,
        metodo_pago: null,
        total,
      },
      error: null,
    });

  const selectBuilder = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle,
  };

  const updateEqSecond = vi.fn().mockResolvedValue({ error: null });
  const updateBuilder = {
    eq: vi.fn().mockImplementation(() => ({
      eq: updateEqSecond,
    })),
  };

  const from = vi.fn((table: string) => {
    if (table !== 'comprobante') throw new Error(`Tabla inesperada: ${table}`);
    return {
      select: vi.fn().mockReturnValue(selectBuilder),
      update: vi.fn().mockReturnValue(updateBuilder),
    };
  });

  return { from };
}

describe('POST /api/pagos/mp-point/iniciar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModuloGuard.mockResolvedValue({ allowed: true });
    mockRejectIfVisor.mockReturnValue(null);
    mockLoadMpPointConfig.mockResolvedValue({
      data: { habilitado: true, device_id: 'DEV-1', access_token: 'encrypted-token' },
      error: null,
    });
    mockDecryptAccessToken.mockReturnValue('plain-token');
  });

  it.each([1499, 1500, 1501])(
    'acepta monto %s y crea intent en centavos (sin bloqueo por umbral)',
    async (monto) => {
      const supabase = createSupabaseMock(monto);
      mockGetTenantSession.mockResolvedValue({
        rol: 'admin',
        tenantId: 'tenant-1',
        supabase,
      });

      const createPaymentIntent = vi.fn().mockResolvedValue({
        id: 'intent-1',
        state: 'OPEN',
        amount: Math.round(monto * 100),
      });
      const listDevices = vi.fn().mockResolvedValue([
        { id: 'DEV-1', operating_mode: 'PDV' },
      ]);
      const client = {
        listDevices,
        createPaymentIntent,
        getPaymentIntent: vi.fn(),
        cancelPaymentIntent: vi.fn(),
      };
      mockGetMpPointClient.mockReturnValue(client);

      const request = new Request('http://localhost/api/pagos/mp-point/iniciar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comprobante_id: 'comp-1', total: monto }),
      });

      const res = await POST(request);
      const json = (await res.json()) as { intent_id?: string; estado?: string };

      expect(res.status).toBe(200);
      expect(json.intent_id).toBe('intent-1');
      expect(json.estado).toBe('pendiente_posnet');
      expect(createPaymentIntent).toHaveBeenCalledWith(
        'DEV-1',
        expect.objectContaining({
          amount: Math.round(monto * 100),
        }),
      );
    },
  );
});

