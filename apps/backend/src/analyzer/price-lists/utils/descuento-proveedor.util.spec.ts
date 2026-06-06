import { clampDescuentoPct, costoNetoDesdeLista, variacionPct } from './descuento-proveedor.util';

describe('descuento-proveedor.util', () => {
  it('aplica descuento al costo neto', () => {
    expect(costoNetoDesdeLista(100, 10)).toBe(90);
  });

  it('clampDescuentoPct limita rango', () => {
    expect(clampDescuentoPct(-5)).toBe(0);
    expect(clampDescuentoPct(150)).toBe(99.99);
  });

  it('variacionPct calcula aumento', () => {
    expect(variacionPct(100, 110)).toBe(10);
  });
});
