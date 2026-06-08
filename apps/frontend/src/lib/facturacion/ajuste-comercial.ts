import { calcularImportes, type Importes } from '@/lib/facturacion/calcular-importes';
import type { TributoAFIP } from '@/lib/facturacion/arca/xml-builder';
import { precioUnitarioQueDaSubtotalLinea2Dec } from '@/lib/productos/calcular-precio-venta';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function normalizarPorcentajeManual(n: unknown): number {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.min(100, Math.max(0, x));
}

export function normalizarMontoNoNegativo(n: unknown): number {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return round2(x);
}

/**
 * Ajuste manual sobre el precio unitario ya con promoción aplicada.
 * Orden: descuento %, luego recargo %.
 */
export function aplicarAjusteLineaPrecioUnitario(
  precioUnitarioEfectivo: number,
  descPct: unknown,
  recPct: unknown,
): number {
  const d = normalizarPorcentajeManual(descPct);
  const r = normalizarPorcentajeManual(recPct);
  return round2(precioUnitarioEfectivo * (1 - d / 100) * (1 + r / 100));
}

export type AjusteGlobalMercaderiaResult = {
  importes: Importes;
  /** Importe a sumar a ImpTrib (recargo global neto vía tributo 99). */
  impTribComercial: number;
  tributosComercial: TributoAFIP[];
  /** Total de mercadería antes del ajuste global (bruto ítems). */
  mercaderiaAntesGlobal: number;
  /** Total de mercadería después del ajuste global y antes de financiación por medio de pago. */
  mercaderiaDespuesGlobal: number;
};

/**
 * Ajuste comercial sobre el total de mercadería (ya calculado por ítems).
 * - Descuentos: escala neto + IVA (misma lógica que financiación negativa).
 * - Recargos netos: mantiene neto/IVA de bienes y suma diferencia como tributo 99.
 */
