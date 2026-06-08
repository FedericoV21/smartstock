import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as confirmarTransferencia } from '@/app/api/pagos/mp-transferencia/confirmar/route';
import { POST as iniciarTransferencia } from '@/app/api/pagos/mp-transferencia/iniciar/route';
import { POST as verificarTransferencia } from '@/app/api/pagos/mp-transferencia/verificar/route';
import { MpTransferenciaClientError } from '@/lib/mp-transferencia/client';

const mockModuloGuard = vi.fn();
const mockGetTenantSession = vi.fn();
const mockRejectIfVisor = vi.fn();
const mockLoadToken = vi.fn();
const mockVerificar = vi.fn();
const mockConfirmar = vi.fn();
const mockCreateServiceRoleClient = vi.fn();

vi.mock('@/lib/modulos/guard', () => ({
  moduloGuard: (...args: unknown[]) => mockModuloGuard(...args),
}));

vi.mock('@/lib/api/tenant-session', () => ({
  getTenantSession: (...args: unknown[]) => mockGetTenantSession(...args),
  rejectIfVisor: (...args: unknown[]) => mockRejectIfVisor(...args),
}));

vi.mock('@/lib/mp-transferencia/service', () => ({
  loadMpTransferenciaAccessToken: (...args: unknown[]) => mockLoadToken(...args),
  verificarTransferenciaMp: (...args: unknown[]) => mockVerificar(...args),
  confirmarTransferenciaMp: (...args: unknown[]) => mockConfirmar(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => mockCreateServiceRoleClient(),
}));

function supabaseConComprobante(overrides?: Record<string, unknown>) {
  const comp = {
    id: 'comp-1',
    tenant_id: 'tenant-1',
    sucursal_id: 'suc-1',
    caja_id: 'caja-1',
    estado: 'pendiente_transferencia_mp',
    total: 1500,
    ...overrides,
  };
  const maybeSingle = vi.fn().mockResolvedValue({ data: comp, error: null });
  const selectBuilder = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle,
  };
  const updateBuilder = {
    eq: vi.fn().mockReturnThis(),
    error: null,
  };
  const update = vi.fn().mockReturnValue(updateBuilder);
  return {
    __update: update,
    from: vi.fn((table: string) => {
      if (table !== 'comprobante') throw new Error(`Tabla inesperada: ${table}`);
      return {
        select: vi.fn().mockReturnValue(selectBuilder),
        update,
      };
    }),
  };
}

