interface ItemComprobante {
  producto_id: string;
  cantidad: number;
  precio_unitario: number;
  iva_porcentaje?: number | null;
}

export interface Importes {
  subtotal: number;
  iva_porcentaje: number;
  iva_monto: number;
  total: number;
  items: (ItemComprobante & { subtotal: number })[];
}

/**
 * Calcula importes de un comprobante.
 *
 * Precios IVA-incluidos (convención del sistema): `precio_unitario` ya contiene
 * el IVA. Para comprobantes con IVA discriminado sólo se separa el componente
 * de IVA embebido; el total NO se incrementa.
 *
 * - Factura / NC:
 *     total        = sum(cantidad * precio_unitario)   // bruto IVA incluido
 *     iva_monto    = sum por línea de  gross * rate / (100 + rate)
 *     subtotal     = total - iva_monto                 // neto gravado
 *
 * - Ticket, Remito, Presupuesto: total = subtotal (sin discriminar IVA)
 *
 * Cada ítem puede traer su propio `iva_porcentaje`; si no, usa
 * `ivaPorcentajeDefault`.
 */
export function calcularImportes(
  items: ItemComprobante[],
  tipoComprobante: string,
  ivaPorcentajeDefault: number = 21,
): Importes {
  const itemsCalculados = items.map((item) => ({
    ...item,
    subtotal: Math.round(item.cantidad * item.precio_unitario * 100) / 100,
  }));

  const subtotal = itemsCalculados.reduce((sum, item) => sum + item.subtotal, 0);
  const subtotalRedondeado = Math.round(subtotal * 100) / 100;

  const esFactura =
    tipoComprobante === 'factura_a' ||
    tipoComprobante === 'nota_credito_a' ||
    tipoComprobante === 'factura' ||
    tipoComprobante === 'nota_credito';

  if (esFactura) {
    let ivaMonto = 0;
    for (const item of itemsCalculados) {
      const rate = item.iva_porcentaje ?? ivaPorcentajeDefault;
      // IVA embebido en precio bruto: gross * rate / (100 + rate)
      ivaMonto +=
        Math.round(((item.subtotal * rate) / (100 + rate)) * 100) / 100;
    }
    ivaMonto = Math.round(ivaMonto * 100) / 100;

    const rateUsed = itemsCalculados.length === 1
      ? (itemsCalculados[0].iva_porcentaje ?? ivaPorcentajeDefault)
      : ivaPorcentajeDefault;

    const total = subtotalRedondeado;
    const subtotalNeto = Math.round((total - ivaMonto) * 100) / 100;

    return {
      subtotal: subtotalNeto,
      iva_porcentaje: rateUsed,
      iva_monto: ivaMonto,
      total,
      items: itemsCalculados,
    };
  }

  return {
    subtotal: subtotalRedondeado,
    iva_porcentaje: ivaPorcentajeDefault,
    iva_monto: 0,
    total: subtotalRedondeado,
    items: itemsCalculados,
  };
}