export function aplicarAjusteGlobalMercaderia(
  importes: Importes,
  tipoComprobante: string,
  opts: {
    descPct: number;
    recPct: number;
    descMonto: number;
    recMonto: number;
  },
): AjusteGlobalMercaderiaResult {
  const mercaderiaTotal = importes.total;
  const d = normalizarPorcentajeManual(opts.descPct);
  const r = normalizarPorcentajeManual(opts.recPct);
  const descMonto = normalizarMontoNoNegativo(opts.descMonto);
  const recMonto = normalizarMontoNoNegativo(opts.recMonto);

  let target = round2(mercaderiaTotal * (1 - d / 100) * (1 + r / 100));
  target = round2(target - descMonto + recMonto);

  if (target < 0) {
    throw new Error('El descuento global supera el total de mercadería');
  }

  const delta = round2(target - mercaderiaTotal);

  if (Math.abs(delta) < 0.005) {
    return {
      importes: {
        ...importes,
        items: importes.items.map((i) => ({ ...i })),
      },
      impTribComercial: 0,
      tributosComercial: [],
      mercaderiaAntesGlobal: mercaderiaTotal,
      mercaderiaDespuesGlobal: mercaderiaTotal,
    };
  }

  /** Facturas y NC fiscales (A/B/C y legacy): el descuento global debe reescalar líneas y recalcular IVA con `calcularImportes`. */
  const esFactura =
    tipoComprobante === 'factura' ||
    tipoComprobante === 'nota_credito' ||
    tipoComprobante.startsWith('factura_') ||
    tipoComprobante.startsWith('nota_credito_');

  if (delta > 0.001) {
    const totalFinal = target;
    const impTrib = round2(delta);
    const pctSintetico = mercaderiaTotal > 0 ? round2((impTrib / mercaderiaTotal) * 100) : 0;
    const tributo: TributoAFIP =
      impTrib > 0.001
        ? {
            id: 99,
            descripcion: 'Recargo / ajuste comercial global',
            baseImp: mercaderiaTotal,
            alicuota: Math.abs(pctSintetico),
            importe: impTrib,
          }
        : {
            id: 99,
            descripcion: 'Recargo / ajuste comercial global',
            baseImp: 0,
            alicuota: 0,
            importe: 0,
          };

    return {
      importes: {
        ...importes,
        total: totalFinal,
        items: importes.items.map((i) => ({ ...i })),
      },
      impTribComercial: impTrib,
      tributosComercial: impTrib > 0.001 ? [tributo] : [],
      mercaderiaAntesGlobal: mercaderiaTotal,
      /** Bruto de bienes sin el recargo informado como tributo. */
      mercaderiaDespuesGlobal: mercaderiaTotal,
    };
  }

  // delta < 0: descuento neto
  const totalObjetivo = target;
  if (!esFactura) {
    const factor = mercaderiaTotal > 0 ? totalObjetivo / mercaderiaTotal : 0;
    let restante = totalObjetivo;
    const itemsAjustados = importes.items.map((item, idx) => {
      const esUltimo = idx === importes.items.length - 1;
      const subtotalObjetivo = esUltimo ? round2(restante) : round2(item.subtotal * factor);
      const nuevoPu =
        item.cantidad > 0
          ? precioUnitarioQueDaSubtotalLinea2Dec(item.cantidad, subtotalObjetivo)
          : item.precio_unitario;
      const nuevoSub = item.cantidad > 0 ? round2(item.cantidad * nuevoPu) : 0;
      restante = round2(restante - nuevoSub);
      return {
        ...item,
        precio_unitario: nuevoPu,
        subtotal: nuevoSub,
      };
    });
    const nuevoTotal = round2(itemsAjustados.reduce((s, i) => s + i.subtotal, 0));
    return {
      importes: {
        subtotal: nuevoTotal,
        iva_porcentaje: importes.iva_porcentaje,
        iva_monto: 0,
        total: nuevoTotal,
        items: itemsAjustados,
        alicuotas: [],
      },
      impTribComercial: 0,
      tributosComercial: [],
      mercaderiaAntesGlobal: mercaderiaTotal,
      mercaderiaDespuesGlobal: nuevoTotal,
    };
  }

  const brutoMercaderia = round2(importes.subtotal + importes.iva_monto);
  if (brutoMercaderia <= 0 || totalObjetivo < 0) {
    return {
      importes: { ...importes, items: importes.items.map((i) => ({ ...i })) },
      impTribComercial: 0,
      tributosComercial: [],
      mercaderiaAntesGlobal: mercaderiaTotal,
      mercaderiaDespuesGlobal: mercaderiaTotal,
    };
  }

  const factor = totalObjetivo / brutoMercaderia;
  const itemsBrutoAjustados = importes.items.map((item) => {
    const nuevoBruto = round2(item.subtotal * factor);
    const nuevoPu = item.cantidad > 0 ? round2(nuevoBruto / item.cantidad) : item.precio_unitario;
    return {
      ...item,
      precio_unitario: nuevoPu,
      subtotal: nuevoBruto,
    };
  });
  const recalculado = calcularImportes(
    itemsBrutoAjustados.map((i) => ({
      producto_id: i.producto_id,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      iva_porcentaje: i.iva_porcentaje,
    })),
    tipoComprobante,
    importes.iva_porcentaje,
  );

  return {
    importes: recalculado,
    impTribComercial: 0,
    tributosComercial: [],
    mercaderiaAntesGlobal: mercaderiaTotal,
    mercaderiaDespuesGlobal: recalculado.total,
  };
}

export function combinarImpTribComercialYFinanciacion(
  impTribComercial: number,
  tributosComercial: TributoAFIP[],
  financiacionImpTrib: number,
  tributo99Fin: {
    descripcion: string;
    baseImp: number;
    alicuota: number;
    importe: number;
  } | null,
): { impTrib: number; tributos: TributoAFIP[] } {
  const tribs: TributoAFIP[] = [...tributosComercial];
  if (tributo99Fin != null && financiacionImpTrib > 0.001) {
    tribs.push({
      id: 99,
      descripcion: tributo99Fin.descripcion,
      baseImp: tributo99Fin.baseImp,
      alicuota: tributo99Fin.alicuota,
      importe: tributo99Fin.importe,
    });
  }
  const impTrib = round2(impTribComercial + (financiacionImpTrib > 0.001 ? financiacionImpTrib : 0));
  return { impTrib, tributos: tribs };
}
