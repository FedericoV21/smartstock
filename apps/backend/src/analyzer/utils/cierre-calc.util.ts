import { round2 } from '../../reports/utils/report-comprobante-rules.util';
import type { CategoriaResumenCierre, TopProductoCierre } from '../entities/cierre-mensual.entity';
import { signoTipo, type VentaLinea } from './ventas-lineas.util';

export type CierreCalculado = {
  periodo: string;
  ingresos_brutos: number;
  costo_mercaderia: number;
  margen_bruto: number;
  margen_bruto_pct: number | null;
  unidades_vendidas: number;
  comprobantes_emitidos: number;
  ticket_promedio: number | null;
  top_productos: TopProductoCierre[];
  por_categoria: CategoriaResumenCierre[];
};

type ProdInfo = { id: string; nombre: string; categoriaId: string | null };

export function calcularCierreFromLineas(
  periodo: string,
  lineas: VentaLinea[],
  comprobantesCount: number,
  productos: ProdInfo[],
  catMap: Map<string, string>,
): CierreCalculado {
  if (lineas.length === 0) {
    return {
      periodo,
      ingresos_brutos: 0,
      costo_mercaderia: 0,
      margen_bruto: 0,
      margen_bruto_pct: null,
      unidades_vendidas: 0,
      comprobantes_emitidos: 0,
      ticket_promedio: null,
      top_productos: [],
      por_categoria: [],
    };
  }

  const prodMap = new Map(productos.map((p) => [p.id, p]));
  let ingresos = 0;
  let costos = 0;
  let unidades = 0;
  const prodAgg = new Map<string, { ingresos: number; costos: number; unidades: number }>();
  const catAgg = new Map<string, { ingresos: number; costos: number }>();

  for (const item of lineas) {
    const signo = signoTipo(item.tipo);
    const ing = item.precio_unitario * item.cantidad * signo;
    const cos = item.precio_costo * item.cantidad * signo;
    const uni = item.cantidad * signo;
    ingresos += ing;
    costos += cos;
    unidades += uni;

    const prev = prodAgg.get(item.producto_id) ?? { ingresos: 0, costos: 0, unidades: 0 };
    prev.ingresos += ing;
    prev.costos += cos;
    prev.unidades += uni;
    prodAgg.set(item.producto_id, prev);

    const prod = prodMap.get(item.producto_id);
    if (prod?.categoriaId) {
      const cp = catAgg.get(prod.categoriaId) ?? { ingresos: 0, costos: 0 };
      cp.ingresos += ing;
      cp.costos += cos;
      catAgg.set(prod.categoriaId, cp);
    }
  }

  const margen = ingresos - costos;
  const compCount = comprobantesCount;

  const topProductos: TopProductoCierre[] = [...prodAgg.entries()]
    .map(([pid, agg]) => ({
      producto_id: pid,
      producto_nombre: prodMap.get(pid)?.nombre ?? pid,
      ingresos: round2(agg.ingresos),
      margen_bruto: round2(agg.ingresos - agg.costos),
      unidades: round2(agg.unidades),
    }))
    .sort((a, b) => b.ingresos - a.ingresos)
    .slice(0, 10);

  const porCategoria: CategoriaResumenCierre[] = [...catAgg.entries()]
    .map(([catId, agg]) => ({
      categoria_id: catId,
      categoria_nombre: catMap.get(catId) ?? catId,
      ingresos: round2(agg.ingresos),
      costos: round2(agg.costos),
      margen_bruto: round2(agg.ingresos - agg.costos),
      margen_pct: round2(agg.costos > 0 ? ((agg.ingresos - agg.costos) / agg.costos) * 100 : 0),
    }))
    .sort((a, b) => b.ingresos - a.ingresos);

  return {
    periodo,
    ingresos_brutos: round2(ingresos),
    costo_mercaderia: round2(costos),
    margen_bruto: round2(margen),
    margen_bruto_pct: round2(costos > 0 ? (margen / costos) * 100 : 0),
    unidades_vendidas: Math.round(unidades),
    comprobantes_emitidos: compCount,
    ticket_promedio: compCount > 0 ? round2(ingresos / compCount) : null,
    top_productos: topProductos,
    por_categoria: porCategoria,
  };
}
