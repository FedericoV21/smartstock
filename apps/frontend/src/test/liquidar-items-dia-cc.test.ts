import { describe, expect, it } from 'vitest';

import {
  marcarEditableLiquidacionDia,
  recalcularImportesComprobanteDesdeItems,
  validarComprobanteLiquidable,
} from '@/lib/cuenta-corriente/liquidar-items-dia';

describe('liquidar-items-dia CC', () => {
  it('marca editable solo ticket sin CAE', () => {
    expect(marcarEditableLiquidacionDia('ticket', null)).toBe(true);
    expect(marcarEditableLiquidacionDia('ticket', '123')).toBe(false);
    expect(marcarEditableLiquidacionDia('factura_a', null)).toBe(false);
  });

  it('rechaza comprobante de otro día', () => {
    const r = validarComprobanteLiquidable({
      fechaHoy: '2026-05-30',
      sucursalId: 's1',
      comprobante: {
        fecha: '2026-05-29',
        metodo_pago: 'cuenta_corriente',
        estado: 'emitido',
        tipo: 'ticket',
        cae: null,
        sucursal_id: 's1',
      },
    });
    expect(r.ok).toBe(false);
  });

  it('recalcula total de ticket desde precios', () => {
    const r = recalcularImportesComprobanteDesdeItems(
      {
        tipo: 'ticket',
        descuento_global_pct: 0,
        recargo_global_pct: 0,
        descuento_global_monto: 0,
        recargo_global_monto: 0,
        financiacion_monto: 0,
        imp_trib_comercial: 0,
        total: 0,
      },
      [
        {
          id: 'i1',
          producto_id: 'p1',
          cantidad: 2,
          precio_unitario: 500,
          descuento_manual_pct: 0,
          recargo_manual_pct: 0,
          producto: { iva_porcentaje: 21 },
        },
      ],
      21,
    );
    expect(r.total).toBe(1000);
    expect(r.items[0].subtotal).toBe(1000);
  });
});
