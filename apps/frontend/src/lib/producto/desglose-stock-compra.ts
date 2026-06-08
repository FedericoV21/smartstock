import type { Database } from '@/types/database';

type Unidad = Database['public']['Enums']['unidad_medida'];

const ETIQUETA_STOCK: Record<Unidad, string> = {
  unidad: 'u.',
  kg: 'kg',
  litro: 'l',
  metro: 'm',
  caja: 'caja',
  pack: 'pack',
  gramo: 'g',
  ml: 'ml',
};

const ETIQUETA_COMPRA: Partial<Record<Unidad, { uno: string; varios: string }>> = {
  caja: { uno: 'caja', varios: 'cajas' },
  pack: { uno: 'pack', varios: 'packs' },
  unidad: { uno: 'ud. compra', varios: 'uds. compra' },
  kg: { uno: 'kg compra', varios: 'kg compra' },
  gramo: { uno: 'g compra', varios: 'g compra' },
  litro: { uno: 'l compra', varios: 'l compra' },
  ml: { uno: 'ml compra', varios: 'ml compra' },
  metro: { uno: 'm compra', varios: 'm compra' },
};

export type LineaStockCompra = {
  /** Stock en unidad base (como guarda la DB) */
  base: string;
  /** Si hay presentación de compra: equivalente en cajas/packs + sueltas */
  desgloseCompra?: string;
};

/**
 * Muestra stock en unidad base y, si aplica, cuántas unidades de compra completas + resto en unidades de stock.
 */
export function lineasStockConPresentacionCompra(
  cantidadBase: number,
  unidadStock: Unidad,
  unidadCompra: Unidad | null | undefined,
  contenidoPorCompra: number | null | undefined,
): LineaStockCompra {
  const uLabel = ETIQUETA_STOCK[unidadStock] ?? String(unidadStock);
  const base = `${cantidadBase} ${uLabel}`;

  const c =
    unidadCompra != null &&
    contenidoPorCompra != null &&
    contenidoPorCompra > 0 &&
    Number.isFinite(contenidoPorCompra)
      ? contenidoPorCompra
      : null;
  if (c == null || unidadCompra == null) {
    return { base };
  }

  const n = Math.floor(cantidadBase / c);
  const resto = cantidadBase % c;
  const et = ETIQUETA_COMPRA[unidadCompra] ?? {
    uno: unidadCompra,
    varios: String(unidadCompra),
  };
  const palabra = n === 1 ? et.uno : et.varios;
  if (resto === 0) {
    return { base, desgloseCompra: `${n} ${palabra}` };
  }
  return { base, desgloseCompra: `${n} ${palabra} + ${resto} u.` };
}
