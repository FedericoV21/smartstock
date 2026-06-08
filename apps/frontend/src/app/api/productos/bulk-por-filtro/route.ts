import { NextResponse } from 'next/server';

import {
  idsSucursalesOperables,
  resolveAndValidateSucursalScope,
} from '@/lib/api/sucursal-scope';
import { rejectUnlessStockAjustar } from '@/lib/api/permissions';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { expandirCategoriaIdsPorNombre } from '@/lib/categorias/tenant-scope';
import { moduloGuard } from '@/lib/modulos/guard';
import { idsProductosCatalogoOStockEnDeposito } from '@/lib/productos/ids-catalogo-deposito';
import { idsProductosFiltrarProveedoresRpc } from '@/lib/productos/ids-proveedor-rpc';
import { normalizarTextoBusqueda } from '@/lib/search/normalize-busqueda';

const MAX_IDS_LOTE = 250;
const MAX_BULK_FILTRO = 20_000;
const IDS_VENCIDOS_CHUNK = 200;

const PROVEEDOR_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseProveedorIds(raw: unknown): string[] {
  const items: string[] = [];
  if (typeof raw === 'string' && raw.trim()) {
    items.push(...raw.split(','));
  } else if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === 'string' && x.trim()) items.push(x.trim());
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of items.map((s) => s.trim()).filter(Boolean)) {
    if (!PROVEEDOR_UUID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function filtrosDesdeBody(filtros: Record<string, unknown>) {
  const qRaw = typeof filtros.q === 'string' ? filtros.q : '';
  const busquedaSafe = qRaw
    .trim()
    .replace(/[,()%_\\'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const qNormalizado = busquedaSafe ? normalizarTextoBusqueda(busquedaSafe) : '';
  const categoriaId =
    typeof filtros.categoria_id === 'string' ? filtros.categoria_id.trim() : '';
  const proveedorIds = parseProveedorIds(filtros.proveedor_ids);
  const proveedorIdLegacy =
    typeof filtros.proveedor_id === 'string' ? filtros.proveedor_id.trim() : '';
  const proveedorExcluirId =
    typeof filtros.proveedor_excluir_id === 'string'
      ? filtros.proveedor_excluir_id.trim() || null
      : null;
  let proveedorIdsFiltro: string[] | null = proveedorIds.length > 0 ? proveedorIds : null;
  if (proveedorIdLegacy) {
    if (proveedorIdsFiltro) {
      return { error: 'Usá solo proveedor_id o proveedor_ids, no ambos.' as const };
    }
    if (!PROVEEDOR_UUID_RE.test(proveedorIdLegacy)) {
      return { error: 'proveedor_id inválido.' as const };
    }
    proveedorIdsFiltro = [proveedorIdLegacy];
  }
  const soloStockBajo = filtros.stock_bajo === true || filtros.stock_bajo === 'true';
  const soloVencidos = filtros.vencidos === true || filtros.vencidos === 'true';
  const soloInactivos = filtros.inactivos === true || filtros.inactivos === 'true';
  const alcanceTenant = filtros.alcance === 'tenant';
  const ordenPorActualizado = filtros.orden === 'actualizado';
  return {
    busquedaSafe,
    qNormalizado,
    categoriaId,
    proveedorIdsFiltro,
    proveedorExcluirId,
    soloStockBajo,
    soloVencidos,
    soloInactivos,
    alcanceTenant,
    ordenPorActualizado,
  };
}

async function filtrarIdsVencidosProximos(
  supabase: Extract<Awaited<ReturnType<typeof getTenantSession>>, { supabase: unknown }>['supabase'],
  tenantId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const en30d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += IDS_VENCIDOS_CHUNK) {
    const lote = ids.slice(i, i + IDS_VENCIDOS_CHUNK);
    const { data, error } = await supabase
      .from('producto')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('id', lote)
      .not('fecha_vencimiento', 'is', null)
      .lte('fecha_vencimiento', en30d);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      if (r.id) out.push(r.id);
    }
  }
  return out;
}

function argsCategoriaRpc(opts: {
  categoriaIdsFiltro: string[] | null;
  idsCatQ: string[];
  busquedaSafe: string;
}): { p_categoria_id: string | null; p_categoria_ids_por_busqueda: string[] | null } {
  const { categoriaIdsFiltro, idsCatQ, busquedaSafe } = opts;
  const filtroRubro = categoriaIdsFiltro?.length ? categoriaIdsFiltro : null;

  if (busquedaSafe) {
    return {
      p_categoria_id: filtroRubro?.length === 1 ? filtroRubro[0]! : null,
      p_categoria_ids_por_busqueda: idsCatQ.length > 0 ? idsCatQ : null,
    };
  }

  if (filtroRubro && filtroRubro.length > 1) {
    return {
      p_categoria_id: null,
      p_categoria_ids_por_busqueda: filtroRubro,
    };
  }

  return {
    p_categoria_id: filtroRubro?.length === 1 ? filtroRubro[0]! : null,
    p_categoria_ids_por_busqueda: idsCatQ.length > 0 ? idsCatQ : null,
  };
}

/**
 * Baja/reactivación masiva aplicando los mismos filtros que el listado de productos,
 * sin pasar por `GET ?solo_ids=true` (evita URLs PostgREST demasiado largas con proveedor).
 */
export async function PATCH(request: Request) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const permisoAjustar = await rejectUnlessStockAjustar(session.supabase, session);
  if (permisoAjustar) return permisoAjustar;

  const opSuc = await idsSucursalesOperables(session);
  if (!opSuc.ok) return opSuc.response;
  if (opSuc.ids.length === 0) {
    return NextResponse.json(
      { error: 'No tenés sucursales operables para esta acción.' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const reactivar = b.activo === true;
  const darDeBaja = b.activo === false;
  if (!reactivar && !darDeBaja) {
    return NextResponse.json({ error: 'activo debe ser true o false' }, { status: 400 });
  }

  const filtrosRaw =
    b.filtros && typeof b.filtros === 'object' && !Array.isArray(b.filtros)
      ? (b.filtros as Record<string, unknown>)
      : null;
  if (!filtrosRaw) {
    return NextResponse.json({ error: 'filtros es obligatorio' }, { status: 400 });
  }

  const parsed = filtrosDesdeBody(filtrosRaw);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const {
    busquedaSafe,
    qNormalizado,
    categoriaId,
    proveedorIdsFiltro,
    proveedorExcluirId,
    soloStockBajo,
    soloVencidos,
    soloInactivos,
    alcanceTenant,
    ordenPorActualizado,
  } = parsed;

  if (soloStockBajo) {
    return NextResponse.json(
      { error: 'La baja masiva por filtros no admite stock_bajo. Quitá ese filtro.' },
      { status: 400 },
    );
  }

  if (darDeBaja && soloInactivos) {
    return NextResponse.json(
      { error: 'No podés dar de baja productos que ya están inactivos.' },
      { status: 400 },
    );
  }

  if (reactivar && !soloInactivos) {
    return NextResponse.json(
      { error: 'Para reactivar masivamente activá el filtro de productos dados de baja.' },
      { status: 400 },
    );
  }

  if (proveedorExcluirId) {
    return NextResponse.json(
      {
        error:
          'La baja masiva por filtros no admite proveedor_excluir_id. Usá la selección manual.',
      },
      { status: 400 },
    );
  }

  if (!proveedorIdsFiltro || proveedorIdsFiltro.length === 0) {
    return NextResponse.json(
      {
        error:
          'Por ahora la baja masiva por filtros requiere al menos un proveedor. Seleccioná los productos manualmente o filtrá por proveedor.',
      },
      { status: 400 },
    );
  }

  const sucursalScope = await resolveAndValidateSucursalScope(session, null);
  if (!sucursalScope.ok) return sucursalScope.response;

  let sucursalIdsFiltro: string[];
  if (alcanceTenant) {
    sucursalIdsFiltro = opSuc.ids;
  } else {
    if (!sucursalScope.sucursalId) {
      return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
    }
    sucursalIdsFiltro = [sucursalScope.sucursalId];
  }

  const depositoListadoId =
    !alcanceTenant && sucursalIdsFiltro.length === 1 ? sucursalIdsFiltro[0]! : null;
  const idsVisiblesEnDeposito: string[] | null = depositoListadoId
    ? await idsProductosCatalogoOStockEnDeposito(
        session.supabase,
        session.tenantId,
        depositoListadoId,
      )
    : null;

  if (depositoListadoId && (!idsVisiblesEnDeposito || idsVisiblesEnDeposito.length === 0)) {
    return NextResponse.json({ actualizados: 0, total: 0 });
  }

  const restrVis =
    depositoListadoId && idsVisiblesEnDeposito?.length ? idsVisiblesEnDeposito : null;

  let categoriaIdsFiltro: string[] | null = null;
  if (categoriaId) {
    try {
      categoriaIdsFiltro = await expandirCategoriaIdsPorNombre(
        session.supabase,
        session.tenantId,
        [categoriaId],
      );
    } catch {
      categoriaIdsFiltro = [categoriaId];
    }
  }

  const idsCatQ = busquedaSafe
    ? (
        await session.supabase
          .from('categoria')
          .select('id')
          .ilike('texto_buscable', `%${qNormalizado}%`)
      ).data?.map((r) => r.id) ?? []
    : [];

  const argsCategoria = argsCategoriaRpc({ categoriaIdsFiltro, idsCatQ, busquedaSafe });
  const sinBusquedaNiRubroDropdown =
    !categoriaId && !busquedaSafe && idsCatQ.length === 0;

  const activoListado = soloInactivos ? false : true;

  const rpcRes = await idsProductosFiltrarProveedoresRpc(
    session.supabase,
    {
      tenantId: session.tenantId,
      activo: activoListado,
      sucursalIds: sucursalIdsFiltro,
      proveedorIds: proveedorIdsFiltro,
      offset: 0,
      limit: MAX_BULK_FILTRO,
      ordenPorActualizado,
      restrVis,
      pCategoriaId: argsCategoria.p_categoria_id,
      textoBuscableIlike: qNormalizado || null,
      categoriaIdsPorBusqueda: argsCategoria.p_categoria_ids_por_busqueda,
    },
    sinBusquedaNiRubroDropdown,
  );

  if (rpcRes.error) {
    return NextResponse.json({ error: rpcRes.error }, { status: 500 });
  }

  let ids = rpcRes.ids;
  let total = rpcRes.total;

  if (total > MAX_BULK_FILTRO) {
    return NextResponse.json(
      {
        error: `Hay demasiados productos (${total}). El máximo por operación es ${MAX_BULK_FILTRO}. Acotá el filtro.`,
      },
      { status: 400 },
    );
  }

  if (soloVencidos) {
    try {
      ids = await filtrarIdsVencidosProximos(session.supabase, session.tenantId, ids);
      total = ids.length;
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (ids.length === 0) {
    return NextResponse.json(
      {
        error: reactivar
          ? 'No se reactivó ningún producto con esos filtros.'
          : 'No se dio de baja ningún producto con esos filtros.',
      },
      { status: 409 },
    );
  }

  let actualizados = 0;
  for (let i = 0; i < ids.length; i += MAX_IDS_LOTE) {
    const lote = ids.slice(i, i + MAX_IDS_LOTE);
    const { data, error } = await session.supabase
      .from('producto')
      .update({ activo: reactivar })
      .in('id', lote)
      .eq('tenant_id', session.tenantId)
      .in('sucursal_id', opSuc.ids)
      .eq('activo', !reactivar)
      .select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    actualizados += data?.length ?? 0;
  }

  if (actualizados === 0) {
    return NextResponse.json(
      {
        error: reactivar
          ? 'No se reactivó ningún producto. Suele pasar si el depósito del catálogo no está entre tus sucursales operables.'
          : 'No se dio de baja ningún producto. Suele pasar si el depósito del catálogo no es operable para tu usuario.',
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ actualizados, total });
}
