import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/facturacion/[id]/route';

const mocks = vi.hoisted(() => ({
  moduloGuardAny: vi.fn(),
  getTenantSession: vi.fn(),
  resolveAndValidateSucursalScope: vi.fn(),
  comprobanteDetalleJsonResponse: vi.fn(),
}));

vi.mock('@/lib/modulos/guard', () => ({
  moduloGuardAny: (...args: unknown[]) => mocks.moduloGuardAny(...args),
}));

vi.mock('@/lib/api/tenant-session', () => ({
  getTenantSession: (...args: unknown[]) => mocks.getTenantSession(...args),
}));

vi.mock('@/lib/api/sucursal-scope', () => ({
  resolveAndValidateSucursalScope: (...args: unknown[]) =>
    mocks.resolveAndValidateSucursalScope(...args),
}));

vi.mock('@/lib/facturacion/comprobante-detalle-response', () => ({
  comprobanteDetalleJsonResponse: (...args: unknown[]) =>
    mocks.comprobanteDetalleJsonResponse(...args),
}));

function request(url = 'http://localhost/api/facturacion/comp-1') {
  return new Request(url);
}

function ctx(id = 'comp-1') {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/facturacion/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.moduloGuardAny.mockResolvedValue({ allowed: true });
    mocks.comprobanteDetalleJsonResponse.mockResolvedValue(Response.json({ ok: true }));
  });

  it('admin puede abrir comprobantes de cualquier sucursal del tenant', async () => {
    const session = {
      tenantId: 'tenant-1',
      rol: 'admin',
      isSuperAdmin: false,
      supabase: {},
    };
    mocks.getTenantSession.mockResolvedValue(session);

    const res = await GET(request(), ctx('comp-sucursal-2'));

    expect(res.status).toBe(200);
    expect(mocks.resolveAndValidateSucursalScope).not.toHaveBeenCalled();
    expect(mocks.comprobanteDetalleJsonResponse).toHaveBeenCalledWith(
      session,
      'comp-sucursal-2',
      { logTag: '[GET /api/facturacion/[id]]' },
    );
  });

  it('usuarios no admin siguen limitados a su sucursal operativa', async () => {
    const session = {
      tenantId: 'tenant-1',
      rol: 'operador',
      isSuperAdmin: false,
      supabase: {},
    };
    mocks.getTenantSession.mockResolvedValue(session);
    mocks.resolveAndValidateSucursalScope.mockResolvedValue({ ok: true, sucursalId: 'suc-1' });

    const res = await GET(
      request('http://localhost/api/facturacion/comp-1?sucursal_id=suc-1'),
      ctx('comp-1'),
    );

    expect(res.status).toBe(200);
    expect(mocks.resolveAndValidateSucursalScope).toHaveBeenCalledWith(session, 'suc-1');
    expect(mocks.comprobanteDetalleJsonResponse).toHaveBeenCalledWith(
      session,
      'comp-1',
      { logTag: '[GET /api/facturacion/[id]]', sucursalId: 'suc-1' },
    );
  });

  it('usuarios no admin sin sucursal operativa reciben 400', async () => {
    const session = {
      tenantId: 'tenant-1',
      rol: 'operador',
      isSuperAdmin: false,
      supabase: {},
    };
    mocks.getTenantSession.mockResolvedValue(session);
    mocks.resolveAndValidateSucursalScope.mockResolvedValue({ ok: true, sucursalId: null });

    const res = await GET(request(), ctx());
    const json = (await res.json()) as { error?: string };

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/sucursal operativa/i);
    expect(mocks.comprobanteDetalleJsonResponse).not.toHaveBeenCalled();
  });
});
