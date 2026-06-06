import { IVA_DEFAULT_PCT } from '../../products/utils/calcular-precio-venta';

export type ItemImporteInput = {
  productoId: string;
  cantidad: number;
  precioUnitario: number;
  ivaPorcentaje?: number | null;
};

export type ImportesCompra = {
  subtotal: number;
  ivaPorcentaje: number;
  ivaMonto: number;
  total: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function discriminaIva(tipo: string): boolean {
  return (
    tipo === 'factura_a' ||
    tipo === 'factura_b' ||
    tipo === 'nota_credito_a' ||
    tipo === 'nota_credito_b'
  );
}

/**
 * Compra manual: precio unitario neto (sin IVA en l├¡nea).
 */
export function calcularImportesCompra(
  items: ItemImporteInput[],
  tipoComprobante: string,
  ivaDefault: number = IVA_DEFAULT_PCT,
): ImportesCompra {
  const grupos = new Map<number, number>();

  for (const item of items) {
    const rate = item.ivaPorcentaje ?? ivaDefault;
    const lineSub = round2(item.cantidad * item.precioUnitario);
    grupos.set(rate, round2((grupos.get(rate) ?? 0) + lineSub));
  }

  if (!discriminaIva(tipoComprobante)) {
    const subtotal = round2([...grupos.values()].reduce((s, v) => s + v, 0));
    return {
      subtotal,
      ivaPorcentaje: ivaDefault,
      ivaMonto: 0,
      total: subtotal,
    };
  }

  let subtotalNeto = 0;
  let ivaMonto = 0;
  let rateDominante = ivaDefault;
  let maxIva = -1;

  for (const [rate, neto] of grupos) {
    subtotalNeto = round2(subtotalNeto + neto);
    const ivaLine = round2((Math.round(neto * 100) * rate) / 10000);
    ivaMonto = round2(ivaMonto + ivaLine);
    if (ivaLine > maxIva) {
      maxIva = ivaLine;
      rateDominante = rate;
    }
  }

  return {
    subtotal: subtotalNeto,
    ivaPorcentaje: rateDominante,
    ivaMonto,
    total: round2(subtotalNeto + ivaMonto),
  };
}

export function importesDesdeCabeceraManual(opts: {
  subtotal: number;
  ivaMonto: number;
  total: number;
  percepciones?: number;
  fallbackIvaPct?: number;
}): ImportesCompra {
  const subtotal = round2(Math.max(0, opts.subtotal));
  const ivaMonto = round2(Math.max(0, opts.ivaMonto));
  const percepciones = round2(Math.max(0, opts.percepciones ?? 0));
  const total = round2(Math.max(0, opts.total));
  const ivaPorcentaje =
    subtotal > 0 && ivaMonto > 0
      ? round2((ivaMonto * 100) / subtotal)
      : (opts.fallbackIvaPct ?? IVA_DEFAULT_PCT);

  return {
    subtotal,
    ivaPorcentaje,
    ivaMonto,
    total: percepciones > 0 ? round2(total) : total,
  };
}

export function totalPercepciones(opts: {
  percepcionIibbMonto?: number;
  percepcionIvaMonto?: number;
  impuestoInternoMonto?: number;
}): number {
  return round2(
    Math.max(0, opts.percepcionIibbMonto ?? 0) +
      Math.max(0, opts.percepcionIvaMonto ?? 0) +
      Math.max(0, opts.impuestoInternoMonto ?? 0),
  );
}
