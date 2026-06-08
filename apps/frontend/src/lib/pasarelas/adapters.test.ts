import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPasarelaAdapter } from '@/lib/pasarelas/adapters';
import type { PasarelaIntegracionRow } from '@/lib/pasarelas/types';

const mocks = vi.hoisted(() => {
  class MockMpPointError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = 'MpPointError';
    }
  }

  return {
    getMpPointClient: vi.fn(),
    resolveMpQrExternalPosId: vi.fn(),
    resolveMpQrPos: vi.fn(),
    runMpQrVerificacionMpQr: vi.fn(),
    MockMpPointError,
  };
});

vi.mock('@/lib/mp-point/client', () => ({
  getMpPointClient: mocks.getMpPointClient,
  MpPointError: mocks.MockMpPointError,
}));

vi.mock('@/lib/mp-qr/verificar-configuracion', () => ({
  resolveMpQrExternalPosId: mocks.resolveMpQrExternalPosId,
  resolveMpQrPos: mocks.resolveMpQrPos,
  runMpQrVerificacionMpQr: mocks.runMpQrVerificacionMpQr,
}));

function integracion(partial: Partial<PasarelaIntegracionRow>): PasarelaIntegracionRow {
  return {
    id: 'int-1',
    tenant_id: 'tenant-1',
    sucursal_id: 'suc-1',
    proveedor: 'mercado_pago',
    canal: 'qr',
    tipo: 'mp_qr',
    nombre: 'MP',
    estado: 'activa',
    config_publica: {},
    secretos_cifrados: { access_token: 'plain-token' },
    webhook_public_id: 'webhook-1',
    ...partial,
  };
}

describe('pasarelas adapters verifyConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveMpQrExternalPosId.mockImplementation(async (input) => ({
      external_pos_id: input.external_pos_id,
      resolved_from_internal_id: false,
    }));
    mocks.resolveMpQrPos.mockImplementation(async (input) => ({
      external_pos_id: input.external_pos_id,
      external_store_id: input.external_store_id ?? null,
      resolved_from_internal_id: false,
    }));
  });

  it('mp_qr reutiliza la verificacion real de QR', async () => {
    mocks.runMpQrVerificacionMpQr.mockResolvedValue({
      ok: true,
      checks: {
        token_valido: { ok: true, mensaje: 'Token valido' },
        user_id_coincide: { ok: true, mensaje: 'User OK' },
        caja_existe: { ok: true, mensaje: 'Caja OK' },
        cobro_de_prueba: { ok: true, mensaje: 'Cobro OK' },
      },
    });

    const adapter = getPasarelaAdapter('mp_qr');
    const result = await adapter?.verifyConfig?.({
      db: {},
      tenantId: 'tenant-1',
      integracion: integracion({
        config_publica: { user_id: '123', external_pos_id: 'CAJA_1' },
      }),
    });

    expect(result?.ok).toBe(true);
    expect(mocks.runMpQrVerificacionMpQr).toHaveBeenCalledWith({
      access_token: 'plain-token',
      user_id: '123',
      external_pos_id: 'CAJA_1',
      external_store_id: null,
    });
  });

  it('mp_point valida que la terminal exista y este en modo PDV', async () => {
    mocks.getMpPointClient.mockReturnValue({
      listDevices: vi.fn().mockResolvedValue([
        {
          id: 'POINT_1',
          operating_mode: 'PDV',
          pos_id: 10,
          store_id: 'store-1',
          external_pos_id: 'POS-POINT',
          name: 'Mostrador',
        },
      ]),
    });

    const adapter = getPasarelaAdapter('mp_point');
    const result = await adapter?.verifyConfig?.({
      db: {},
      tenantId: 'tenant-1',
      integracion: integracion({
        canal: 'terminal',
        tipo: 'mp_point',
        config_publica: { device_id: 'POINT_1' },
      }),
    });

    expect(result?.ok).toBe(true);
    expect(result?.checks?.terminal_existe.ok).toBe(true);
    expect(result?.checks?.modo_pdv.ok).toBe(true);
  });
});
