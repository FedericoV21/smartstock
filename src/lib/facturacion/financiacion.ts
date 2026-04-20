import type { Importes } from '@/lib/facturacion/calcular-importes';
import { formatCurrency } from '@/lib/utils/formatters';

export type OpcionFinanciacion = {
  medioNombre: string;
  cuotas: number;
  recargo_porcentaje: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Aplica recargo o descuento por medio de pago sobre el total de mercadería.
 * - Recargo (monto ≥ 0): no altera neto/IVA de bienes; el total aumenta; ARCA informa ImpTrib (tributo 99).
 * - Descuento (monto < 0): reduce proporcionalmente neto e IVA (o el bruto si no hay IVA discriminado).
 */
export function aplicarFinanciacion(
  importes: Importes,
  tipoComprobante: string,
  opcion: OpcionFinanciacion | null,
): {
  importes: Importes;
  totalMercaderia: number;
  financiacionMonto: number;
  financiacionPorcentaje: number;
  financiacionDescripcion: string;
  arca: {
    impTrib: number;
    importeTotal: number;
    importeNeto: number;
    importeIVA: number;
    tributo99: {
      descripcion: string;
      baseImp: number;
      alicuota: number;
      importe: number;
    } | null;
  };
} {
  const mercaderiaTotal = importes.total;

  if (!opcion) {
    return {
      importes: { ...importes, items: importes.items.map((i) => ({ ...i })) },
      totalMercaderia: mercaderiaTotal,
      financiacionMonto: 0,
      financiacionPorcentaje: 0,
      financiacionDescripcion: '',
      arca: {
        impTrib: 0,
        importeTotal: mercaderiaTotal,
        importeNeto: importes.subtotal,
        importeIVA: importes.iva_monto,
        tributo99: null,
      },
    };
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
    const tributo99 =
      monto > 0.001
        ? {
            descripcion: `Recargo financiero — ${opcion.medioNombre} (${cuotasLabel})`,
            baseImp: mercaderiaTotal,
            alicuota: Math.abs(pct),
            importe: monto,
          }
        : null;

    return {
      importes: {
        ...importes,
        total: totalFinal,
        items: importes.items.map((i) => ({ ...i })),
      },
      totalMercaderia: mercaderiaTotal,
      financiacionMonto: monto,
      financiacionPorcentaje: pct,
      financiacionDescripcion,
      arca: {
        impTrib: monto > 0.001 ? monto : 0,
        importeTotal: totalFinal,
        importeNeto: importes.subtotal,
        importeIVA: importes.iva_monto,
        tributo99,
      },
    };
  }

  // Descuento: escalar neto + IVA para que el total de bienes coincida con mercadería + monto (monto negativo)
  const totalObjetivo = round2(mercaderiaTotal + monto);
  const brutoMercaderia = round2(importes.subtotal + importes.iva_monto);

  if (brutoMercaderia <= 0 || totalObjetivo < 0) {
    return {
      importes: { ...importes, items: importes.items.map((i) => ({ ...i })) },
      totalMercaderia: mercaderiaTotal,
      financiacionMonto: 0,
      financiacionPorcentaje: pct,
      financiacionDescripcion,
      arca: {
        impTrib: 0,
        importeTotal: mercaderiaTotal,
        importeNeto: importes.subtotal,
        importeIVA: importes.iva_monto,
        tributo99: null,
      },
    };
  }

  const factor = totalObjetivo / brutoMercaderia;
  let nuevoSub = round2(importes.subtotal * factor);
  let nuevoIva = round2(importes.iva_monto * factor);
  const suma = round2(nuevoSub + nuevoIva);
  const delta = round2(totalObjetivo - suma);
  nuevoIva = round2(nuevoIva + delta);

  return {
    importes: {
      subtotal: nuevoSub,
      iva_porcentaje: importes.iva_porcentaje,
      iva_monto: nuevoIva,
      total: totalObjetivo,
      items: importes.items.map((i) => ({ ...i })),
    },
    totalMercaderia: mercaderiaTotal,
    financiacionMonto: monto,
    financiacionPorcentaje: pct,
    financiacionDescripcion,
    arca: {
      impTrib: 0,
      importeTotal: totalObjetivo,
      importeNeto: nuevoSub,
      importeIVA: nuevoIva,
      tributo99: null,
    },
  };
}

/** Partes del pago mixto (no incluye la clave "mixto" del enum de comprobante). */
export const PARTES_PAGO_MIXTO = ['efectivo', 'debito', 'credito', 'transferencia'] as const;
export type PartePagoMixto = (typeof PARTES_PAGO_MIXTO)[number];

const LABEL_PARTE_MIXTO: Record<PartePagoMixto, string> = {
  efectivo: 'Efectivo',
  debito: 'Débito',
  credito: 'Crédito',
  transferencia: 'Transferencia',
};

/**
 * Pago mixto: cada monto parcial se multiplica por el % de su medio (config. atajos);
 * el ajuste neto es la suma de esos montos. Luego se unifica vía el mismo criterio fiscal
 * que un único % sobre el total (surcharge → tributo 99; descuento → escala neto/IVA).
 */
export function aplicarFinanciacionMixto(
  importes: Importes,
  tipoComprobante: string,
  detalleMontos: Record<string, number>,
  pctPorCodigo: Record<string, number>,
): ReturnType<typeof aplicarFinanciacion> {
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
      `${lab} ${formatCurrency(monto)} (${pct >= 0 ? '+' : ''}${pct}%): ${lineAdj >= 0 ? '+' : ''}${formatCurrency(lineAdj)}`,
    );
  }
  netAdj = round2(netAdj);

  const descripcionDetallada =
    lineas.length > 0 ? `Pago mixto — ${lineas.join(' · ')}` : 'Pago mixto';

  if (Math.abs(netAdj) < 1e-6) {
    const base = aplicarFinanciacion(importes, tipoComprobante, null);
    return {
      ...base,
      financiacionDescripcion: descripcionDetallada,
    };
  }

  const pctSintetico = mercaderiaTotal > 0 ? (netAdj / mercaderiaTotal) * 100 : 0;
  const base = aplicarFinanciacion(importes, tipoComprobante, {
    medioNombre: 'Pago mixto',
    cuotas: 1,
    recargo_porcentaje: pctSintetico,
  });

  const tributo99 =
    base.arca.tributo99 != null && netAdj > 0.001
      ? {
          ...base.arca.tributo99,
          descripcion: `Ajuste medios de pago (mixto) · neto ${formatCurrency(netAdj)}`,
        }
      : base.arca.tributo99;

  return {
    ...base,
    financiacionDescripcion: descripcionDetallada,
    financiacionPorcentaje: round2(pctSintetico),
    arca: {
      ...base.arca,
      tributo99,
    },
  };
}
