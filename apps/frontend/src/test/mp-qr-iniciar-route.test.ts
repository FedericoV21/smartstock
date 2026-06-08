import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/pagos/mp-qr/iniciar/route';

const mockModuloGuard = vi.fn();
const mockGetTenantSession = vi.fn();
const mockRejectIfVisor = vi.fn();
const mockGetMpQrClient = vi.fn();
const mockLoadMpQrConfig = vi.fn();
const mockDecryptMpQrAccessToken = vi.fn();
const mockResolveMpQrPos = vi.fn();

vi.mock('@/lib/modulos/guard', () => ({
  moduloGuard: (...args: unknown[]) => mockModuloGuard(...args),
}));

vi.mock('@/lib/api/tenant-session', () => ({
  getTenantSession: (...args: unknown[]) => mockGetTenantSession(...args),
  rejectIfVisor: (...args: unknown[]) => mockRejectIfVisor(...args),
}));

vi.mock('@/lib/mp-qr/client', () => ({
  getMpQrClient: (...args: unknown[]) => mockGetMpQrClient(...args),
  MpQrError: class MpQrError extends Error {
    status: number;
    code: string;

    constructor(message: string, code: string, status: number) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('@/lib/mp-qr/load-config', () => ({
  loadMpQrConfig: (...args: unknown[]) => mockLoadMpQrConfig(...args),
  decryptMpQrAccessToken: (...args: unknown[]) => mockDecryptMpQrAccessToken(...args),
}));

vi.mock('@/lib/mp-qr/verificar-configuracion', () => ({
  resolveMpQrPos: (...args: unknown[]) => mockResolveMpQrPos(...args),
}));

function createSupabaseMock(total: number) {
  const compMaybeSingle = vi.fn().mockResolvedValueOnce({
    data: {
      id: 'comp-1',
      tenant_id: 'tenant-1',
      sucursal_id: 'suc-1',
      estado: 'borrador',
      numero_orden: 42,
      total,
    },
    error: null,
  });

  const tenantMaybeSingle = vi.fn().mockResolvedValueOnce({
    data: { nombre: 'Tienda Test' },
    error: null,
  });

  const updateEqSecond = vi.fn().mockResolvedValue({ error: null });
  const updateBuilder = {
    eq: vi.fn().mockImplementation(() => ({
      eq: updateEqSecond,
    })),
  };

  const from = vi.fn((table: string) => {
    if (table === 'comprobante') {
      const selectBuilder = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: compMaybeSingle,
      };
      return {
        select: vi.fn().mockReturnValue(selectBuilder),
        update: vi.fn().mockReturnValue(updateBuilder),
      };
    }
    if (table === 'tenant') {
      const selectBuilder = {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: tenantMaybeSingle,
      };
      return {
        select: vi.fn().mockReturnValue(selectBuilder),
      };
    }
    throw new Error(`Tabla inesperada: ${table}`);
  });

  return { from };
}

describe('POST /api/pagos/mp-qr/iniciar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockModuloGuard.mockResolvedValue({ allowed: true });
    mockRejectIfVisor.mockReturnValue(null);
    mockLoadMpQrConfig.mockResolvedValue({
      data: {
        habilitado: true,
        user_id: 'user-1',
        external_pos_id: 'POS-1',
        access_token: 'encrypted-token',
      },
      error: null,
    });
    mockDecryptMpQrAccessToken.mockReturnValue('plain-token');
    mockResolveMpQrPos.mockImplementation(async (input) => ({
      external_pos_id: input.external_pos_id,
      external_store_id: null,
      resolved_from_internal_id: false,
    }));
  });

  it('crea la orden QR con el total del borrador, aunque el body venga distinto', async () => {
    const supabase = createSupabaseMock(1500);
    mockGetTenantSession.mockResolvedValue({
      rol: 'admin',
      tenantId: 'tenant-1',
      supabase,
    });

    const createOrder = vi.fn().mockResolvedValue({});
    const client = {
      createOrder,
      cancelOrder: vi.fn(),
    };
    mockGetMpQrClient.mockReturnValue(client);

    const request = new Request('http://localhost/api/pagos/mp-qr/iniciar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comprobante_id: 'comp-1', total: 1499.49 }),
    });

    const res = await POST(request);
    const json = (await res.json()) as { estado?: string; monto_terminal_pesos?: number };

    expect(res.status).toBe(200);
    expect(json.estado).toBe('pendiente_qr');
    expect(json.monto_terminal_pesos).toBe(1500);
    expect(createOrder).toHaveBeenCalledWith(
      'POS-1',
      expect.objectContaining({
        total_amount: 1500,
        items: [
          expect.objectContaining({
            unit_price: 1500,
            total_amount: 1500,
          }),
        ],
      }),
      { externalStoreId: null },
    );
  });
});
