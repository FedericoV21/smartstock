export type OpcionFinanciacion = {
  medioNombre: string;
  cuotas: number;
  recargo_porcentaje: number;
};

export type ImportesBase = {
  subtotal: number;
  ivaPorcentaje: number;
  ivaMonto: number;
  total: number;
};

export type FinanciacionEmitResult = {
  importes: ImportesBase;
  totalMercaderia: number;
  financiacionMonto: number;
  financiacionPorcentaje: number;
  financiacionDescripcion: string;
  impTribArca: number;
  medioPagoOpcionId: string | null;
  metodoPagoDetalle: Record<string, number> | null;
  esPagoMixto: boolean;
};

export const PARTES_PAGO_MIXTO = ['efectivo', 'debito', 'credito', 'transferencia'] as const;
export type PartePagoMixto = (typeof PARTES_PAGO_MIXTO)[number];

const LABEL_PARTE_MIXTO: Record<PartePagoMixto, string> = {
  efectivo: 'Efectivo',
  debito: 'D├®bito',
  credito: 'Cr├®dito',
  transferencia: 'Transferencia',
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sinFinanciacion(importes: ImportesBase): FinanciacionEmitResult {
  return {
    importes: { ...importes },
    totalMercaderia: importes.total,
    financiacionMonto: 0,
    financiacionPorcentaje: 0,
    financiacionDescripcion: '',
    impTribArca: 0,
    medioPagoOpcionId: null,
    metodoPagoDetalle: null,
    esPagoMixto: false,
  };
}

/**
 * Recargo/descuento por medio de pago (paridad front `financiacion.ts`, una al├¡cuota IVA).
 */
export function aplicarFinanciacion(
  importes: ImportesBase,
  opcion: OpcionFinanciacion | null,
): FinanciacionEmitResult {
  const mercaderiaTotal = importes.total;
  if (!opcion) {
    return sinFinanciacion(importes);
  }

  const pct = opcion.recargo_porcentaje;
  const monto = round2((mercaderiaTotal * pct) / 100);
  const cuotasLabel = opcion.cuotas === 1 ? 'contado' : `${opcion.cuotas} cuotas`;
  const financiacionDescripcion =
    pct >= 0
      ? `${opcion.medioNombre} (${cuotasLabel}, ${pct}% recargo)`
      : `${opcion.medioNombre} (${cuotasLabel}, ${Math.abs(pct)}% desc.)`;

  if (monto >= 0) {
    const totalFinal = round2(mercaderiaTotal + monto);
    return {
      importes: { ...importes, total: totalFinal },
      totalMercaderia: mercaderiaTotal,
      financiacionMonto: monto,
      financiacionPorcentaje: pct,
      financiacionDescripcion,
      impTribArca: monto > 0.001 ? monto : 0,
      medioPagoOpcionId: null,
      metodoPagoDetalle: null,
      esPagoMixto: false,
    };
  }

  const totalObjetivo = round2(mercaderiaTotal + monto);
  const brutoMercaderia = round2(importes.subtotal + importes.ivaMonto);
  if (brutoMercaderia <= 0 || totalObjetivo < 0) {
    return {
      ...sinFinanciacion(importes),
      financiacionPorcentaje: pct,
      financiacionDescripcion,
    };
  }

  const factor = totalObjetivo / brutoMercaderia;
  const nuevoSub = round2(importes.subtotal * factor);
  let nuevoIva = round2(importes.ivaMonto * factor);
  nuevoIva = round2(nuevoIva + round2(totalObjetivo - (nuevoSub + nuevoIva)));

  return {
    importes: {
      subtotal: nuevoSub,
      ivaPorcentaje: importes.ivaPorcentaje,
      ivaMonto: nuevoIva,
      total: totalObjetivo,
    },
    totalMercaderia: mercaderiaTotal,
    financiacionMonto: monto,
    financiacionPorcentaje: pct,
    financiacionDescripcion,
    impTribArca: 0,
    medioPagoOpcionId: null,
    metodoPagoDetalle: null,
    esPagoMixto: false,
  };
}

export function aplicarFinanciacionMixto(
  importes: ImportesBase,
  detalleMontos: Record<string, number>,
  pctPorCodigo: Record<string, number>,
): FinanciacionEmitResult {
  const mercaderiaTotal = importes.total;
  const lineas: string[] = [];
  let netAdj = 0;

  for (const codigo of PARTES_PAGO_MIXTO) {
    const monto = round2(Number(detalleMontos[codigo] ?? 0));
    if (monto <= 0) continue;
    const pct = Number(pctPorCodigo[codigo] ?? 0);
    if (!Number.isFinite(pct)) continue;
    const lineAdj = round2((monto * pct) / 100);
    netAdj += lineAdj;
    const lab = LABEL_PARTE_MIXTO[codigo] ?? codigo;
    lineas.push(
      `${lab} $${monto.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct}%): ${lineAdj >= 0 ? '+' : ''}$${lineAdj.toFixed(2)}`,
    );
  }
  netAdj = round2(netAdj);

  const descripcionDetallada =
    lineas.length > 0 ? `Pago mixto ÔÇö ${lineas.join(' ┬À ')}` : 'Pago mixto';

  if (Math.abs(netAdj) < 1e-6) {
    return {
      ...aplicarFinanciacion(importes, null),
      financiacionDescripcion: descripcionDetallada,
      metodoPagoDetalle: detalleMontos,
      esPagoMixto: true,
    };
  }

  const pctSintetico = mercaderiaTotal > 0 ? (netAdj / mercaderiaTotal) * 100 : 0;
  const base = aplicarFinanciacion(importes, {
    medioNombre: 'Pago mixto',
    cuotas: 1,
    recargo_porcentaje: pctSintetico,
  });

  return {
    ...base,
    financiacionDescripcion: descripcionDetallada,
    financiacionPorcentaje: round2(pctSintetico),
    metodoPagoDetalle: detalleMontos,
    esPagoMixto: true,
  };
}

const CLAVES_MIXTO = [...PARTES_PAGO_MIXTO, 'cuenta_corriente'] as const;

export function validarDetalleMixto(
  raw: Record<string, unknown>,
  totalEsperado: number,
):
  | {
      ok: true;
      detalle: Record<PartePagoMixto, number> & { cuenta_corriente: number };
    }
  | { ok: false; error: string } {
  const detalle = {
    efectivo: 0,
    debito: 0,
    credito: 0,
    transferencia: 0,
    cuenta_corriente: 0,
  } as Record<PartePagoMixto | 'cuenta_corriente', number>;

  for (const k of CLAVES_MIXTO) {
    const v = raw[k];
    const n =
      k === 'cuenta_corriente' && v == null
        ? 0
        : typeof v === 'number'
          ? v
          : parseFloat(String(v ?? ''));
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: `Monto inv├ílido en ${k}` };
    }
    detalle[k] = round2(n);
  }

  const suma = round2(
    detalle.efectivo +
      detalle.debito +
      detalle.credito +
      detalle.transferencia +
      detalle.cuenta_corriente,
  );
  if (Math.abs(suma - totalEsperado) > 0.02) {
    return {
      ok: false,
      error: `La suma de montos del pago mixto (${suma.toFixed(2)}) debe coincidir con el total del comprobante (${totalEsperado.toFixed(2)}).`,
    };
  }

  return { ok: true, detalle };
}

export const CODIGOS_MEDIO_RAPIDO = new Set([
  'efectivo',
  'debito',
  'credito',
  'transferencia',
]);

export const LABEL_MEDIO_RAPIDO: Record<string, string> = {
  efectivo: 'Efectivo',
  debito: 'D├®bito',
  credito: 'Cr├®dito',
  transferencia: 'Transferencia',
};
