import { NextResponse } from 'next/server';

import {
  PERMISO_CONTACTOS_CLIENTES_VER,
  PERMISO_CONTACTOS_PROVEEDORES_VER,
  PERMISO_DESPIECE_APLICAR_PRECIOS,
  PERMISO_DESPIECE_EDITAR,
  PERMISO_DESPIECE_VER,
  PERMISO_PROMOCIONES_EDITAR,
  PERMISO_PROMOCIONES_VER,
  PERMISO_STOCK_AJUSTAR,
  PERMISO_STOCK_VER,
  PERMISO_TESORERIA_GESTIONAR,
} from '@/lib/api/permisos-asignables-usuario';
import type { createServerClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;
type RolUsuario = Database['public']['Enums']['rol_usuario'];

type PermissionCheckOptions = {
  fallbackAdmin?: boolean;
  rol?: RolUsuario;
  isSuperAdmin?: boolean;
};

/**
 * Evalua permisos RBAC por RPC, con fallback al modelo legacy por rol.
 * Esto permite desplegar código antes/después de aplicar migraciones sin romper rutas.
 */
export async function hasPermission(
  supabase: SupabaseServerClient,
  permiso: string,
  options: PermissionCheckOptions = {},
): Promise<boolean> {
  const { fallbackAdmin = true, rol, isSuperAdmin = false } = options;

  if (isSuperAdmin) return true;
  if (fallbackAdmin && rol === 'admin') return true;

  const { data, error } = await supabase.rpc('has_permiso', { p_clave: permiso });
  if (!error && typeof data === 'boolean') {
    return data;
  }

  return false;
}

type SessionPermisosMini = { rol: RolUsuario; isSuperAdmin: boolean };

export async function rejectUnlessContactosProveedoresVer(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const ok = await hasPermission(supabase, PERMISO_CONTACTOS_PROVEEDORES_VER, {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  if (!ok) {
    return NextResponse.json({ error: 'Sin permisos para ver o gestionar proveedores.' }, { status: 403 });
  }
  return null;
}

export async function rejectUnlessContactosClientesVer(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const ok = await hasPermission(supabase, PERMISO_CONTACTOS_CLIENTES_VER, {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  if (!ok) {
    return NextResponse.json({ error: 'Sin permisos para ver o gestionar clientes.' }, { status: 403 });
  }
  return null;
}

/** Listado/detalle de clientes: módulo contactos, o flujos que ya usan clientes (POS, pedidos, emisión). */
export async function rejectUnlessAccesoClientesApi(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const opts = { rol: session.rol, isSuperAdmin: session.isSuperAdmin };
  if (session.isSuperAdmin) return null;
  if (await hasPermission(supabase, PERMISO_CONTACTOS_CLIENTES_VER, opts)) return null;
  if (await hasPermission(supabase, 'pedidos.gestionar', opts)) return null;
  if (await hasPermission(supabase, 'facturacion.emitir', opts)) return null;
  return NextResponse.json({ error: 'Sin permisos para consultar clientes.' }, { status: 403 });
}

/** Proveedores: apartado contactos, o consulta desde stock ya cubierta por el rol. */
export async function rejectUnlessAccesoProveedoresApi(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const opts = { rol: session.rol, isSuperAdmin: session.isSuperAdmin };
  if (session.isSuperAdmin) return null;
  if (await hasPermission(supabase, PERMISO_CONTACTOS_PROVEEDORES_VER, opts)) return null;
  if (await hasPermission(supabase, 'stock.ver', opts)) return null;
  return NextResponse.json({ error: 'Sin permisos para consultar proveedores.' }, { status: 403 });
}

/** Listado mínimo en POS (filtro de búsqueda): emisión/ventas sin módulo contactos ni inventario. */
export async function rejectUnlessAccesoProveedoresPosApi(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const base = await rejectUnlessAccesoProveedoresApi(supabase, session);
  if (!base) return null;
  const opts = { rol: session.rol, isSuperAdmin: session.isSuperAdmin };
  if (await hasPermission(supabase, 'facturacion.emitir', opts)) return null;
  if (await hasPermission(supabase, 'ventas.crear', opts)) return null;
  return base;
}

export async function rejectUnlessProveedorEdicion(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const opts = { rol: session.rol, isSuperAdmin: session.isSuperAdmin };
  if (session.isSuperAdmin) return null;
  if (await hasPermission(supabase, PERMISO_CONTACTOS_PROVEEDORES_VER, opts)) return null;
  if (await hasPermission(supabase, 'stock.ajustar', opts)) return null;
  return NextResponse.json({ error: 'Sin permisos para editar proveedores.' }, { status: 403 });
}

export async function rejectUnlessClienteEdicion(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const opts = { rol: session.rol, isSuperAdmin: session.isSuperAdmin };
  if (session.isSuperAdmin) return null;
  if (await hasPermission(supabase, PERMISO_CONTACTOS_CLIENTES_VER, opts)) return null;
  if (await hasPermission(supabase, 'pedidos.gestionar', opts)) return null;
  if (await hasPermission(supabase, 'facturacion.emitir', opts)) return null;
  return NextResponse.json({ error: 'Sin permisos para editar clientes.' }, { status: 403 });
}

export async function rejectUnlessDespieceVer(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const ok = await hasPermission(supabase, PERMISO_DESPIECE_VER, {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  if (!ok) {
    return NextResponse.json({ error: 'Sin permisos para ver despiece.' }, { status: 403 });
  }
  return null;
}

export async function rejectUnlessDespieceEditar(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const ok = await hasPermission(supabase, PERMISO_DESPIECE_EDITAR, {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  if (!ok) {
    return NextResponse.json({ error: 'Sin permisos para editar despiece.' }, { status: 403 });
  }
  return null;
}

export async function rejectUnlessDespieceAplicarPrecios(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const ok = await hasPermission(supabase, PERMISO_DESPIECE_APLICAR_PRECIOS, {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  if (!ok) {
    return NextResponse.json({ error: 'Sin permisos para aplicar precios de despiece.' }, { status: 403 });
  }
  return null;
}

export async function rejectUnlessStockVer(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const ok = await hasPermission(supabase, PERMISO_STOCK_VER, {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  if (!ok) {
    return NextResponse.json({ error: 'Sin permisos para ver inventario.' }, { status: 403 });
  }
  return null;
}

/** Catálogo en modo consulta: Inventario o selección de productos al editar promociones. */
export async function rejectUnlessCatalogoProductosVer(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const opts = { rol: session.rol, isSuperAdmin: session.isSuperAdmin };
  if (session.isSuperAdmin) return null;
  if (await hasPermission(supabase, PERMISO_STOCK_VER, opts)) return null;
  if (await hasPermission(supabase, PERMISO_PROMOCIONES_EDITAR, opts)) return null;
  return NextResponse.json({ error: 'Sin permisos para consultar el catálogo de productos.' }, { status: 403 });
}

export async function rejectUnlessStockAjustar(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const ok = await hasPermission(supabase, PERMISO_STOCK_AJUSTAR, {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  if (!ok) {
    return NextResponse.json({ error: 'Sin permisos para modificar inventario.' }, { status: 403 });
  }
  return null;
}

export async function rejectUnlessPromocionesVer(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const opts = { rol: session.rol, isSuperAdmin: session.isSuperAdmin };
  if (session.isSuperAdmin) return null;
  if (await hasPermission(supabase, PERMISO_PROMOCIONES_VER, opts)) return null;
  if (await hasPermission(supabase, PERMISO_PROMOCIONES_EDITAR, opts)) return null;
  return NextResponse.json({ error: 'Sin permisos para ver promociones.' }, { status: 403 });
}

export async function rejectUnlessPromocionesEditar(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const ok = await hasPermission(supabase, PERMISO_PROMOCIONES_EDITAR, {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  if (!ok) {
    return NextResponse.json({ error: 'Sin permisos para editar promociones.' }, { status: 403 });
  }
  return null;
}

export async function rejectUnlessTesoreriaGestionar(
  supabase: SupabaseServerClient,
  session: SessionPermisosMini,
): Promise<NextResponse | null> {
  const ok = await hasPermission(supabase, PERMISO_TESORERIA_GESTIONAR, {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  if (!ok) {
    return NextResponse.json({ error: 'Sin permisos para gestionar tesorería.' }, { status: 403 });
  }
  return null;
}
