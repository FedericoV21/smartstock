const PESO_PRECIO = 0.4;
const PESO_ESTABILIDAD = 0.35;
const PESO_FRECUENCIA = 0.25;

export type ProveedorScore = {
  proveedor_id: string;
  proveedor_nombre: string;
  precio_promedio: number;
  variacion_promedio_pct: number;
  estabilidad_score: number;
  frecuencia_listas: number;
  score_total: number;
};

export type RelacionProductoProveedor = {
  proveedorId: string;
  productoId: string;
  precioCosto: number;
};

export type ListaProveedorMini = {
  proveedorId: string;
  variacionPromedioPct: number | null;
};

export function calcularScoresProveedores(
  relaciones: RelacionProductoProveedor[],
  nombres: Map<string, string>,
  listas: ListaProveedorMini[],
): ProveedorScore[] {
  if (relaciones.length === 0) return [];

  const proveedorMap = new Map<string, { precios: number[] }>();
  for (const r of relaciones) {
    if (!proveedorMap.has(r.proveedorId)) {
      proveedorMap.set(r.proveedorId, { precios: [] });
    }
    proveedorMap.get(r.proveedorId)!.precios.push(r.precioCosto);
  }

  const listasMap = new Map<string, number[]>();
  const frecuenciaMap = new Map<string, number>();
  for (const l of listas) {
    if (!listasMap.has(l.proveedorId)) listasMap.set(l.proveedorId, []);
    if (l.variacionPromedioPct != null) {
      listasMap.get(l.proveedorId)!.push(l.variacionPromedioPct);
    }
    frecuenciaMap.set(l.proveedorId, (frecuenciaMap.get(l.proveedorId) ?? 0) + 1);
  }

  const allAvgPrecios: number[] = [];
  for (const [, data] of proveedorMap) {
    const avg = data.precios.reduce((s, p) => s + p, 0) / data.precios.length;
    allAvgPrecios.push(avg);
  }

  const maxPrecio = Math.max(...allAvgPrecios, 1);
  const maxFrec = Math.max(...[...frecuenciaMap.values()], 1);

  const scores: ProveedorScore[] = [];
  for (const [provId, data] of proveedorMap) {
    const avgPrecio = data.precios.reduce((s, p) => s + p, 0) / data.precios.length;
    const variaciones = listasMap.get(provId) ?? [];
    const avgVar =
      variaciones.length > 0 ? variaciones.reduce((s, v) => s + v, 0) / variaciones.length : 0;

    const varianza =
      variaciones.length > 1
        ? variaciones.reduce((s, v) => s + (v - avgVar) ** 2, 0) / variaciones.length
        : 0;
    const estabilidad = Math.max(0, 1 - Math.sqrt(varianza) / 20);
    const precioScore = 1 - avgPrecio / maxPrecio;
    const frecuencia = frecuenciaMap.get(provId) ?? 0;
    const frecScore = frecuencia / maxFrec;

    const total =
      precioScore * PESO_PRECIO + estabilidad * PESO_ESTABILIDAD + frecScore * PESO_FRECUENCIA;

    scores.push({
      proveedor_id: provId,
      proveedor_nombre: nombres.get(provId) ?? provId,
      precio_promedio: Math.round(avgPrecio * 100) / 100,
      variacion_promedio_pct: Math.round(avgVar * 100) / 100,
      estabilidad_score: Math.round(estabilidad * 100) / 100,
      frecuencia_listas: frecuencia,
      score_total: Math.round(total * 100) / 100,
    });
  }

  scores.sort((a, b) => b.score_total - a.score_total);
  return scores;
}

export function regresionLineal(valores: number[]): { pendiente: number; prediccion: number } {
  const n = valores.length;
  if (n < 2) return { pendiente: 0, prediccion: valores[0] ?? 0 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += valores[i];
    sumXY += i * valores[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { pendiente: 0, prediccion: valores[n - 1] ?? 0 };

  const pendiente = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - pendiente * sumX) / n;
  const prediccion = pendiente * n + intercept;

  return {
    pendiente: Math.round(pendiente * 100) / 100,
    prediccion: Math.round(prediccion * 100) / 100,
  };
}
