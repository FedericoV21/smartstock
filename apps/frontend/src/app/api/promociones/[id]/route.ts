import { NextResponse } from 'next/server';

import {
  rejectUnlessPromocionesEditar,
  rejectUnlessPromocionesVer,
} from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import {
  promoVisibleEnSucursal,
  validarSucursalIdsAccesoPromocion,
} from '@/lib/promociones/sucursales-acceso';
import { hoyEnAR } from '@/lib/utils/formatters';
import {
  buscarConflictosProductos,
  quitarVinculosConflicto,
  validarCuerpoPromocion,
  filaUpdateDesdeValidado,
  sincronizarPromocionComboItems,
  sincronizarPromocionSucursales,
} from '@/lib/promociones/servidor';

type PromoSucursalEmbed = {
  sucursal_id: string;
  sucursal?: { id: string; codigo?: string | null; nombre?: string | null; activa?: boolean | null } | null;
};

function extraerSucursalesAcceso(row: { sucursal_id?: string | null; promocion_sucursal?: unknown }) {
  const acceso = (Array.isArray(row.promocion_sucursal) ? row.promocion_sucursal : []) as PromoSucursalEmbed[];
  const sucursal_ids = acceso.map((a) => a.sucursal_id).filter(Boolean);
  if (sucursal_ids.length === 0 && row.sucursal_id) {
    sucursal_ids.push(row.sucursal_id);
  }
  const sucursales = acceso
    .map((a) => a.sucursal)
    .filter((s): s is NonNullable<PromoSucursalEmbed['sucursal']> => Boolean(s?.id));
  return { sucursal_ids, sucursales };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const permisoVer = await rejectUnlessPromocionesVer(session.supabase, session);
  if (permisoVer) return permisoVer;

  const sucursalScope = await resolveAndValidateSucursalScope(session, null);
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const { id } = await params;

  const { data: promo, error } = await session.supabase
    .from('promocion')
    .select(
      `
      *,
      producto_promocion (
        producto_id,
        producto_variante_id,
        producto (
          id,
          codigo,
          nombre,
          precio_venta,
          proveedor:proveedor_id ( nombre )
        )
      ),
      promocion_sucursal (
        sucursal_id,
        sucursal:sucursal_id ( id, codigo, nombre, activa )
      )
    `,
    )
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!promo) {
    return NextResponse.json({ error: 'Promoción no encontrada' }, { status: 404 });
  }
  const accesoPromo = extraerSucursalesAcceso(promo);
  if (!promoVisibleEnSucursal(promo.sucursal_id, accesoPromo.sucursal_ids, sucursalScope.sucursalId)) {
    return NextResponse.json({ error: 'Promoción no encontrada' }, { status: 404 });
  }

  const { data: comboRows, error: comboErr } = await session.supabase
    .from('promocion_combo_item')
    .select('producto_id, producto_variante_id, cantidad')
    .eq('promocion_id', id)
    .eq('tenant_id', session.tenantId);

  if (comboErr) {
    return NextResponse.json({ error: comboErr.message }, { status: 500 });
  }

  const productoIdsCombo = [...new Set((comboRows ?? []).map((r) => r.producto_id))];
  const productoPorId = new Map<string, { id: string; codigo: string; nombre: string }>();
  if (productoIdsCombo.length > 0) {
    const { data: prods, error: pErr } = await session.supabase
      .from('producto')
      .select('id, codigo, nombre')
      .in('id', productoIdsCombo)
      .eq('tenant_id', session.tenantId);
    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 500 });
    }
    for (const p of prods ?? []) {
      productoPorId.set(p.id, { id: p.id, codigo: p.codigo ?? '', nombre: p.nombre ?? '' });
    }
  }

  const promocion_combo_item = (comboRows ?? []).map((r) => ({
    producto_id: r.producto_id,
    producto_variante_id: r.producto_variante_id ?? null,
    cantidad: r.cantidad,
    producto: productoPorId.get(r.producto_id) ?? null,
  }));

  const { data: ultimasVentas, error: vErr } = await session.supabase
    .from('comprobante_item')
    .select(
      `
      id,
      cantidad,
      descuento_promo_monto,
      promocion_descripcion,
      created_at,
      producto_id,
      comprobante (
        id,
        numero,
        fecha,
        tipo
      )
    `,
    )
    .eq('promocion_id', id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (vErr) {
    return NextResponse.json({ error: vErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ...promo,
    sucursal_ids: accesoPromo.sucursal_ids,
    sucursales: accesoPromo.sucursales,
    promocion_combo_item,
    ultimas_ventas: ultimasVentas ?? [],
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const permisoEditar = await rejectUnlessPromocionesEditar(session.supabase, session);
  if (permisoEditar) return permisoEditar;

  const sucursalScope = await resolveAndValidateSucursalScope(session, null);
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const { id } = await params;

  const { data: existe, error: exErr } = await session.supabase
    .from('promocion')
    .select('id, sucursal_id, promocion_sucursal ( sucursal_id )')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 500 });
  }
  if (!existe) {
    return NextResponse.json({ error: 'Promoción no encontrada' }, { status: 404 });
  }
  const accesoExistente = extraerSucursalesAcceso(existe);
  if (!promoVisibleEnSucursal(existe.sucursal_id, accesoExistente.sucursal_ids, sucursalScope.sucursalId)) {
    return NextResponse.json({ error: 'Promoción no encontrada' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = validarCuerpoPromocion(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const data = parsed.data;
  const sucursalesAcceso = await validarSucursalIdsAccesoPromocion(
    session,
    data.sucursal_ids,
    sucursalScope.sucursalId,
  );
  if (!sucursalesAcceso.ok) return sucursalesAcceso.response;

  try {
    const conflictos = await buscarConflictosProductos(
      session.supabase,
      session.tenantId,
      data.producto_targets,
      id,
      sucursalesAcceso.ids,
      hoyEnAR(),
    );
    if (conflictos.length > 0 && !data.reemplazar) {
      return NextResponse.json({ conflictos }, { status: 409 });
    }
    if (conflictos.length > 0 && data.reemplazar) {
      await quitarVinculosConflicto(session.supabase, conflictos);
    }

    const updateRow = filaUpdateDesdeValidado(data);
    const { error: upErr } = await session.supabase
      .from('promocion')
      .update(updateRow)
      .eq('id', id)
      .eq('tenant_id', session.tenantId);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    const { error: delErr } = await session.supabase.from('producto_promocion').delete().eq('promocion_id', id);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    if (data.producto_targets.length > 0) {
      const links = data.producto_targets.map((target) => ({
        tenant_id: session.tenantId,
        promocion_id: id,
        producto_id: target.producto_id,
        producto_variante_id: target.producto_variante_id ?? null,
      }));
      const { error: insErr } = await session.supabase.from('producto_promocion').insert(links);
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 400 });
      }
    }

    await sincronizarPromocionComboItems(
      session.supabase,
      session.tenantId,
      id,
      data.tipo,
      data.combo_items,
    );

    await sincronizarPromocionSucursales(
      session.supabase,
      session.tenantId,
      id,
      sucursalesAcceso.ids,
    );

    const { data: promo, error: selErr } = await session.supabase
      .from('promocion')
      .select()
      .eq('id', id)
      .eq('tenant_id', session.tenantId)
      .single();

    if (selErr) {
      return NextResponse.json({ error: selErr.message }, { status: 500 });
    }

    return NextResponse.json(promo);
  } catch (e) {
    console.error('[PUT /api/promociones/[id]]', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** Activa / desactiva sin reenviar el cuerpo completo de la promoción. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const permisoEditar = await rejectUnlessPromocionesEditar(session.supabase, session);
  if (permisoEditar) return permisoEditar;

  const sucursalScope = await resolveAndValidateSucursalScope(session, null);
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (body == null || typeof body !== 'object') {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const activa = (body as Record<string, unknown>).activa;
  if (typeof activa !== 'boolean') {
    return NextResponse.json({ error: 'Se esperaba { activa: boolean }' }, { status: 400 });
  }

  const { data: existe, error: exErr } = await session.supabase
    .from('promocion')
    .select('id, sucursal_id, promocion_sucursal ( sucursal_id )')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 500 });
  }
  if (!existe) {
    return NextResponse.json({ error: 'Promoción no encontrada' }, { status: 404 });
  }
  const accesoExistente = extraerSucursalesAcceso(existe);
  if (!promoVisibleEnSucursal(existe.sucursal_id, accesoExistente.sucursal_ids, sucursalScope.sucursalId)) {
    return NextResponse.json({ error: 'Promoción no encontrada' }, { status: 404 });
  }

  const { data: promo, error } = await session.supabase
    .from('promocion')
    .update({ activa })
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(promo);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const permisoEditar = await rejectUnlessPromocionesEditar(session.supabase, session);
  if (permisoEditar) return permisoEditar;

  const sucursalScope = await resolveAndValidateSucursalScope(session, null);
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const { id } = await params;

  const { data: existe, error: exErr } = await session.supabase
    .from('promocion')
    .select('id, sucursal_id, promocion_sucursal ( sucursal_id )')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (exErr) {
    return NextResponse.json({ error: exErr.message }, { status: 500 });
  }
  if (!existe) {
    return NextResponse.json({ error: 'Promoción no encontrada' }, { status: 404 });
  }
  const accesoExistente = extraerSucursalesAcceso(existe);
  if (!promoVisibleEnSucursal(existe.sucursal_id, accesoExistente.sucursal_ids, sucursalScope.sucursalId)) {
    return NextResponse.json({ error: 'Promoción no encontrada' }, { status: 404 });
  }

  const { error } = await session.supabase
    .from('promocion')
    .update({ activa: false })
    .eq('id', id)
    .eq('tenant_id', session.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
