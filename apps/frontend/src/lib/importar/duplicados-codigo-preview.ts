import type { FilaValidada } from '@/lib/normalizador/validar';

function datosTienenCodigoBarras(f: FilaValidada): boolean {
  const raw = f.datos.codigo_barras;
  return raw != null && String(raw).trim() !== '';
}

function stockActualComoNumero(f: FilaValidada): number {
  const v = f.datos.stock_actual;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
}

function filaTieneStockPositivo(f: FilaValidada): boolean {
  return stockActualComoNumero(f) > 0;
}

function precioCostoComoNumero(f: FilaValidada): number {
  const c = f.datos.precio_costo;
  if (c != null && typeof c === 'number' && Number.isFinite(c)) return c;
  return Number.NEGATIVE_INFINITY;
}

/**
 * Elige qué fila conservar al unificar por el mismo código: 1) con código de barras,
 * 2) con stock > 0, 3) mayor costo, 4) desempate: menor número de fila en el archivo.
 */
export function filaRecomendadaUnificarMismoCodigo(filas: FilaValidada[]): number {
  if (filas.length === 0) return 0;
  if (filas.length === 1) return filas[0]!.filaOriginal;

  const mejor = filas.reduce((a, b) => {
    const aBar = datosTienenCodigoBarras(a);
    const bBar = datosTienenCodigoBarras(b);
    if (aBar !== bBar) return aBar ? a : b;

    const aSt = filaTieneStockPositivo(a);
    const bSt = filaTieneStockPositivo(b);
    if (aSt !== bSt) return aSt ? a : b;

    const ca = precioCostoComoNumero(a);
    const cb = precioCostoComoNumero(b);
    if (ca !== cb) return ca >= cb ? a : b;

    return a.filaOriginal <= b.filaOriginal ? a : b;
  });
  return mejor.filaOriginal;
}

export type GrupoDuplicadoCodigo = {
  /** Clave estable para resolución (código trimeado, minúsculas). */
  codigoClave: string;
  /** Texto mostrado (primer código visto, sin forzar mayúsculas). */
  codigoDisplay: string;
  filas: FilaValidada[];
  /** Si cada fila puede ser un producto distinto. */
  puedeSeparar: boolean;
};

function normCod(c: string): string {
  return c.trim().toLowerCase();
}

/**
 * Grupos de filas válidas con el mismo código (normalizado) y al menos 2 filas.
 */
export function agruparDuplicadosPorCodigo(validas: FilaValidada[]): GrupoDuplicadoCodigo[] {
  const map = new Map<string, { display: string; filas: FilaValidada[] }>();

  for (const f of validas) {
    if (!f.valida) continue;
    const raw = f.datos.codigo;
    if (raw == null || String(raw).trim() === '') continue;
    const k = normCod(String(raw));
    if (!map.has(k)) {
      map.set(k, { display: String(raw).trim(), filas: [] });
    }
    map.get(k)!.filas.push(f);
  }

  const out: GrupoDuplicadoCodigo[] = [];
  for (const [codigoClave, { display, filas }] of map) {
    if (filas.length < 2) continue;
    out.push({ codigoClave, codigoDisplay: display, filas, puedeSeparar: true });
  }
  return out;
}

export type ResolucionDuplicadoGrupo =
  | { mode: 'separar' }
  | { mode: 'unificar'; filaElegidaFilaOriginal: number };

/**
 * Quita filas sobrantes cuando se elige "unificar" (una fila por código de grupo).
 */
export function aplicarResolucionDuplicadosPorCodigo(
  validas: FilaValidada[],
  grupos: GrupoDuplicadoCodigo[],
  resolucion: Record<string, ResolucionDuplicadoGrupo>,
): FilaValidada[] {
  const aQuitar = new Set<number>();
  for (const g of grupos) {
    const r = resolucion[g.codigoClave];
    if (!r || r.mode !== 'unificar') continue;
    for (const f of g.filas) {
      if (f.filaOriginal !== r.filaElegidaFilaOriginal) aQuitar.add(f.filaOriginal);
    }
  }
  if (aQuitar.size === 0) return validas;
  return validas.filter((f) => !aQuitar.has(f.filaOriginal));
}
