import { type NextRequest, NextResponse } from 'next/server';

import {
  rejectUnlessPromocionesEditar,
  rejectUnlessPromocionesVer,
} from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { validarSucursalIdsAccesoPromocion } from '@/lib/promociones/sucursales-acceso';
import { hoyEnAR } from '@/lib/utils/formatters';
import {
  buscarConflictosProductos,
  esPromocionTipo,
  filaInsertDesdeValidado,
  quitarVinculosConflicto,
  sincronizarPromocionComboItems,
  sincronizarPromocionSucursales,
  validarCuerpoPromocion,
} from '@/lib/promociones/servidor';

export async function GET(request: NextRequest) {
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

  const { searchParams } = new URL(request.url);
  const activa = searchParams.get('activa');
  const tipoParam = searchParams.get('tipo');

  const { data: accessRows, error: accessErr } = await session.supabase
    .from('promocion_sucursal')
    .select('promocion_id')
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', sucursalScope.sucursalId);

  if (accessErr) {
    return NextResponse.json({ error: accessErr.message }, { status: 500 });
  }

  const accessPromoIds = [
    ...new Set((accessRows ?? []).map((row) => row.promocion_id).filter(Boolean)),
  ];

  let q = session.supabase
    .from('promocion')
    .select(
      `
      *,
      producto_promocion ( producto_id, producto_variante_id ),
      promocion_sucursal (
        sucursal_id,
        sucursal:sucursal_id ( id, codigo, nombre, activa )
      )
    `,
    )
    .eq('tenant_id', session.tenantId)
    .order('updated_at', { ascending: false });

  if (accessPromoIds.length > 0) {
    q = q.or(`sucursal_id.eq.${sucursalScope.sucursalId},id.in.(${accessPromoIds.join(',')})`);
  } else {
    q = q.eq('sucursal_id', sucursalScope.sucursalId);
  }

  if (activa === 'true') q = q.eq('activa', true);
  else if (activa === 'false') q = q.eq('activa', false);

  if (tipoParam && esPromocionTipo(tipoParam)) {
    q = q.eq('tipo', tipoParam);
  }

  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const promociones = (data ?? []).map((row) => {
    const vinculos = row.producto_promocion as { producto_id: string }[] | null;
    const acceso = (row.promocion_sucursal ?? []) as {
      sucursal_id: string;
      sucursal?: { id: string; codigo?: string | null; nombre?: string | null; activa?: boolean | null } | null;
    }[];
    const productos_count = vinculos?.length ?? 0;
    const sucursales = acceso
      .map((a) => a.sucursal)
      .filter((s): s is { id: string; codigo?: string | null; nombre?: string | null; activa?: boolean | null } =>
        Boolean(s?.id),
      );
    const { producto_promocion: _p, promocion_sucursal: _ps, ...rest } = row;
    return { ...rest, productos_count, sucursales, sucursales_count: sucursales.length };
  });

  return NextResponse.json({ sucursal_id: sucursalScope.sucursalId, promociones });
}

export async function POST(request: Request) {
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
      null,
      sucursalesAcceso.ids,
      hoyEnAR(),
    );
    if (conflictos.length > 0 && !data.reemplazar) {
      return NextResponse.json({ conflictos }, { status: 409 });
    }
    if (conflictos.length > 0 && data.reemplazar) {
      await quitarVinculosConflicto(session.supabase, conflictos);
    }

    const insertRow = filaInsertDesdeValidado(session.tenantId, sucursalScope.sucursalId, data);
    const { data: promo, error: insErr } = await session.supabase
      .from('promocion')
      .insert(insertRow)
      .select()
      .single();

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 400 });
    }

    if (data.producto_targets.length > 0) {
      const links = data.producto_targets.map((target) => ({
        tenant_id: session.tenantId,
        promocion_id: promo.id,
        producto_id: target.producto_id,
        producto_variante_id: target.producto_variante_id ?? null,
      }));
      const { error: linkErr } = await session.supabase.from('producto_promocion').insert(links);
      if (linkErr) {
        return NextResponse.json({ error: linkErr.message }, { status: 400 });
      }
    }

    await sincronizarPromocionComboItems(
      session.supabase,
      session.tenantId,
      promo.id,
      data.tipo,
      data.combo_items,
    );

    await sincronizarPromocionSucursales(
      session.supabase,
      session.tenantId,
      promo.id,
      sucursalesAcceso.ids,
    );

    return NextResponse.json(promo, { status: 201 });
  } catch (e) {
    console.error('[POST /api/promociones]', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