function request(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('rutas mp-transferencia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateServiceRoleClient.mockReturnValue(supabaseConComprobante());
    mockModuloGuard.mockResolvedValue({ allowed: true });
    mockRejectIfVisor.mockReturnValue(null);
    mockGetTenantSession.mockResolvedValue({
      rol: 'admin',
      tenantId: 'tenant-1',
      userId: 'user-1',
      supabase: supabaseConComprobante(),
    });
    mockLoadToken.mockResolvedValue({ ok: true, token: 'mp-token' });
  });

  it('devuelve error de configuracion cuando falta token QR MP', async () => {
    mockLoadToken.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'Configuracion de MP QR incompleta',
    });

    const res = await verificarTransferencia(
      request('http://localhost/api/pagos/mp-transferencia/verificar', {
        comprobante_id: 'comp-1',
      }),
    );
    const json = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(json.error).toContain('MP QR');
  });

  it('no inicia la verificacion si la preferencia de Transferencia MP no esta habilitada', async () => {
    const db = supabaseConComprobante({ estado: 'borrador' });
    mockCreateServiceRoleClient.mockReturnValue(db);
    mockGetTenantSession.mockResolvedValue({
      rol: 'admin',
      tenantId: 'tenant-1',
      userId: 'user-1',
      supabase: db,
    });
    mockLoadToken.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'El verificador de Transferencia MP esta deshabilitado.',
    });

    const res = await iniciarTransferencia(
      request('http://localhost/api/pagos/mp-transferencia/iniciar', {
        comprobante_id: 'comp-1',
      }),
    );
    const json = (await res.json()) as { error?: string };

    expect(res.status).toBe(403);
    expect(json.error).toContain('deshabilitado');
    expect(db.__update).not.toHaveBeenCalled();
  });

  it('devuelve pendiente cuando MP todavia no muestra el pago aprobado', async () => {
    mockVerificar.mockResolvedValue({
      estado: 'pendiente',
      mensaje: 'Mercado Pago todavia no entrego el movimiento.',
    });

    const res = await verificarTransferencia(
      request('http://localhost/api/pagos/mp-transferencia/verificar', {
        comprobante_id: 'comp-1',
      }),
    );
    const json = (await res.json()) as { estado?: string; mensaje?: string };

    expect(res.status).toBe(200);
    expect(json.estado).toBe('pendiente');
    expect(json.mensaje).toContain('movimiento');
  });

  it('propaga errores de Mercado Pago al consultar pagos aprobados', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockVerificar.mockRejectedValue(
      new MpTransferenciaClientError('Bad Request', 400, {
        message: 'Bad Request',
        error: 'bad_request',
        status: 400,
      }),
    );

    const res = await verificarTransferencia(
      request('http://localhost/api/pagos/mp-transferencia/verificar', {
        comprobante_id: 'comp-1',
      }),
    );
    const json = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(json.error).toContain('Bad Request');
    consoleError.mockRestore();
  });

  it('devuelve multiples cuando hay dos coincidencias y no autoconfirma', async () => {
    mockVerificar.mockResolvedValue({
      estado: 'multiples',
      movimientos: [
        { id: 'mov-row-1', mp_movimiento_id: 'mp-1', monto: 1500 },
        { id: 'mov-row-2', mp_movimiento_id: 'mp-2', monto: 1500 },
      ],
    });

    const res = await verificarTransferencia(
      request('http://localhost/api/pagos/mp-transferencia/verificar', {
        comprobante_id: 'comp-1',
      }),
    );
    const json = (await res.json()) as { estado?: string; movimientos?: unknown[] };

    expect(res.status).toBe(200);
    expect(json.estado).toBe('multiples');
    expect(json.movimientos).toHaveLength(2);
    expect(mockConfirmar).not.toHaveBeenCalled();
  });

  it('confirma una coincidencia y emite el comprobante', async () => {
    mockConfirmar.mockResolvedValue({
      ok: true,
      data: {
        comprobante: { id: 'comp-1', estado: 'emitido', numero: 12, total: 1500 },
        importes: { total: 1500 },
        promociones_aplicadas: [],
        qr_url: null,
      },
    });

    const res = await confirmarTransferencia(
      request('http://localhost/api/pagos/mp-transferencia/confirmar', {
        comprobante_id: 'comp-1',
        movimiento_id: 'mov-row-1',
      }),
    );
    const json = (await res.json()) as { comprobante?: { estado?: string } };

    expect(res.status).toBe(201);
    expect(json.comprobante?.estado).toBe('emitido');
    expect(mockConfirmar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        movimientoId: 'mov-row-1',
      }),
    );
  });

  it('rechaza reutilizar un movimiento ya verificado', async () => {
    mockConfirmar.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Este movimiento de Mercado Pago ya fue usado en otra venta',
    });

    const res = await confirmarTransferencia(
      request('http://localhost/api/pagos/mp-transferencia/confirmar', {
        comprobante_id: 'comp-1',
        movimiento_id: 'mov-row-1',
      }),
    );
    const json = (await res.json()) as { error?: string };

    expect(res.status).toBe(409);
    expect(json.error).toContain('ya fue usado');
  });

  it('si ARCA falla, devuelve el comprobante recuperable con el pago ya asociado', async () => {
    mockConfirmar.mockResolvedValue({
      ok: true,
      data: {
        comprobante: {
          id: 'comp-1',
          estado: 'error_arca',
          numero: null,
          total: 1500,
          ultimo_error_arca_mensaje: 'CAE rechazado',
        },
        importes: { total: 1500 },
        promociones_aplicadas: [],
        qr_url: null,
      },
    });

    const res = await confirmarTransferencia(
      request('http://localhost/api/pagos/mp-transferencia/confirmar', {
        comprobante_id: 'comp-1',
        movimiento_id: 'mov-row-1',
      }),
    );
    const json = (await res.json()) as { comprobante?: { estado?: string; ultimo_error_arca_mensaje?: string } };

    expect(res.status).toBe(201);
    expect(json.comprobante?.estado).toBe('error_arca');
    expect(json.comprobante?.ultimo_error_arca_mensaje).toBe('CAE rechazado');
  });
});
