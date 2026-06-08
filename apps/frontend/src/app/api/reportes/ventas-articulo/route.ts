import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import {
  diasEntreYmd,
  finDiaArgentinaIsoUtc,
  inicioDiaArgentinaIsoUtc,
  resolverPeriodoReporte,
  ymdArgentina,
} from '@/lib/reportes/periodos';
import { factorLineasVsTotalComprobante } from '@/lib/facturacion/reconciliar-items-total';
import { fetchStockSucursalPorProductosEnSucursal } from '@/lib/stock/stock-sucursal-reporte';
import { createServerClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import type { Database } from '@/types/database';

type AppSupabase = Awaited<ReturnType<typeof createServerClient>>;

type TipoComprobante = Database['public']['Enums']['tipo_comprobante'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function esVenta(tipo: TipoComprobante): boolean {
  return tipo === 'ticket' || tipo.startsWith('factura_');
}

function incluirLinea(tipo: TipoComprobante): boolean {
    if (tipo === 'presupuesto' || tipo === 'remito' || tipo === 'devolucion_remito' || tipo === 'recibo') return false;
  return esVenta(tipo) || tipo.startsWith('nota_credito_');
}

function signoPorTipo(tipo: TipoComprobante): number {
  return tipo.startsWith('nota_credito_') ? -1 : 1;
}

type ProductoJoin = {
  id: string;
  codigo: string;
  nombre: string;
  stock_actual: number;
  stock_minimo: number;
  fecha_vencimiento: string | null;
  proveedor_id: string | null;
  proveedor: { id: string; nombre: string } | null;
  categoria: { id: string; nombre: string } | null;
};

type ComprobanteJoin = {
  id: string;
  fecha: string;
  tipo: TipoComprobante;
  estado: string;
  fiscalizado_por_id: string | null;
  sucursal_id: string;
  total: number;
};

type ItemRow = {
  cantidad: number;
  precio_costo: number;
  subtotal: number;
  producto_id: string;
  comprobante: ComprobanteJoin | ComprobanteJoin[] | null;
  producto: ProductoJoin | ProductoJoin[] | null;
};

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function diasHastaVencimiento(fechaVenc: string | null): number | null {
  if (!fechaVenc) return null;
  try {
    return diasEntreYmd(ymdArgentina(), fechaVenc);
  } catch {
    return null;
  }
}

function estadoVencimiento(dias: number | null): 'sin_fecha' | 'vencido' | 'critico' | 'proximo' | 'ok' {
  if (dias === null) return 'sin_fecha';
  if (dias < 0) return 'vencido';
  if (dias <= 7) return 'critico';
  if (dias <= 30) return 'proximo';
  return 'ok';
}

const CHUNK = 100;

const SELECT_COMPROBANTE_ITEMS_REPORTE = `
      cantidad,
      precio_costo,
      subtotal,
      producto_id,
      comprobante:comprobante_id!inner (id, fecha, tipo, estado, fiscalizado_por_id, sucursal_id, total),
      producto:producto_id (
        id,
        codigo,
        nombre,
        stock_actual,
        stock_minimo,
        fecha_vencimiento,
        proveedor_id,
        proveedor:proveedor_id (id, nombre),
        categoria:categoria_id (id, nombre)
      )
    `;

type UltimaEntradaRow = {
  created_at: string;
  cantidad: number;
  motivo: string | null;
  referencia_tipo: string | null;
};

/** Carga todas las lineas del periodo; PostgREST pagina por defecto a 1000 filas. */
async function fetchComprobanteItemsReporte(
  supabase: AppSupabase,
  desde: string,
  hasta: string,
): Promise<{ data: ItemRow[]; error: { message: string } | null }> {
  return fetchAllRows(() =>
    supabase
      .from('comprobante_item')
      .select(SELECT_COMPROBANTE_ITEMS_REPORTE)
      .eq('comprobante.estado', 'emitido')
      .gte('comprobante.fecha', desde)
      .lte('comprobante.fecha', hasta)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  );
}

/** Entradas de stock vinculadas a compra/reposicion (excluye manual y ajuste de inventario). */
async function fetchUnidadesCompradasPorProducto(
  supabase: AppSupabase,
  productoIds: string[],
  desde: string,
  hasta: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (productoIds.length === 0) return map;
  const desdeTs = inicioDiaArgentinaIsoUtc(desde);
  const hastaTs = finDiaArgentinaIsoUtc(hasta);

  for (let i = 0; i < productoIds.length; i += CHUNK) {
    const chunk = productoIds.slice(i, i + CHUNK);
    const { data: movs, error } = await fetchAllRows(() =>
      supabase
        .from('movimiento')
        .select('producto_id, cantidad')
        .eq('tipo', 'entrada')
        .in('referencia_tipo', ['factura', 'pedido', 'importacion'])
        .in('producto_id', chunk)
        .gte('created_at', desdeTs)
        .lte('created_at', hastaTs),
    );
    if (error) continue;
    for (const m of movs ?? []) {
      const pid = m.producto_id as string;
      const q = Number(m.cantidad);
      if (!Number.isFinite(q) || q <= 0) continue;
      map.set(pid, (map.get(pid) ?? 0) + q);
    }
  }
  return map;
}

async function fetchUltimasEntradas(
  supabase: AppSupabase,
  productoIds: string[],
): Promise<Map<string, UltimaEntradaRow>> {
  const map = new Map<string, UltimaEntradaRow>();
  if (productoIds.length === 0) return map;

  for (let i = 0; i < productoIds.length; i += CHUNK) {
    const chunk = productoIds.slice(i, i + CHUNK);
    const { data: movs, error } = await fetchAllRows(() =>
      supabase
        .from('movimiento')
        .select('producto_id, created_at, cantidad, motivo, referencia_tipo')
        .eq('tipo', 'entrada')
        .in('producto_id', chunk)
        .order('created_at', { ascending: false }),
    );
    if (error) continue;
    for (const m of movs ?? []) {
      const pid = m.producto_id as string;
      const row: UltimaEntradaRow = {
        created_at: m.created_at,
        cantidad: Number(m.cantidad),
        motivo: m.motivo,
        referencia_tipo: m.referencia_tipo,
      };
      const prev = map.get(pid);
      if (!prev || new Date(row.created_at) > new Date(prev.created_at)) {
        map.set(pid, row);
      }
    }
  }
  return map;
}

export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const sp = new URLSearchParams(new URL(request.url).searchParams);
  const sucursalScope = await resolveAndValidateSucursalScope(session, sp.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;
  const periodo = resolverPeriodoReporte(sp);
  const exportFmt = (sp.get('export') || '').toLowerCase();
  const categoriaId = (sp.get('categoria_id') || '').trim();
  const proveedorId = (sp.get('proveedor_id') || '').trim();
  const productoIdFiltro = (sp.get('producto_id') || '').trim();
  const limitRaw = parseInt(sp.get('limit') || '200', 10);
  const limit = Math.min(500, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 200));

  const [{ data: modulos, error: modErr }] = await Promise.all([
    session.supabase.from('modulo_config').select('facturador_simple').maybeSingle(),
  ]);
  if (modErr) return NextResponse.json({ error: modErr.message }, { status: 500 });
  if (!modulos?.facturador_simple) {
    return NextResponse.json(
      { error: 'Los reportes no están habilitados para tu plan.' },
      { status: 403 },
    );
  }

  const { data: rows, error } = await fetchComprobanteItemsReporte(
    session.supabase,
    periodo.desde,
    periodo.hasta,
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Agg = {
    producto_id: string;
    codigo: string;
    nombre: string;
    categoria_nombre: string | null;
    proveedor_id: string | null;
    proveedor_nombre: string | null;
    unidades: number;
    importe_venta: number;
    costo_total: number;
    comprobantes: Set<string>;
    stock_actual: number;
    stock_minimo: number;
    fecha_vencimiento: string | null;
  };

  const agg = new Map<string, Agg>();

  const filasParaFactor: {
    raw: ItemRow;
    comp: ComprobanteJoin;
    tipo: TipoComprobante;
  }[] = [];

  const filasIncluidas: {
    raw: ItemRow;
    comp: ComprobanteJoin;
    prod: ProductoJoin;
    tipo: TipoComprobante;
  }[] = [];

  for (const raw of (rows ?? []) as ItemRow[]) {
    const comp = unwrap(raw.comprobante);
    if (!comp) continue;
    const tipo = comp.tipo as TipoComprobante;
    if (!incluirLinea(tipo)) continue;
    if (tipo === 'ticket' && comp.fiscalizado_por_id) continue;

    if (sucursalScope.sucursalId && comp.sucursal_id !== sucursalScope.sucursalId) continue;

    filasParaFactor.push({ raw, comp, tipo });

    const prod = unwrap(raw.producto);
    if (!prod) continue;
    if (productoIdFiltro && prod.id !== productoIdFiltro) continue;
    if (categoriaId && prod.categoria?.id !== categoriaId) continue;
    if (proveedorId && prod.proveedor_id !== proveedorId) continue;

    filasIncluidas.push({ raw, comp, prod, tipo });
  }

  const sumaLineasPorComp = new Map<string, number>();
  const totalPorComp = new Map<string, number>();
  // El factor se calcula con todas las lineas del comprobante dentro del alcance.
  // Los filtros de producto/categoria/proveedor no deben hacer que una linea absorba el total.
  for (const { raw, comp } of filasParaFactor) {
    const st = Number(raw.subtotal);
    if (!Number.isFinite(st)) continue;
    sumaLineasPorComp.set(comp.id, (sumaLineasPorComp.get(comp.id) ?? 0) + st);
    totalPorComp.set(comp.id, Number(comp.total));
  }

  const factorPorComp = new Map<string, number>();
  for (const [compId, sumaLineas] of sumaLineasPorComp) {
    const totalComp = totalPorComp.get(compId) ?? sumaLineas;
    factorPorComp.set(compId, factorLineasVsTotalComprobante(totalComp, sumaLineas));
  }

  for (const { raw, comp, prod, tipo } of filasIncluidas) {
    const sign = signoPorTipo(tipo);
    const cant = Number(raw.cantidad) * sign;
    const factor = factorPorComp.get(comp.id) ?? 1;
    const subtotal = round2(Number(raw.subtotal) * factor) * sign;
    const costo = Number(raw.precio_costo) * Number(raw.cantidad) * sign;

    const prev =
      agg.get(prod.id) ??
      ({
        producto_id: prod.id,
        codigo: prod.codigo,
        nombre: prod.nombre,
        categoria_nombre: prod.categoria?.nombre ?? null,
        proveedor_id: prod.proveedor_id,
        proveedor_nombre: prod.proveedor?.nombre ?? null,
        unidades: 0,
        importe_venta: 0,
        costo_total: 0,
        comprobantes: new Set<string>(),
        stock_actual: prod.stock_actual,
        stock_minimo: prod.stock_minimo,
        fecha_vencimiento: prod.fecha_vencimiento,
      } satisfies Agg);

    prev.unidades += cant;
    prev.importe_venta += subtotal;
    prev.costo_total += costo;
    prev.comprobantes.add(comp.id);
    agg.set(prod.id, prev);
  }

  const totalImporte = Array.from(agg.values()).reduce((a, r) => a + r.importe_venta, 0);
  const totalUnidades = Array.from(agg.values()).reduce((a, r) => a + r.unidades, 0);
  const totalCosto = Array.from(agg.values()).reduce((a, r) => a + r.costo_total, 0);

  const productIds = Array.from(agg.keys());
  const sucIdReporte = sucursalScope.sucursalId;
  if (sucIdReporte && productIds.length > 0) {
    const stockMap = await fetchStockSucursalPorProductosEnSucursal(session.supabase, {
      tenantId: session.tenantId,
      sucursalId: sucIdReporte,
      productoIds: productIds,
    });
    for (const r of agg.values()) {
      const ss = stockMap.get(r.producto_id);
      if (ss) {
        r.stock_actual = ss.stock_actual;
        r.stock_minimo = ss.stock_minimo;
      }
    }
  }

  const [ultimasEntradas, comprasPorProducto] = await Promise.all([
    fetchUltimasEntradas(session.supabase, productIds),
    fetchUnidadesCompradasPorProducto(session.supabase, productIds, periodo.desde, periodo.hasta),
  ]);

  const totalUnidadesCompradas = Array.from(comprasPorProducto.values()).reduce((a, v) => a + v, 0);

  const filas = Array.from(agg.values())
    .map((r) => {
      const margen = r.importe_venta - r.costo_total;
      const margen_pct = r.importe_venta === 0 ? null : round2((margen / r.importe_venta) * 100);
      const participacion_pct =
        totalImporte === 0 ? 0 : round2((r.importe_venta / totalImporte) * 100);
      const quiebre = r.stock_minimo > 0 && r.stock_actual <= r.stock_minimo;
      const diasVenc = diasHastaVencimiento(r.fecha_vencimiento);
      const estado_venc = estadoVencimiento(diasVenc);
      const ue = ultimasEntradas.get(r.producto_id) ?? null;

      const uCompras = comprasPorProducto.get(r.producto_id) ?? 0;

      return {
        producto_id: r.producto_id,
        codigo: r.codigo,
        nombre: r.nombre,
        categoria: r.categoria_nombre,
        proveedor: r.proveedor_nombre,
        unidades: round2(r.unidades),
        unidades_compradas: round2(uCompras),
        importe_venta: round2(r.importe_venta),
        costo_total: round2(r.costo_total),
        margen: round2(margen),
        margen_pct,
        participacion_pct,
        tickets: r.comprobantes.size,
        stock_actual: r.stock_actual,
        stock_minimo: r.stock_minimo,
        quiebre,
        fecha_vencimiento: r.fecha_vencimiento,
        dias_hasta_vencimiento: diasVenc,
        estado_vencimiento: estado_venc,
        ultima_entrada: ue
          ? {
              fecha: ue.created_at,
              cantidad: ue.cantidad,
              motivo: ue.motivo,
              referencia_tipo: ue.referencia_tipo,
            }
          : null,
      };
    })
    .sort((a, b) => b.importe_venta - a.importe_venta)
    .slice(0, limit);

  if (exportFmt === 'csv') {
    const header =
      'codigo,nombre,categoria,proveedor,unidades_vendidas,unidades_compradas,importe_venta,costo_total,margen,margen_pct,participacion_pct,tickets,stock_actual,stock_minimo,quiebre,fecha_vencimiento,dias_hasta_vencimiento,estado_vencimiento,ultima_entrada_fecha,ultima_entrada_cantidad,ultima_entrada_motivo';
    const lines = [
      header,
      ...filas.map((it) =>
        [
          csvEscape(it.codigo),
          csvEscape(it.nombre),
          csvEscape(it.categoria ?? ''),
          csvEscape(it.proveedor ?? ''),
          csvEscape(it.unidades),
          csvEscape(it.unidades_compradas),
          csvEscape(it.importe_venta),
          csvEscape(it.costo_total),
          csvEscape(it.margen),
          csvEscape(it.margen_pct ?? ''),
          csvEscape(it.participacion_pct),
          csvEscape(it.tickets),
          csvEscape(it.stock_actual),
          csvEscape(it.stock_minimo),
          csvEscape(it.quiebre ? 'si' : 'no'),
          csvEscape(it.fecha_vencimiento ?? ''),
          csvEscape(it.dias_hasta_vencimiento ?? ''),
          csvEscape(it.estado_vencimiento),
          csvEscape(it.ultima_entrada?.fecha ?? ''),
          csvEscape(it.ultima_entrada?.cantidad ?? ''),
          csvEscape(it.ultima_entrada?.motivo ?? ''),
        ].join(','),
      ),
    ];
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reporte-ventas-articulo-${periodo.desde}-${periodo.hasta}.csv"`,
      },
    });
  }

  return NextResponse.json({
    sucursal_id: sucursalScope.sucursalId,
    periodo,
    filtros: {
      categoria_id: categoriaId || null,
      proveedor_id: proveedorId || null,
      producto_id: productoIdFiltro || null,
      limit,
    },
    indicadores: {
      articulos_distintos: agg.size,
      total_unidades: round2(totalUnidades),
      total_unidades_compradas: round2(totalUnidadesCompradas),
      total_importe_venta: round2(totalImporte),
      total_costo: round2(totalCosto),
      margen_total: round2(totalImporte - totalCosto),
    },
    nota:
      'Unidades vendidas: neto del período (ventas y facturas menos notas de crédito), filtradas por sucursal del comprobante cuando hay sucursal activa. Importe de venta: subtotal de línea prorrateado al total cobrado del comprobante (incluye descuento global, promos en precio y ajuste por medio de pago cuando la suma de líneas no coincide con el total). Unidades compradas: suma de movimientos de entrada con referencia factura, pedido o importación (fecha del movimiento). No incluye entradas manuales ni ajustes de inventario. Stock y mínimo en esa sucursal vía `stock_sucursal` cuando aplica; vencimiento sigue el producto. Última entrada resume la última entrada de stock.',
    filas,
  });
}
