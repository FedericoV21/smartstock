import type { FilaValidada } from '@/lib/normalizador/validar';

/**
 * Al menos una fila válida trae costo y stock numéricos (p. ej. columna mapeada con valores).
 * Sirve para avisar al elegir "solo precios" que el stock del archivo no se aplicará.
 */
export function importPreviewTieneStockYPrecio(filas: FilaValidada[]): boolean {
  for (const f of filas) {
    if (!f.valida) continue;
    const d = f.datos;
    const p = d.precio_costo;
    const s = d.stock_actual;
    if (typeof p === 'number' && !Number.isNaN(p) && s != null && typeof s === 'number' && !Number.isNaN(s)) {
      return true;
    }
  }
  return false;
}
