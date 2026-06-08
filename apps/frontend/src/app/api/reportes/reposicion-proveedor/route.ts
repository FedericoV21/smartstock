import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { fetchStockSucursalPorProductosEnSucursal } from '@/lib/stock/stock-sucursal-reporte';
import {
  addCalendarDays,
  diasCalendarioInclusivos,
  redondearCantidadSugerida,
  resolverPeriodoReporte,
  round2,
  ymdLocal,
} from '@/lib/reportes/reposicion-proveedor';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import type { Database } from '@/types/database';

type TipoComprobante = Database['public']['Enums']['tipo_comprobante'];
type UnidadMedida = Database['public']['Enums']['unidad_medida'];

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
  sucursal_id: string;
  codigo: string;
  nombre: string;
  stock_actual: number;
  stock_minimo: number;
  proveedor_id: string | null;
  unidad: UnidadMedida;
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
};

/** Producto embebido en stock_sucursal (sin campos de stock del catálogo global). */
type StockSucursalProductoEmbed = {
  id: string;
  codigo: string;
  nombre: string;
  proveedor_id: string | null;
  unidad: UnidadMedida;
  activo: boolean;
  proveedor: { id: string; nombre: string } | null;
  categoria: { id: string; nombre: string } | null;
};

type ItemRow = {
  cantidad: number;
  producto_id: string;
  comprobante: ComprobanteJoin | ComprobanteJoin[] | null;
  producto: ProductoJoin | ProductoJoin[] | null;
};

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

type Agg = {
  producto_id: string;
  codigo: string;
  nombre: string;
  unidad: UnidadMedida;
  categoria_nombre: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  stock_actual: number;
  stock_minimo: number;
  unidades_periodo: number;
};

function quiebre(stockActual: number, stockMinimo: number): boolean {
  return stockMinimo > 0 && stockActual <= stockMinimo;
}

