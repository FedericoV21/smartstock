import { describe, expect, it } from 'vitest';

import { aplicarFinanciacion } from '@/lib/facturacion/financiacion';
import {
  factorLineasVsTotalComprobante,
  reconciliarItemsSubtotalesConTotal,
} from '@/lib/facturacion/reconciliar-items-total';

describe('reconciliarItemsSubtotalesConTotal', () => {
  it('reparte descuento por medio de pago en las líneas (ticket)', () => {
    const importes = {
      subtotal: 200,
      iva_porcentaje: 0,
      iva_monto: 0,
      total: 200,
      items: [
        { producto_id: 'p1', cantidad: 2, precio_unitario: 100, subtotal: 200 },
      ],
      alicuotas: [],
    };

    const fin = aplicarFinanciacion(importes, 'ticket', {
      medioNombre: 'Efectivo',
      cuotas: 1,
      recargo_porcentaje: -10,
    });

    expect(fin.importes.total).toBe(180);
    const sumaLineas = fin.importes.items.reduce((s, i) => s + i.subtotal, 0);
    expect(sumaLineas).toBeCloseTo(180, 2);
    expect(fin.importes.items[0]!.subtotal).toBeCloseTo(180, 2);
  });

  it('factorLineasVsTotalComprobante alinea histórico', () => {
    expect(factorLineasVsTotalComprobante(180, 200)).toBeCloseTo(0.9, 4);
    expect(factorLineasVsTotalComprobante(200, 200)).toBe(1);
  });

  it('reconciliar directo reparte recargo al total', () => {
    const out = reconciliarItemsSubtotalesConTotal({
      subtotal: 100,
      iva_porcentaje: 0,
      iva_monto: 0,
      total: 110,
      items: [{ producto_id: 'p1', cantidad: 1, precio_unitario: 100, subtotal: 100 }],
      alicuotas: [],
    });
    expect(out.items[0]!.subtotal).toBeCloseTo(110, 2);
  });
});
