import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { calcularPrecioVenta } from '@/lib/productos/calcular-precio-venta';
import { obtenerStockComprometidoPorProducto } from '@/lib/stock/comprometido';
import type { Database } from '@/types/database';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { id } = await params;

  const { data: producto, error: pErr } = await session.supabase
    .from('producto')
    .select(
      `
      *,
      categoria:categoria_id(id, nombre),
      proveedor:proveedor_id(id, nombre)
    `
    )
    .eq('id', id)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }
  if (!producto) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  const { data: movimientos, error: mErr } = await session.supabase
    .from('movimiento')
    .select('id, tipo, cantidad, stock_anterior, stock_posterior, motivo, referencia_tipo, created_at')
    .eq('producto_id', id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  const compMap = await obtenerStockComprometidoPorProducto(session.supabase, [id]);
  const comprometido = compMap.get(id) ?? 0;
  const disponible = producto.stock_actual - comprometido;

  return NextResponse.json({
    ...producto,
    comprometido,
    disponible,
    movimientos: movimientos ?? [],
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await params;

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

  const camposPermitidos = [
    'codigo',
    'nombre',
    'descripcion',
    'categoria_id',
    'proveedor_id',
    'unidad',
    'precio_costo',
    'precio_venta',
    'stock_minimo',
    'fecha_vencimiento',
    'imagen_url',
    'activo',
    'codigo_barras',
    'plu',
    'es_pesable',
    'rubro',
    'subrubro',
    'iva_porcentaje',
    'porcentaje_ganancia',
    'ubicacion',
    'moneda',
  ] as const;

  const updates: Record<string, unknown> = {};
  for (const campo of camposPermitidos) {
    if (b[campo] !== undefined) {
      updates[campo] = b[campo];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Sin cambios' }, { status: 400 });
  }

  if (updates.es_pesable === true) {
    updates.codigo_barras = null;
  }

  const codigoBarraPropuesto = updates.codigo_barras;
  if (
    codigoBarraPropuesto !== undefined &&
    codigoBarraPropuesto !== null &&
    String(codigoBarraPropuesto).trim() !== ''
  ) {
    if (updates.es_pesable !== true) {
      const { data: curPesable } = await session.supabase
        .from('producto')
        .select('es_pesable')
        .eq('id', id)
        .maybeSingle();
      if (curPesable?.es_pesable && updates.es_pesable !== false) {
        return NextResponse.json(
          { error: 'Los productos pesables no llevan código de barras (usá PLU).' },
          { status: 400 }
        );
      }
    }
  }

  // If es_pesable changes to false, nullify plu
  if (updates.es_pesable === false && updates.plu === undefined) {
    updates.plu = null;
  }

  // If es_pesable changes to true, enforce unit is kg or gramo
  if (updates.es_pesable === true) {
    const targetUnidad = updates.unidad as string | undefined;
    if (targetUnidad && targetUnidad !== 'kg' && targetUnidad !== 'gramo') {
      return NextResponse.json(
        { error: 'Un producto pesable debe usar la unidad kg o gramo' },
        { status: 400 }
      );
    }
    if (!targetUnidad) {
      const { data: current } = await session.supabase
        .from('producto')
        .select('unidad')
        .eq('id', id)
        .maybeSingle();
      if (current && current.unidad !== 'kg' && current.unidad !== 'gramo') {
        updates.unidad = 'kg';
      }
    }
  }

  // El precio de venta SIEMPRE se calcula a partir del costo, la ganancia y el IVA.
  // Si el cliente envió costo, ganancia o IVA, recalculamos. El campo precio_venta
  // enviado por el cliente se ignora (el precio se computa server-side).
  if (
    b.precio_costo !== undefined ||
    b.porcentaje_ganancia !== undefined ||
    b.iva_porcentaje !== undefined
  ) {
    const { data: current } = await session.supabase
      .from('producto')
      .select('precio_costo, porcentaje_ganancia, iva_porcentaje')
      .eq('id', id)
      .maybeSingle();

    const { data: tenant } = await session.supabase
      .from('tenant')
      .select('iva_porcentaje_default')
      .eq('id', session.tenantId)
      .maybeSingle();
    const ivaDefault = tenant?.iva_porcentaje_default ?? 21;

    if (current) {
      const costo =
        b.precio_costo !== undefined ? Number(b.precio_costo) : current.precio_costo;
      const ganancia =
        b.porcentaje_ganancia !== undefined
          ? b.porcentaje_ganancia == null
            ? null
            : Number(b.porcentaje_ganancia)
          : current.porcentaje_ganancia;
      const iva =
        b.iva_porcentaje !== undefined
          ? b.iva_porcentaje == null
            ? null
            : Number(b.iva_porcentaje)
          : current.iva_porcentaje;

      if (costo > 0) {
        updates.precio_venta = calcularPrecioVenta(costo, ganancia, iva, ivaDefault);
      }
    }
  }

  if (b.precio_costo !== undefined || b.precio_venta !== undefined) {
    const { data: productoActual } = await session.supabase
      .from('producto')
      .select('precio_costo, precio_venta')
      .eq('id', id)
      .maybeSingle();

    if (productoActual) {
      const costoAnterior = productoActual.precio_costo;
      const ventaAnterior = productoActual.precio_venta;
      const costoNuevo =
        b.precio_costo !== undefined ? Number(b.precio_costo) : costoAnterior;
      const ventaNuevo =
        b.precio_venta !== undefined ? Number(b.precio_venta) : ventaAnterior;

      if (costoAnterior !== costoNuevo || ventaAnterior !== ventaNuevo) {
        const margenAnterior =
          costoAnterior > 0 ? ((ventaAnterior - costoAnterior) / costoAnterior) * 100 : 0;
        const margenNuevo =
          costoNuevo > 0 ? ((ventaNuevo - costoNuevo) / costoNuevo) * 100 : 0;

        await session.supabase.from('precio_historial').insert({
          tenant_id: session.tenantId,
          producto_id: id,
          precio_costo_anterior: costoAnterior,
          precio_costo_nuevo: costoNuevo,
          precio_venta_anterior: ventaAnterior,
          precio_venta_nuevo: ventaNuevo,
          margen_anterior: margenAnterior,
          margen_nuevo: margenNuevo,
          origen: 'manual',
        });
      }
    }
  }

  const { data, error } = await session.supabase
    .from('producto')
    .update(updates as Database['public']['Tables']['producto']['Update'])
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      const msg = error.message.includes('codigo_barras')
        ? 'Ya existe un producto activo con ese código de barras'
        : error.message.includes('plu')
          ? 'Ya existe un producto activo con ese PLU'
          : 'Ya existe un producto con ese código';
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  return NextResponse.json(data);
}
