import { NextResponse } from 'next/server';

import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { effectivePosPrefsFromRows } from '@/lib/pos/prefs';
import { calcularPrecioVenta } from '@/lib/productos/calcular-precio-venta';

function parsePrecioNullable(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('invalid');
  }
  return n;
}

function parseNumeric52Nullable(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 999.99) {
    throw new Error('invalid');
  }
  return Math.round(n * 100) / 100;
}

/**
 * Upsert o elimina override de precios por deposito (`precio_sucursal`).
 * Body: `{ sucursal_id, precio_costo, precio_venta, porcentaje_ganancia }`
 * - `porcentaje_ganancia` con valor calcula y guarda `precio_venta`.
 * - `porcentaje_ganancia: null` conserva el modo manual legacy.
 * - todo null elimina el override.
 */
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

  const operable = await idsSucursalesOperables(session);
  if (!operable.ok) return operable.response;

  const { id: productoId } = await params;

  const { data: producto, error: pErr } = await session.supabase
    .from('producto')
    .select('id, sucursal_id, precio_costo, iva_porcentaje, descuento_costo_pct')
    .eq('id', productoId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (pErr || !producto?.sucursal_id) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }
  if (!operable.ids.includes(producto.sucursal_id)) {
    return NextResponse.json(
      { error: 'No tenes permisos para ver este producto.' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const b =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const sucursalId = typeof b.sucursal_id === 'string' ? b.sucursal_id.trim() : '';
  if (!sucursalId) {
    return NextResponse.json({ error: 'sucursal_id es obligatorio.' }, { status: 400 });
  }
  if (!operable.ids.includes(sucursalId)) {
    return NextResponse.json({ error: 'No tenes permisos para ese deposito.' }, { status: 403 });
  }

  if (!('precio_costo' in b) || !('precio_venta' in b)) {
    return NextResponse.json(
      { error: 'precio_costo y precio_venta son obligatorios (null para heredar del producto).' },
      { status: 400 },
    );
  }

  let precio_costo: number | null;
  let precio_venta: number | null;
  let porcentaje_ganancia: number | null;
  try {
    precio_costo = parsePrecioNullable(b.precio_costo);
    precio_venta = parsePrecioNullable(b.precio_venta);
    porcentaje_ganancia =
      'porcentaje_ganancia' in b ? parseNumeric52Nullable(b.porcentaje_ganancia) : null;
  } catch {
    return NextResponse.json(
      { error: 'precio_costo, precio_venta o porcentaje_ganancia invalidos' },
      { status: 400 },
    );
  }

  if (porcentaje_ganancia !== null) {
    const [{ data: tenantRow }, { data: sucursalRow }] = await Promise.all([
      session.supabase
        .from('tenant')
        .select('iva_porcentaje_default, pos_prefs')
        .eq('id', session.tenantId)
        .maybeSingle(),
      session.supabase
        .from('sucursal')
        .select('pos_prefs')
        .eq('id', sucursalId)
        .eq('tenant_id', session.tenantId)
        .maybeSingle(),
    ]);
    const ivaDefault = Number(tenantRow?.iva_porcentaje_default ?? 21) || 21;
    const posPrefs = effectivePosPrefsFromRows(
      tenantRow?.pos_prefs,
      sucursalRow?.pos_prefs ?? null,
    );
    const costo = precio_costo != null ? precio_costo : Number(producto.precio_costo ?? 0);
    precio_venta = calcularPrecioVenta(
      costo,
      porcentaje_ganancia,
      producto.iva_porcentaje,
      ivaDefault,
      {
        redondearPreciosCentenas: posPrefs.pvpRedondeoCentenasArriba,
        redondearMenores100ADecenas: posPrefs.pvpRedondeoMenores100ADecenas,
        descuentoCostoPct: producto.descuento_costo_pct,
      },
    );
  }

  if (precio_costo === null && precio_venta === null && porcentaje_ganancia === null) {
    const { error: delErr } = await session.supabase
      .from('precio_sucursal')
      .delete()
      .eq('tenant_id', session.tenantId)
      .eq('producto_id', productoId)
      .eq('sucursal_id', sucursalId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, deleted: true });
  }

  const { data, error } = await session.supabase
    .from('precio_sucursal')
    .upsert(
      {
        tenant_id: session.tenantId,
        producto_id: productoId,
        sucursal_id: sucursalId,
        precio_costo,
        precio_venta,
        porcentaje_ganancia,
      },
      { onConflict: 'producto_id,sucursal_id' },
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}
