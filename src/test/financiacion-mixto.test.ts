import { describe, expect, it } from 'vitest';

import { aplicarFinanciacionMixto } from '@/lib/facturacion/financiacion';
import type { Importes } from '@/lib/facturacion/calcular-importes';

describe('aplicarFinanciacionMixto', () => {
  it('aplica recargo/descuento proporcional al monto de cada medio (ej. 400 −10% + 600 +15% sobre 1000)', () => {
    const importes: Importes = {
      subtotal: 1000,
      iva_porcentaje: 0,
      iva_monto: 0,
      total: 1000,
      items: [],
    };

    const out = aplicarFinanciacionMixto(
      importes,
      'ticket',
      {
        efectivo: 400,
        debito: 600,
        credito: 0,
        transferencia: 0,
      },
      { efectivo: -10, debito: 15, credito: 0, transferencia: 0 },
    );

    expect(out.totalMercaderia).toBe(1000);
    expect(out.financiacionMonto).toBeCloseTo(50, 1);
    expect(out.importes.total).toBeCloseTo(1050, 1);
  });
});
