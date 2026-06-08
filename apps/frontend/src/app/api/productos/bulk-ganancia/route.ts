import { NextResponse } from 'next/server';

import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { effectivePosPrefsFromRows } from '@/lib/pos/prefs';
import { calcularPrecioVenta } from '@/lib/productos/calcular-precio-venta';

const MAX_IDS_LOTE = 250;
const UPDATE_CONCURRENCY = 25;

function parseGananciaPct(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 999.99) return null;
  return Math.round(n * 100) / 100;
}

export async function PATCH(request: Request) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

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

  const rawIds = b.ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json({ error: 'ids debe ser un array no vacío' }, { status: 400 });
  }

  if (rawIds.length > MAX_IDS_LOTE) {
    return NextResponse.json(
      { error: `Máximo ${MAX_IDS_LOTE} productos por operación` },
      { status: 400 },
    );
  }

  const ids = [
    ...new Set(
      rawIds.map((x) => (typeof x === 'string' ? x.trim() : String(x))).filter(Boolean),
    ),
  ];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'Sin ids válidos' }, { status: 400 });
  }

  const porcentaje_ganancia = parseGananciaPct(b.porcentaje_ganancia);
  if (porcentaje_ganancia === null) {
    return NextResponse.json(
      { error: 'porcentaje_ganancia inválido (0–999.99)' },
      { status: 400 },
    );
  }

  const { data: productos, error: pErr } = await session.supabase
    .from('producto')
    .select('id, sucursal_id, precio_costo, iva_porcentaje, descuento_costo_pct')
    .in('id', ids)
    .eq('tenant_id', session.tenantId)
    .in('sucursal_id', opSuc.ids)
    .eq('activo', true);

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 400 });
  }
  if (!productos || productos.length === 0) {
    return NextResponse.json(
      {
        error:
          'No se actualizó ningún producto (pueden estar inactivos o en una sucursal fuera de tu alcance).',
      },
      { status: 409 },
    );
  }

  const { data: tenantRow } = await session.supabase
    .from('tenant')
    .select('iva_porcentaje_default, pos_prefs')
    .eq('id', session.tenantId)
    .maybeSingle();

  const ivaDefault = Number(tenantRow?.iva_porcentaje_default ?? 21) || 21;

  const sucursalIdsInvolucradas = [
    ...new Set(productos.map((p) => p.sucursal_id).filter((x): x is string => Boolean(x))),
  ];

  const prefsPorSucursal = new Map<string, ReturnType<typeof effectivePosPrefsFromRows>>();
  if (sucursalIdsInvolucradas.length > 0) {
    const { data: sucRows } = await session.supabase
      .from('sucursal')
      .select('id, pos_prefs')
      .in('id', sucursalIdsInvolucradas)
      .eq('tenant_id', session.tenantId);
    for (const s of sucRows ?? []) {
      prefsPorSucursal.set(
        s.id as string,
        effectivePosPrefsFromRows(tenantRow?.pos_prefs, s.pos_prefs ?? null),
      );
    }
  }
  const prefsTenantOnly = effectivePosPrefsFromRows(tenantRow?.pos_prefs, null);

  let actualizados = 0;
  let sinCosto = 0;
  const errores: string[] = [];

  for (let i = 0; i < productos.length; i += UPDATE_CONCURRENCY) {
    const slice = productos.slice(i, i + UPDATE_CONCURRENCY);
    await Promise.all(
      slice.map(async (p) => {
        const costo = Number(p.precio_costo ?? 0);
        const tienCosto = Number.isFinite(costo) && costo > 0;

        let precioVenta: number | null = null;
        if (tienCosto) {
          const prefs = (p.sucursal_id && prefsPorSucursal.get(p.sucursal_id)) || prefsTenantOnly;
          precioVenta = calcularPrecioVenta(
            costo,
            porcentaje_ganancia,
            p.iva_porcentaje,
            ivaDefault,
            {
              redondearPreciosCentenas: prefs.pvpRedondeoCentenasArriba,
              redondearMenores100ADecenas: prefs.pvpRedondeoMenores100ADecenas,
              descuentoCostoPct: p.descuento_costo_pct,
            },
          );
        } else {
          sinCosto += 1;
        }

        const { error: uErr } = await session.supabase
          .from('producto')
          .update(
            precioVenta !== null
              ? { porcentaje_ganancia, precio_venta: precioVenta }
              : { porcentaje_ganancia },
          )
          .eq('id', p.id)
          .eq('tenant_id', session.tenantId);

        if (uErr) {
          errores.push(uErr.message);
        } else {
          actualizados += 1;
        }
      }),
    );
  }

  if (actualizados === 0) {
    return NextResponse.json(
      { error: errores[0] ?? 'No se pudo actualizar la ganancia' },
      { status: 400 },
    );
  }

  return NextResponse.json({ actualizados, sin_costo: sinCosto });
}
