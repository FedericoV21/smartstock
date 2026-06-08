import { describe, expect, it, vi } from 'vitest';

import {
  PERMISOS_ASIGNABLES_USUARIO,
  PERMISO_DESPIECE_APLICAR_PRECIOS,
  PERMISO_DESPIECE_EDITAR,
  PERMISO_DESPIECE_VER,
  PERMISO_PROMOCIONES_EDITAR,
  PERMISO_PROMOCIONES_VER,
  PERMISO_STOCK_AJUSTAR,
  PERMISO_STOCK_VER,
} from '@/lib/api/permisos-asignables-usuario';
import {
  hasPermission,
  rejectUnlessCatalogoProductosVer,
  rejectUnlessDespieceVer,
  rejectUnlessPromocionesEditar,
  rejectUnlessPromocionesVer,
  rejectUnlessStockAjustar,
  rejectUnlessStockVer,
} from '@/lib/api/permissions';

describe('PERMISOS_ASIGNABLES_USUARIO', () => {
  it('incluye inventario, promociones y despiece además de contactos', () => {
    expect(PERMISOS_ASIGNABLES_USUARIO).toEqual(
      expect.arrayContaining([
        'contactos.proveedores.ver',
        'contactos.clientes.ver',
        PERMISO_STOCK_VER,
        PERMISO_STOCK_AJUSTAR,
        PERMISO_PROMOCIONES_VER,
        PERMISO_PROMOCIONES_EDITAR,
        PERMISO_DESPIECE_VER,
        PERMISO_DESPIECE_EDITAR,
        PERMISO_DESPIECE_APLICAR_PRECIOS,
      ]),
    );
    expect(PERMISOS_ASIGNABLES_USUARIO).toHaveLength(9);
  });
});

function supabaseRpcMock(results: Record<string, boolean>) {
  return {
    rpc: vi.fn(async (_fn: string, args: { p_clave: string }) => ({
      data: results[args.p_clave] ?? false,
      error: null,
    })),
  };
}

describe('hasPermission y rejects de inventario/promociones', () => {
  const session = { rol: 'operador' as const, isSuperAdmin: false };

  it('super admin siempre tiene permiso', async () => {
    const supabase = supabaseRpcMock({});
    const ok = await hasPermission(supabase as never, PERMISO_STOCK_VER, {
      rol: 'operador',
      isSuperAdmin: true,
    });
    expect(ok).toBe(true);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('admin legacy siempre tiene permiso aunque la RPC todavia no tenga el rol RBAC', async () => {
    const supabase = supabaseRpcMock({ [PERMISO_STOCK_VER]: false });
    const ok = await hasPermission(supabase as never, PERMISO_STOCK_VER, {
      rol: 'admin',
      isSuperAdmin: false,
    });
    expect(ok).toBe(true);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('permite despiece.ver para admin legacy aunque no exista rol_permiso', async () => {
    const supabase = supabaseRpcMock({ 'despiece.ver': false });
    const res = await rejectUnlessDespieceVer(supabase as never, {
      rol: 'admin',
      isSuperAdmin: false,
    });
    expect(res).toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('rejectUnlessStockVer devuelve 403 sin stock.ver', async () => {
    const supabase = supabaseRpcMock({ [PERMISO_STOCK_VER]: false });
    const res = await rejectUnlessStockVer(supabase as never, session);
    expect(res?.status).toBe(403);
  });

  it('rejectUnlessStockAjustar permite con stock.ajustar', async () => {
    const supabase = supabaseRpcMock({ [PERMISO_STOCK_AJUSTAR]: true });
    const res = await rejectUnlessStockAjustar(supabase as never, session);
    expect(res).toBeNull();
  });

  it('rejectUnlessPromocionesVer permite con promociones.editar', async () => {
    const supabase = supabaseRpcMock({
      [PERMISO_PROMOCIONES_VER]: false,
      [PERMISO_PROMOCIONES_EDITAR]: true,
    });
    const res = await rejectUnlessPromocionesVer(supabase as never, session);
    expect(res).toBeNull();
  });

  it('rejectUnlessPromocionesEditar exige promociones.editar', async () => {
    const supabase = supabaseRpcMock({
      [PERMISO_PROMOCIONES_VER]: true,
      [PERMISO_PROMOCIONES_EDITAR]: false,
    });
    const res = await rejectUnlessPromocionesEditar(supabase as never, session);
    expect(res?.status).toBe(403);
  });

  it('permite consultar catálogo para editar promociones sin stock.ver', async () => {
    const supabase = supabaseRpcMock({
      [PERMISO_STOCK_VER]: false,
      [PERMISO_PROMOCIONES_EDITAR]: true,
    });
    const res = await rejectUnlessCatalogoProductosVer(supabase as never, session);
    expect(res).toBeNull();
  });
});

describe('operator-nav-access', () => {
  const sinExtras = {
    puedeVerProveedoresContactos: false,
    puedeVerClientesContactos: false,
    puedeUsarInventario: false,
    puedeVerPromociones: false,
    puedeUsarDespiece: false,
  };

  it('bloquea inventario sin permisos', async () => {
    const { operadorPuedeAccederPath } = await import('@/lib/dashboard/operator-nav-access');
    expect(operadorPuedeAccederPath('/productos', sinExtras)).toBe(false);
    expect(operadorPuedeAccederPath('/promociones', sinExtras)).toBe(false);
    expect(operadorPuedeAccederPath('/despiece/plantillas', sinExtras)).toBe(false);
  });

  it('permite POS y bloquea el resto de facturación y movimientos', async () => {
    const { operadorPuedeAccederPath, operadorPuedeLeafHref } = await import(
      '@/lib/dashboard/operator-nav-access'
    );
    const flags = {
      ...sinExtras,
      puedeUsarInventario: true,
      puedeVerPromociones: true,
    };

    expect(operadorPuedeAccederPath('/facturacion/pos', flags)).toBe(true);
    expect(operadorPuedeAccederPath('/facturacion/pos/cobro', flags)).toBe(true);
    expect(operadorPuedeLeafHref('/facturacion/pos', flags)).toBe(true);
    expect(operadorPuedeAccederPath('/facturacion', flags)).toBe(false);
    expect(operadorPuedeAccederPath('/facturacion/cierre-caja', flags)).toBe(false);
    expect(operadorPuedeAccederPath('/pedidos', flags)).toBe(false);
    expect(operadorPuedeAccederPath('/movimientos', flags)).toBe(false);
    expect(operadorPuedeLeafHref('/facturacion', flags)).toBe(false);
    expect(operadorPuedeLeafHref('/movimientos', flags)).toBe(false);
  });

  it('permite inventario, promociones y despiece con flags', async () => {
    const { operadorPuedeAccederPath, operadorPuedeLeafHref } = await import(
      '@/lib/dashboard/operator-nav-access'
    );
    const flags = {
      ...sinExtras,
      puedeUsarInventario: true,
      puedeVerPromociones: true,
      puedeUsarDespiece: true,
    };
    expect(operadorPuedeAccederPath('/productos/nuevo', flags)).toBe(true);
    expect(operadorPuedeAccederPath('/promociones/nueva', flags)).toBe(true);
    expect(operadorPuedeAccederPath('/despiece/plantillas', flags)).toBe(true);
    expect(operadorPuedeAccederPath('/despiece/ingresos', flags)).toBe(true);
    expect(operadorPuedeLeafHref('/promociones', flags)).toBe(true);
    expect(operadorPuedeLeafHref('/productos', flags)).toBe(true);
    expect(operadorPuedeLeafHref('/despiece/plantillas', flags)).toBe(true);
  });
});
