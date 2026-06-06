import { round2 } from '../../reports/utils/report-comprobante-rules.util';
import { signoTipo, type VentaLinea } from './ventas-lineas.util';

export type MargenProducto = {
  producto_id: string;
  producto_nombre: string;
  categoria_id: string | null;
  categoria_nombre: string | null;
  unidades_vendidas: number;
  ingresos: number;
  costos: number;
  margen_bruto: number;
  margen_pct: number;
  contribucion_absoluta: number;
};

export type MargenRealOutput = {
  productos: MargenProducto[];
  evolucion_mensual: {
    periodo: string;
    ingresos: number;
    costos: number;
    margen_bruto: number;
    margen_pct: number;
  }[];
  tendencia: {
    ultimo_mes_pct: number | null;
    promedio_3m_pct: number | null;
    direccion: 'sube' | 'baja' | 'estable';
  };
  alertas: {
    producto_id: string;
    producto_nombre: string;
    margen_actual_pct: number;
    margen_promedio_pct: number;
    caida_pct: number;
    tipo: 'caida_margen';
  }[];
  ranking_contribucion: MargenProducto[];
};

type ProdInfo = { id: string; nombre: string; categoriaId: string | null };

export function calcularMargenRealFromLineas(
  lineas: VentaLinea[],
  productos: ProdInfo[],
  catMap: Map<string, string>,
  filtros?: { productoId?: string; categoriaId?: string },
): MargenRealOutput {
  if (lineas.length === 0) return emptyMargenOutput();

  const prodMap = new Map(productos.map((p) => [p.id, p]));
  let filteredIds: Set<string> | null = null;
  if (filtros?.categoriaId) {
    filteredIds = new Set(
      productos.filter((p) => p.categoriaId === filtros.categoriaId).map((p) => p.id),
    );
  }
  if (filtros?.productoId) filteredIds = new Set([filtros.productoId]);

  const prodAgg = new Map<string, { unidades: number; ingresos: number; costos: number }>();
  const mesAgg = new Map<string, { ingresos: number; costos: number }>();
  const prodMesAgg = new Map<string, Map<string, { ingresos: number; costos: number }>>();

  for (const row of lineas) {
    if (filteredIds && !filteredIds.has(row.producto_id)) continue;
    if (!prodMap.has(row.producto_id)) continue;

    const signo = signoTipo(row.tipo);
    const ingreso = row.precio_unitario * row.cantidad * signo;
    const costo = row.precio_costo * row.cantidad * signo;
    const unidades = row.cantidad * signo;

    const prev = prodAgg.get(row.producto_id) ?? { unidades: 0, ingresos: 0, costos: 0 };
    prev.unidades += unidades;
    prev.ingresos += ingreso;
    prev.costos += costo;
    prodAgg.set(row.producto_id, prev);

    const periodo = row.fecha.slice(0, 7);
    const mPrev = mesAgg.get(periodo) ?? { ingresos: 0, costos: 0 };
    mPrev.ingresos += ingreso;
    mPrev.costos += costo;
    mesAgg.set(periodo, mPrev);

    if (!prodMesAgg.has(row.producto_id)) prodMesAgg.set(row.producto_id, new Map());
    const pmMap = prodMesAgg.get(row.producto_id)!;
    const pmPrev = pmMap.get(periodo) ?? { ingresos: 0, costos: 0 };
    pmPrev.ingresos += ingreso;
    pmPrev.costos += costo;
    pmMap.set(periodo, pmPrev);
  }

  const productosResult: MargenProducto[] = [];
  for (const [pid, agg] of prodAgg) {
    const prod = prodMap.get(pid);
    if (!prod || agg.ingresos <= 0) continue;
    const margenBruto = agg.ingresos - agg.costos;
    const margenPct = agg.costos > 0 ? (margenBruto / agg.costos) * 100 : 0;
    productosResult.push({
      producto_id: pid,
      producto_nombre: prod.nombre,
      categoria_id: prod.categoriaId,
      categoria_nombre: prod.categoriaId ? (catMap.get(prod.categoriaId) ?? null) : null,
      unidades_vendidas: round2(agg.unidades),
      ingresos: round2(agg.ingresos),
      costos: round2(agg.costos),
      margen_bruto: round2(margenBruto),
      margen_pct: round2(margenPct),
      contribucion_absoluta: round2(margenBruto),
    });
  }

  const meses = [...mesAgg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, agg]) => {
      const margen = agg.ingresos - agg.costos;
      return {
        periodo,
        ingresos: round2(agg.ingresos),
        costos: round2(agg.costos),
        margen_bruto: round2(margen),
        margen_pct: round2(agg.costos > 0 ? (margen / agg.costos) * 100 : 0),
      };
    });

  const ultimosMeses = meses.slice(-3);
  const ultimoMesPct = meses.length > 0 ? meses[meses.length - 1].margen_pct : null;
  const promedio3m =
    ultimosMeses.length > 0
      ? round2(ultimosMeses.reduce((s, m) => s + m.margen_pct, 0) / ultimosMeses.length)
      : null;

  let direccion: 'sube' | 'baja' | 'estable' = 'estable';
  if (ultimosMeses.length >= 2) {
    const primero = ultimosMeses[0].margen_pct;
    const ultimo = ultimosMeses[ultimosMeses.length - 1].margen_pct;
    if (ultimo > primero + 2) direccion = 'sube';
    else if (ultimo < primero - 2) direccion = 'baja';
  }

  const alertas: MargenRealOutput['alertas'] = [];
  const mesesOrdenados = [...mesAgg.keys()].sort();
  const ultimoMes = mesesOrdenados.length > 0 ? mesesOrdenados[mesesOrdenados.length - 1] : null;
  const mesesRecientes = mesesOrdenados.slice(-3);
  const UMBRAL = 5;

  if (ultimoMes && mesesRecientes.length >= 2) {
    for (const [pid, mMap] of prodMesAgg) {
      const prod = prodMap.get(pid);
      if (!prod) continue;
      const mesActual = mMap.get(ultimoMes);
      if (!mesActual || mesActual.costos <= 0) continue;
      const margenActual = ((mesActual.ingresos - mesActual.costos) / mesActual.costos) * 100;
      const mesesPrevios = mesesRecientes.slice(0, -1);
      const margenesPrev: number[] = [];
      for (const m of mesesPrevios) {
        const d = mMap.get(m);
        if (d && d.costos > 0) margenesPrev.push(((d.ingresos - d.costos) / d.costos) * 100);
      }
      if (margenesPrev.length === 0) continue;
      const promedio = margenesPrev.reduce((s, v) => s + v, 0) / margenesPrev.length;
      const caida = promedio - margenActual;
      if (caida > UMBRAL) {
        alertas.push({
          producto_id: pid,
          producto_nombre: prod.nombre,
          margen_actual_pct: round2(margenActual),
          margen_promedio_pct: round2(promedio),
          caida_pct: round2(caida),
          tipo: 'caida_margen',
        });
      }
    }
  }
  alertas.sort((a, b) => b.caida_pct - a.caida_pct);

  const ranking = [...productosResult].sort((a, b) => b.contribucion_absoluta - a.contribucion_absoluta);

  return {
    productos: productosResult,
    evolucion_mensual: meses,
    tendencia: { ultimo_mes_pct: ultimoMesPct, promedio_3m_pct: promedio3m, direccion },
    alertas: alertas.slice(0, 20),
    ranking_contribucion: ranking.slice(0, 20),
  };
}

function emptyMargenOutput(): MargenRealOutput {
  return {
    productos: [],
    evolucion_mensual: [],
    tendencia: { ultimo_mes_pct: null, promedio_3m_pct: null, direccion: 'estable' },
    alertas: [],
    ranking_contribucion: [],
  };
}
