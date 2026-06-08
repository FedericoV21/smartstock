import { describe, expect, it } from 'vitest';

import { aplicarAjusteGlobalMercaderia } from '@/lib/facturacion/ajuste-comercial';
import { calcularImportes } from '@/lib/facturacion/calcular-importes';

describe('aplicarAjusteGlobalMercaderia', () => {
  it('factura B: descuento global % escala cada ítem (no solo el encabezado)', () => {
    const base = calcularImportes(
      [
        {
          producto_id: 'p1',
          cantidad: 1,
          precio_unitario: 100,
          iva_porcentaje: 21,
        },
      ],
      'factura_b',
      21,
    );
    const ag = aplicarAjusteGlobalMercaderia(base, 'factura_b', {
      descPct: 89,
      recPct: 0,
      descMonto: 0,
      recMonto: 0,
    });
    expect(ag.importes.total).toBeCloseTo(11, 1);
    expect(ag.importes.items).toHaveLength(1);
    expect(ag.importes.items[0]!.subtotal).toBeCloseTo(11, 1);
    expect(ag.importes.items[0]!.precio_unitario).toBeCloseTo(11, 1);
    const sumaLineas = ag.importes.items.reduce((s, i) => s + i.subtotal, 0);
    expect(sumaLineas).toBeCloseTo(ag.importes.total, 2);
    expect(ag.importes.iva_monto).toBeGreaterThan(0.01);
  });

  it('factura C: descuento global % alinea total e ítems (sin IVA discriminado en total)', () => {
    const base = calcularImportes(
      [
        {
          producto_id: 'p1',
          cantidad: 1,
          precio_unitario: 1076.9,
          iva_porcentaje: 21,
        },
      ],
      'factura_c',
      21,
    );
    const ag = aplicarAjusteGlobalMercaderia(base, 'factura_c', {
      descPct: 74,
      recPct: 0,
      descMonto: 0,
      recMonto: 0,
    });
    expect(ag.importes.total).toBeCloseTo(279.99, 1);
    expect(ag.importes.items[0]!.precio_unitario).toBeCloseTo(279.99, 1);
    const sumaLineas = ag.importes.items.reduce((s, i) => s + i.subtotal, 0);
    expect(sumaLineas).toBeCloseTo(ag.importes.total, 1);
  });

  it('ticket: descuento global por monto conserva el total exacto aunque la cantidad no divida centavos', () => {
    const base = calcularImportes(
      [
        {
          producto_id: 'p1',
          cantidad: 11,
          precio_unitario: 50000,
          iva_porcentaje: 21,
        },
      ],
      'ticket',
      21,
    );
    const ag = aplicarAjusteGlobalMercaderia(base, 'ticket', {
      descPct: 0,
      recPct: 0,
      descMonto: 3928,
      recMonto: 0,
    });
    expect(ag.importes.total).toBe(546072);
    expect(ag.importes.items[0]!.subtotal).toBe(546072);
    expect(Math.round(ag.importes.items[0]!.precio_unitario * 11 * 100) / 100).toBe(546072);
  });
});
