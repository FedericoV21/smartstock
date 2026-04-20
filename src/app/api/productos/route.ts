import { createServerClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { calcularPrecioVenta } from '@/lib/productos/calcular-precio-venta';
import { obtenerStockComprometidoPorProducto } from '@/lib/stock/comprometido';
import type { Database } from '@/types/database';

type ProductoListRow = {
  id: string;
  codigo: string;
  nombre: string;
  stock_actual: number;
  stock_minimo: number;
  precio_costo: number;
  precio_venta: number;
  unidad: Database['public']['Enums']['unidad_medida'];
  fecha_vencimiento: string | null;
  categoria: { id: string; nombre: string } | null;
  proveedor: { id: string; nombre: string } | null;
};

type ProductoListConDisponible = ProductoListRow & {
  comprometido: number;
  disponible: number;
};

async function conStockDisponible(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  productos: ProductoListRow[]
): Promise<ProductoListConDisponible[]> {
  const ids = productos.map((p) => p.id);
  const comp = await obtenerStockComprometidoPorProducto(supabase, ids);
  return productos.map((p) => {
    const c = comp.get(p.id) ?? 0;
    return {
      ...p,
      comprometido: c,
      disponible: p.stock_actual - c,
    };
  });
}

const selectList =
  'id, codigo, nombre, stock_actual, stock_minimo, precio_costo, precio_venta, unidad, fecha_vencimiento, codigo_barras, es_pesable, rubro, subrubro, iva_porcentaje, porcentaje_ganancia, ubicacion, moneda, categoria:categoria_id(id, nombre), proveedor:proveedor_id(id, nombre)';

export async function GET(request: NextRequest) {
  // #region agent log
  const agentLog = (
    message: string,
    hypothesisId: string,
    data: Record<string, unknown>
  ) => {
    fetch('http://127.0.0.1:7729/ingest/b7d77d9b-b0af-4230-81eb-50c688422230', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'c9181b' },
      body: JSON.stringify({
        sessionId: 'c9181b',
        runId: 'post-fix',
        hypothesisId,
        location: 'api/productos/route.ts:GET',
        message,
        data,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  };
  // #endregion

  try {
    const cookieStore = await cookies();
    const all = cookieStore.getAll();
    const sb = all.filter(
      (c) => c.name.startsWith('sb-') || c.name.toLowerCase().includes('auth')
    );
    // #region agent log
    agentLog('GET entry', 'H1-H2', {
      cookieCount: all.length,
      sbNames: sb.map((c) => c.name),
      sbValueLengths: sb.map((c) => c.value.length),
      emptySbCookieNames: sb.filter((c) => c.value.length === 0).map((c) => c.name),
    });
    // #endregion

    const guard = await moduloGuard('stock');
    if (!guard.allowed) return guard.response;
    // #region agent log
    agentLog('after moduloGuard', 'H2-H4', { allowed: true });
    // #endregion

    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // #region agent log
    agentLog('after route getUser', 'H2-H4', { hasUser: !!user });
    // #endregion
    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

  const { searchParams } = new URL(request.url);
  const busqueda = searchParams.get('q');
  // Sanitize for ilike inside PostgREST .or(): strip chars that have
  // special meaning in the filter syntax (,()) or in SQL LIKE (% _ \).
  const busquedaSafe = busqueda
    ? busqueda.trim().replace(/[,()%_\\]/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  const categoriaId = searchParams.get('categoria_id');
  const proveedorId = searchParams.get('proveedor_id');
  const soloStockBajo = searchParams.get('stock_bajo') === 'true';
  const soloVencidos = searchParams.get('vencidos') === 'true';
  const pagina = Math.max(1, parseInt(searchParams.get('pagina') ?? '1', 10));
  const porPagina = Math.min(100, Math.max(1, parseInt(searchParams.get('por_pagina') ?? '25', 10)));
  const offset = (pagina - 1) * porPagina;

  if (soloStockBajo) {
    let q = supabase
      .from('producto')
      .select(selectList)
      .eq('activo', true)
      .gt('stock_minimo', 0)
      .order('nombre');

    if (busquedaSafe) {
      const isNumeric = /^\d+$/.test(busquedaSafe);
      if (isNumeric) {
        q = q.or(
          `codigo_barras.eq.${busquedaSafe},codigo.ilike.%${busquedaSafe}%,nombre.ilike.%${busquedaSafe}%`,
        );
      } else {
        q = q.or(
          `nombre.ilike.%${busquedaSafe}%,codigo.ilike.%${busquedaSafe}%`,
        );
      }
    }
    if (categoriaId) q = q.eq('categoria_id', categoriaId);
    if (proveedorId) q = q.eq('proveedor_id', proveedorId);

    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as unknown as ProductoListRow[];
    const filtered = rows.filter((p) => p.stock_actual <= p.stock_minimo);
    const total = filtered.length;
    const slice = filtered.slice(offset, offset + porPagina);
    const productos = await conStockDisponible(supabase, slice);

    return NextResponse.json({
      productos,
      total,
      pagina,
      por_pagina: porPagina,
      total_paginas: Math.ceil(total / porPagina),
    });
  }

  let query = supabase
    .from('producto')
    .select(selectList, { count: 'exact' })
    .eq('activo', true)
    .order('nombre')
    .range(offset, offset + porPagina - 1);

  if (busquedaSafe) {
    const isNumeric = /^\d+$/.test(busquedaSafe);
    if (isNumeric) {
      query = query.or(
        `codigo_barras.eq.${busquedaSafe},codigo.ilike.%${busquedaSafe}%,nombre.ilike.%${busquedaSafe}%`,
      );
    } else {
      query = query.or(
        `nombre.ilike.%${busquedaSafe}%,codigo.ilike.%${busquedaSafe}%`,
      );
    }
  }
  if (categoriaId) query = query.eq('categoria_id', categoriaId);
  if (proveedorId) query = query.eq('proveedor_id', proveedorId);

  if (soloVencidos) {
    const en30dias = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    query = query.not('fecha_vencimiento', 'is', null).lte('fecha_vencimiento', en30dias);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as ProductoListRow[];
  const productos = await conStockDisponible(supabase, rows);

    return NextResponse.json({
      productos,
      total: count ?? 0,
      pagina,
      por_pagina: porPagina,
      total_paginas: Math.ceil((count ?? 0) / porPagina),
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    // #region agent log
    fetch('http://127.0.0.1:7729/ingest/b7d77d9b-b0af-4230-81eb-50c688422230', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'c9181b' },
      body: JSON.stringify({
        sessionId: 'c9181b',
        runId: 'post-fix',
        hypothesisId: 'H1-H4',
        location: 'api/productos/route.ts:GET',
        message: 'GET uncaught',
        data: {
          errName: err.name,
          errMessage: err.message,
          errStackHead: err.stack?.split('\n').slice(0, 4).join(' | '),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw e;
  }
}

export async function POST(request: Request) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

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

  const codigo = String(b.codigo ?? '').trim();
  const nombre = String(b.nombre ?? '').trim();
  if (!codigo || !nombre) {
    return NextResponse.json({ error: 'codigo y nombre son obligatorios' }, { status: 400 });
  }

  const unidad =
    (b.unidad as Database['public']['Enums']['unidad_medida'] | undefined) ?? 'unidad';

  const esPesable = b.es_pesable === true;
  if (esPesable && unidad !== 'kg' && unidad !== 'gramo') {
    return NextResponse.json(
      { error: 'Un producto pesable debe usar la unidad kg o gramo' },
      { status: 400 }
    );
  }

  const codigoBarrasRaw =
    esPesable
      ? null
      : typeof b.codigo_barras === 'string' && b.codigo_barras.trim()
        ? b.codigo_barras.trim().slice(0, 14)
        : null;
  const pluDigits =
    typeof b.plu === 'string' ? b.plu.replace(/\D/g, '').slice(0, 5) : '';
  const plu = esPesable && pluDigits ? pluDigits : null;

  const precioCosto = Number(b.precio_costo) || 0;
  const porcentajeGanancia = b.porcentaje_ganancia != null ? Number(b.porcentaje_ganancia) : null;
  const ivaPorcentaje = b.iva_porcentaje != null ? Number(b.iva_porcentaje) || null : null;

  // El precio de venta se calcula a partir del costo, la ganancia y el IVA.
  // Fórmula: precio_venta = costo * (1 + ganancia/100) * (1 + iva/100).
  const { data: tenantRow } = await session.supabase
    .from('tenant')
    .select('iva_porcentaje_default')
    .eq('id', session.tenantId)
    .maybeSingle();
  const ivaDefault = tenantRow?.iva_porcentaje_default ?? 21;
  const precioVenta = calcularPrecioVenta(precioCosto, porcentajeGanancia, ivaPorcentaje, ivaDefault);

  const { data: producto, error } = await session.supabase
    .from('producto')
    .insert({
      tenant_id: session.tenantId,
      codigo,
      nombre,
      descripcion: b.descripcion != null ? String(b.descripcion) || null : null,
      categoria_id: typeof b.categoria_id === 'string' ? b.categoria_id : null,
      proveedor_id: typeof b.proveedor_id === 'string' ? b.proveedor_id : null,
      unidad,
      precio_costo: precioCosto,
      precio_venta: precioVenta,
      stock_actual: 0,
      stock_minimo: Number(b.stock_minimo) || 0,
      fecha_vencimiento:
        typeof b.fecha_vencimiento === 'string' && b.fecha_vencimiento
          ? b.fecha_vencimiento
          : null,
      rubro: typeof b.rubro === 'string' && b.rubro ? b.rubro : null,
      subrubro: typeof b.subrubro === 'string' && b.subrubro ? b.subrubro : null,
      iva_porcentaje: ivaPorcentaje,
      porcentaje_ganancia: porcentajeGanancia,
      ubicacion: typeof b.ubicacion === 'string' && b.ubicacion ? b.ubicacion : null,
      moneda: typeof b.moneda === 'string' && b.moneda ? b.moneda : '$',
      codigo_barras: codigoBarrasRaw,
      es_pesable: esPesable,
      plu,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      const msg = error.message.includes('codigo_barras')
        ? 'Ya existe un producto activo con ese código de barras'
        : error.message.includes('plu')
          ? 'Ya existe un producto activo con ese PLU'
          : `Ya existe un producto con el código '${codigo}'`;
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const stockInicial = Number(b.stock_inicial);
  if (producto && stockInicial > 0) {
    const { error: movError } = await session.supabase.rpc('registrar_movimiento', {
      p_tenant_id: session.tenantId,
      p_producto_id: producto.id,
      p_tipo: 'entrada',
      p_cantidad: stockInicial,
      p_motivo: 'Stock inicial al crear producto',
      p_referencia_tipo: 'manual',
      p_referencia_id: null,
      p_usuario_id: session.userId,
    });
    if (movError) {
      return NextResponse.json(
        { error: `Producto creado pero falló el stock inicial: ${movError.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(producto, { status: 201 });
}
