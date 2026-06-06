import { round2 } from '../../reports/utils/report-comprobante-rules.util';
import { signoTipo, type VentaLinea } from './ventas-lineas.util';

export type ClasificacionBCG = 'estrella' | 'vaca' | 'interrogacion' | 'lastre';

export type ProductoBCG = {
  producto_id: string;
  producto_nombre: string;
  categoria_id: string | null;
  categoria_nombre: string | null;
  margen_pct: number;
  rotacion: number;
  contribucion_absoluta: number;
  clasificacion: ClasificacionBCG;
  score: number;
};

export type RankingBCGOutput = {
  productos: ProductoBCG[];
  top_estrellas: ProductoBCG[];
  top_lastres: ProductoBCG[];
  medianas: { margen_mediana_pct: number; rotacion_mediana: number };
};

type ProdInfo = { id: string; nombre: string; categoriaId: string | null };

function mediana(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clasificar(
  margenPct: number,
  rotacion: number,
  medianaMargen: number,
  medianaRotacion: number,
): ClasificacionBCG {
  const altoMargen = margenPct >= medianaMargen;
  const altaRotacion = rotacion >= medianaRotacion;
  if (altoMargen && altaRotacion) return 'estrella';
  if (altoMargen && !altaRotacion) return 'vaca';
  if (!altoMargen && altaRotacion) return 'interrogacion';
  return 'lastre';
}

export function calcularRankingBCGFromLineas(
  lineas: VentaLinea[],
  productos: ProdInfo[],
  catMap: Map<string, string>,
  categoriaId?: string,
): RankingBCGOutput {
  const empty = (): RankingBCGOutput => ({
    productos: [],
    top_estrellas: [],
    top_lastres: [],
    medianas: { margen_mediana_pct: 0, rotacion_mediana: 0 },
  });

  if (lineas.length === 0) return empty();

  const prodAgg = new Map<string, { unidades: number; ingresos: number; costos: number }>();
  for (const it of lineas) {
    const signo = signoTipo(it.tipo);
    const prev = prodAgg.get(it.producto_id) ?? { unidades: 0, ingresos: 0, costos: 0 };
    prev.unidades += it.cantidad * signo;
    prev.ingresos += it.precio_unitario * it.cantidad * signo;
    prev.costos += it.precio_costo * it.cantidad * signo;
    prodAgg.set(it.producto_id, prev);
  }

  const prodInfoMap = new Map(productos.map((p) => [p.id, p]));
  let filteredSet: Set<string> | null = null;
  if (categoriaId) {
    filteredSet = new Set(
      productos.filter((p) => p.categoriaId === categoriaId).map((p) => p.id),
    );
  }

  const rawProducts: { pid: string; margenPct: number; rotacion: number; contribucion: number }[] = [];
  for (const [pid, agg] of prodAgg) {
    if (filteredSet && !filteredSet.has(pid)) continue;
    if (!prodInfoMap.has(pid) || agg.ingresos <= 0) continue;
    const margenBruto = agg.ingresos - agg.costos;
    rawProducts.push({
      pid,
      margenPct: agg.costos > 0 ? (margenBruto / agg.costos) * 100 : 0,
      rotacion: Math.max(0, agg.unidades),
      contribucion: margenBruto,
    });
  }

  if (rawProducts.length === 0) return empty();

  const medianaMargen = mediana(rawProducts.map((p) => p.margenPct));
  const medianaRotacion = mediana(rawProducts.map((p) => p.rotacion));
  const scoreMap: Record<ClasificacionBCG, number> = {
    estrella: 4,
    vaca: 3,
    interrogacion: 2,
    lastre: 1,
  };

  const result: ProductoBCG[] = rawProducts.map((rp) => {
    const prod = prodInfoMap.get(rp.pid)!;
    const cls = clasificar(rp.margenPct, rp.rotacion, medianaMargen, medianaRotacion);
    return {
      producto_id: rp.pid,
      producto_nombre: prod.nombre,
      categoria_id: prod.categoriaId,
      categoria_nombre: prod.categoriaId ? (catMap.get(prod.categoriaId) ?? null) : null,
      margen_pct: round2(rp.margenPct),
      rotacion: round2(rp.rotacion),
      contribucion_absoluta: round2(rp.contribucion),
      clasificacion: cls,
      score: scoreMap[cls],
    };
  });

  result.sort((a, b) => b.score - a.score || b.contribucion_absoluta - a.contribucion_absoluta);

  return {
    productos: result,
    top_estrellas: result.filter((p) => p.clasificacion === 'estrella').slice(0, 10),
    top_lastres: result.filter((p) => p.clasificacion === 'lastre').slice(0, 10),
    medianas: {
      margen_mediana_pct: round2(medianaMargen),
      rotacion_mediana: round2(medianaRotacion),
    },
  };
}