export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const sp = new URLSearchParams(new URL(request.url).searchParams);
  const sucursalScope = await resolveAndValidateSucursalScope(session, sp.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;
  const sucursalId = sucursalScope.sucursalId;

  const periodo = resolverPeriodoReporte(sp);
  const diasPeriodo = diasCalendarioInclusivos(periodo.desde, periodo.hasta);
  const categoriaId = (sp.get('categoria_id') || '').trim();
  const proveedorId = (sp.get('proveedor_id') || '').trim();
  const exportFmt = (sp.get('export') || '').toLowerCase();
  const filtro = (sp.get('filtro') || 'sugerencias').toLowerCase() === 'todos' ? 'todos' : 'sugerencias';
  const sinProveedor = (sp.get('sin_proveedor') || '1').trim() !== '0';

  const diasObjetivoRaw = parseInt(sp.get('dias_objetivo') || '14', 10);
  const diasObjetivo = Math.min(120, Math.max(1, Number.isFinite(diasObjetivoRaw) ? diasObjetivoRaw : 14));

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

  const { data: rows, error } = await fetchAllRows(() =>
    session.supabase
      .from('comprobante_item')
      .select(
        `
      cantidad,
      producto_id,
      comprobante:comprobante_id!inner (id, fecha, tipo, estado, fiscalizado_por_id, sucursal_id),
      producto:producto_id (
        id,
        sucursal_id,
        codigo,
        nombre,
        stock_actual,
        stock_minimo,
        proveedor_id,
        unidad,
        proveedor:proveedor_id (id, nombre),
        categoria:categoria_id (id, nombre)
      )
    `,
      )
      .eq('comprobante.estado', 'emitido')
      .gte('comprobante.fecha', periodo.desde)
      .lte('comprobante.fecha', periodo.hasta),
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const agg = new Map<string, Agg>();

  for (const raw of (rows ?? []) as ItemRow[]) {
    const comp = unwrap(raw.comprobante);
    const prod = unwrap(raw.producto);
    if (!comp || !prod) continue;
    if (sucursalId && comp.sucursal_id !== sucursalId) continue;
    const tipo = comp.tipo as TipoComprobante;
    if (!incluirLinea(tipo)) continue;
    if (tipo === 'ticket' && comp.fiscalizado_por_id) continue;

    const prodCat = Array.isArray(prod.categoria) ? prod.categoria[0] : prod.categoria;
    if (categoriaId && prodCat?.id !== categoriaId) continue;
    if (proveedorId && prod.proveedor_id !== proveedorId) continue;
    if (!sinProveedor && prod.proveedor_id == null) continue;

    const sign = signoPorTipo(tipo);
    const cant = Number(raw.cantidad) * sign;

    const prev =
      agg.get(prod.id) ??
      ({
        producto_id: prod.id,
        codigo: prod.codigo,
        nombre: prod.nombre,
        unidad: prod.unidad,
        categoria_nombre: prodCat?.nombre ?? null,
        proveedor_id: prod.proveedor_id,
        proveedor_nombre: prod.proveedor?.nombre ?? null,
        stock_actual: prod.stock_actual,
        stock_minimo: prod.stock_minimo,
        unidades_periodo: 0,
      } satisfies Agg);

    prev.unidades_periodo += cant;
    prev.stock_actual = prod.stock_actual;
    prev.stock_minimo = prod.stock_minimo;
    prev.proveedor_id = prod.proveedor_id;
    prev.proveedor_nombre = prod.proveedor?.nombre ?? null;
    agg.set(prod.id, prev);
  }

  if (sucursalId && agg.size > 0) {
    const stockMap = await fetchStockSucursalPorProductosEnSucursal(session.supabase, {
      tenantId: session.tenantId,
      sucursalId,
      productoIds: Array.from(agg.keys()),
    });
    for (const r of agg.values()) {
      const ss = stockMap.get(r.producto_id);
      if (ss) {
        r.stock_actual = ss.stock_actual;
        r.stock_minimo = ss.stock_minimo;
      }
    }
  }

  let prodCatalog: {
    id: string;
    codigo: string;
    nombre: string;
    stock_actual: number;
    stock_minimo: number;
    proveedor_id: string | null;
    unidad: UnidadMedida;
    proveedor: ProductoJoin['proveedor'];
    categoria: ProductoJoin['categoria'];
  }[] = [];

  if (sucursalId) {
    const { data: ssRows, error: ssErr } = await fetchAllRows(() =>
      session.supabase
        .from('stock_sucursal')
        .select(
          `
        stock_actual,
        stock_minimo,
        producto:producto_id!inner(
          id,
          codigo,
          nombre,
          proveedor_id,
          unidad,
          activo,
          proveedor:proveedor_id (id, nombre),
          categoria:categoria_id (id, nombre)
        )
      `,
        )
        .eq('tenant_id', session.tenantId)
        .eq('sucursal_id', sucursalId),
    );
    if (ssErr) return NextResponse.json({ error: ssErr.message }, { status: 500 });

    for (const row of ssRows ?? []) {
      const p = unwrap(row.producto as StockSucursalProductoEmbed | StockSucursalProductoEmbed[] | null);
      if (!p || !p.activo) continue;
      prodCatalog.push({
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        stock_actual: Number(row.stock_actual),
        stock_minimo: Number(row.stock_minimo),
        proveedor_id: p.proveedor_id,
        unidad: p.unidad,
        proveedor: p.proveedor,
        categoria: p.categoria,
      });
    }
  } else {
    const buildProductoQuery = () => {
      let pq = session.supabase
        .from('producto')
        .select(
          `
      id,
      codigo,
      nombre,
      stock_actual,
      stock_minimo,
      proveedor_id,
      unidad,
      proveedor:proveedor_id (id, nombre),
      categoria:categoria_id (id, nombre)
    `,
        )
        .eq('activo', true);

      if (proveedorId) pq = pq.eq('proveedor_id', proveedorId);
      if (categoriaId) pq = pq.eq('categoria_id', categoriaId);
      return pq;
    };

    const { data, error: catErr } = await fetchAllRows(buildProductoQuery);
    if (catErr) return NextResponse.json({ error: catErr.message }, { status: 500 });
    prodCatalog = (data ?? []) as typeof prodCatalog;
  }

  if (proveedorId) {
    prodCatalog = prodCatalog.filter((p) => p.proveedor_id === proveedorId);
  }
  if (categoriaId) {
    prodCatalog = prodCatalog.filter((p) => {
      const cat = Array.isArray(p.categoria) ? p.categoria[0] : p.categoria;
      return cat?.id === categoriaId;
    });
  }

  for (const prod of prodCatalog) {
    if (!sinProveedor && prod.proveedor_id == null) continue;
    const stockActual = Number(prod.stock_actual);
    const stockMinimo = Number(prod.stock_minimo);
    if (!quiebre(stockActual, stockMinimo)) continue;
    if (agg.has(prod.id)) continue;

    const prov = Array.isArray(prod.proveedor) ? prod.proveedor[0] : prod.proveedor;
    const cat = Array.isArray(prod.categoria) ? prod.categoria[0] : prod.categoria;

    agg.set(prod.id, {
      producto_id: prod.id,
      codigo: prod.codigo,
      nombre: prod.nombre,
      unidad: prod.unidad as UnidadMedida,
      categoria_nombre: cat?.nombre ?? null,
      proveedor_id: prod.proveedor_id,
      proveedor_nombre: prov?.nombre ?? null,
      stock_actual: stockActual,
      stock_minimo: stockMinimo,
      unidades_periodo: 0,
    });
  }

  const hoy = ymdLocal(new Date());

  type Fila = {
    producto_id: string;
    codigo: string;
    nombre: string;
    unidad: UnidadMedida;
    categoria: string | null;
    proveedor_id: string | null;
    proveedor: string | null;
    unidades_periodo: number;
    consumo_diario: number | null;
    dias_cobertura: number | null;
    fecha_agot_estimada: string | null;
    stock_actual: number;
    stock_minimo: number;
    quiebre: boolean;
    dias_objetivo: number;
    cantidad_sugerida: number;
    motivos: string[];
  };

  const filasRaw: Fila[] = [];

  for (const r of agg.values()) {
    const unidadesNetas = Math.max(0, r.unidades_periodo);
    const consumoDiario = unidadesNetas > 0 ? unidadesNetas / diasPeriodo : null;
    const diasCobertura =
      consumoDiario != null && consumoDiario > 1e-9 ? r.stock_actual / consumoDiario : null;
    const fechaAgot =
      diasCobertura != null && Number.isFinite(diasCobertura) && consumoDiario != null && consumoDiario > 0
        ? addCalendarDays(hoy, Math.max(0, Math.floor(diasCobertura)))
        : null;

    const targetPorRitmo = consumoDiario != null && consumoDiario > 0 ? consumoDiario * diasObjetivo : 0;
    const desdeObjetivo = Math.max(0, targetPorRitmo - r.stock_actual);
    const desdeMinimo = Math.max(0, r.stock_minimo - r.stock_actual);
    const cantidadSugerida = redondearCantidadSugerida(Math.max(desdeObjetivo, desdeMinimo));

    const motivos: string[] = [];
    if (quiebre(r.stock_actual, r.stock_minimo)) motivos.push('bajo_minimo');
    if (consumoDiario != null && consumoDiario > 0 && diasCobertura != null && diasCobertura < diasObjetivo) {
      motivos.push('baja_cobertura');
    }
    if (r.unidades_periodo <= 0 && quiebre(r.stock_actual, r.stock_minimo)) {
      motivos.push('sin_ventas_periodo');
    }

    const qFlag = quiebre(r.stock_actual, r.stock_minimo);
    filasRaw.push({
      producto_id: r.producto_id,
      codigo: r.codigo,
      nombre: r.nombre,
      unidad: r.unidad,
      categoria: r.categoria_nombre,
      proveedor_id: r.proveedor_id,
      proveedor: r.proveedor_nombre,
      unidades_periodo: round2(r.unidades_periodo),
      consumo_diario: consumoDiario != null ? round2(consumoDiario) : null,
      dias_cobertura: diasCobertura != null && Number.isFinite(diasCobertura) ? round2(diasCobertura) : null,
      fecha_agot_estimada: fechaAgot,
      stock_actual: r.stock_actual,
      stock_minimo: r.stock_minimo,
      quiebre: qFlag,
      dias_objetivo: diasObjetivo,
      cantidad_sugerida: cantidadSugerida,
      motivos,
    });
  }

  const filasFiltradas =
    filtro === 'todos'
      ? filasRaw.filter((f) => sinProveedor || f.proveedor_id != null)
      : filasRaw.filter((f) => {
          if (!sinProveedor && f.proveedor_id == null) return false;
          return (
            f.cantidad_sugerida > 0 ||
            f.quiebre ||
            (f.consumo_diario != null &&
              f.consumo_diario > 0 &&
              f.dias_cobertura != null &&
              f.dias_cobertura < diasObjetivo)
          );
        });

  filasFiltradas.sort((a, b) => {
    const pa = (a.proveedor ?? '\uffff').localeCompare(b.proveedor ?? '\uffff', 'es');
    if (pa !== 0) return pa;
    return a.codigo.localeCompare(b.codigo, 'es');
  });

  const limite = filtro === 'todos' ? 500 : filasFiltradas.length;
  const filas = filasFiltradas.slice(0, limite);

  if (exportFmt === 'csv') {
    const header =
      'proveedor,codigo,nombre,unidad,categoria,unidades_periodo,consumo_diario,dias_cobertura,fecha_agot_estimada,stock_actual,stock_minimo,quiebre,dias_objetivo,cantidad_sugerida,motivos';
    const lines = [
      header,
      ...filas.map((it) =>
        [
          csvEscape(it.proveedor ?? ''),
          csvEscape(it.codigo),
          csvEscape(it.nombre),
          csvEscape(it.unidad),
          csvEscape(it.categoria ?? ''),
          csvEscape(it.unidades_periodo),
          csvEscape(it.consumo_diario ?? ''),
          csvEscape(it.dias_cobertura ?? ''),
          csvEscape(it.fecha_agot_estimada ?? ''),
          csvEscape(it.stock_actual),
          csvEscape(it.stock_minimo),
          csvEscape(it.quiebre ? 'si' : 'no'),
          csvEscape(it.dias_objetivo),
          csvEscape(it.cantidad_sugerida),
          csvEscape(it.motivos.join(';')),
        ].join(','),
      ),
    ];
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="reposicion-proveedor-${periodo.desde}-${periodo.hasta}.csv"`,
      },
    });
  }

  return NextResponse.json({
    sucursal_id: sucursalId,
    periodo,
    parametros: {
      dias_analisis: diasPeriodo,
      dias_objetivo_cobertura: diasObjetivo,
      filtro,
      sin_proveedor: sinProveedor,
      categoria_id: categoriaId || null,
      proveedor_id: proveedorId || null,
    },
    indicadores: {
      articulos: filas.length,
      con_sugerencia_positiva: filas.filter((f) => f.cantidad_sugerida > 0).length,
    },
    nota:
      'Consumo según líneas de comprobantes emitidos (tickets y facturas; notas de crédito restan). Los tickets fiscalizados no duplican venta. Con sucursal seleccionada, las líneas se filtran por la sucursal del comprobante y el stock/mínimo mostrado es el de ese depósito (`stock_sucursal`); sin sucursal, el consumo agrega todas las sucursales y el catálogo de quiebres usa el stock global del producto. Cobertura y fecha de agotamiento son estimaciones a partir del ritmo medio del período; no contemplan estacionalidad ni promociones. Cantidad sugerida = máximo entre cubrir el objetivo de días de venta y alcanzar el stock mínimo. Artículos en quiebre sin ventas en el período se listan con consumo cero.',
    filas,
  });
}
