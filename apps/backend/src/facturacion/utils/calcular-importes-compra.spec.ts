import {
  calcularImportesCompra,
  importesDesdeCabeceraManual,
  totalPercepciones,
} from './calcular-importes-compra';

describe('calcular-importes-compra', () => {
  it('calculates neto + IVA for factura_a', () => {
    const r = calcularImportesCompra(
      [
        {
          productoId: 'p1',
          cantidad: 2,
          precioUnitario: 100,
          ivaPorcentaje: 21,
        },
      ],
      'factura_a',
    );
    expect(r.subtotal).toBe(200);
    expect(r.ivaMonto).toBe(42);
    expect(r.total).toBe(242);
  });

  it('uses manual header when requested', () => {
    const r = importesDesdeCabeceraManual({
      subtotal: 100,
      ivaMonto: 21,
      total: 126,
      percepciones: 5,
    });
    expect(r.subtotal).toBe(100);
    expect(r.total).toBe(126);
  });

  it('sums percepciones', () => {
    expect(
      totalPercepciones({
        percepcionIibbMonto: 1.5,
        percepcionIvaMonto: 2,
        impuestoInternoMonto: 0.5,
      }),
    ).toBe(4);
  });
});
