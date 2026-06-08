import { describe, expect, it } from 'vitest';

import {
  calcularPrecioVenta,
  clampGananciaPct,
  GANANCIA_PCT_MAX,
  GANANCIA_PCT_MIN,
  costoDesdePvpConIvaYGanancia,
  gananciaPorcentajeDesdeCostoYPvpConIva,
  parseGananciaPctNullable,
  precioUnitarioQueDaSubtotalLinea2Dec,
  redondearPrecioCentenasSuperior,
  subtotalLineaMercaderia2Dec,
  subtotalLineaPosConPromoYCentenas,
  subtotalLineaRedondeoCentenasSuperior,
} from '@/lib/productos/calcular-precio-venta';

describe('calcularPrecioVenta', () => {
  it('redondea el PVP hacia arriba al centavo', () => {
    expect(calcularPrecioVenta(100, 20, 21, 21)).toBe(145.2);
    expect(calcularPrecioVenta(1, 0.1, 0, 21)).toBe(1.01);
  });

  it('con costo exacto y sin ganancia ni IVA el PVP es el costo', () => {
    expect(calcularPrecioVenta(12, 0, 0, 21)).toBe(12);
  });

  it('aplica descuento opcional sobre el costo antes de ganancia e IVA', () => {
    expect(calcularPrecioVenta(100, 20, 21, 21, { descuentoCostoPct: 10 })).toBe(130.68);
    expect(calcularPrecioVenta(100, 20, 21, 21, { descuentoCostoPct: null })).toBe(145.2);
    expect(calcularPrecioVenta(100, 20, 21, 21, { descuentoCostoPct: 0 })).toBe(145.2);
  });

  it('limita el descuento opcional al rango 0-100', () => {
    expect(calcularPrecioVenta(100, 0, 0, 21, { descuentoCostoPct: -10 })).toBe(100);
    expect(calcularPrecioVenta(100, 0, 0, 21, { descuentoCostoPct: 150 })).toBe(0);
  });

  it('con redondeo a centenas usa $50/$100 en el primer bloque', () => {
    expect(calcularPrecioVenta(100, 20, 21, 21, { redondearPreciosCentenas: true })).toBe(100);
    expect(calcularPrecioVenta(55, 0, 0, 21, { redondearPreciosCentenas: true })).toBe(50);
    expect(calcularPrecioVenta(60, 0, 0, 21, { redondearPreciosCentenas: true })).toBe(50);
    expect(calcularPrecioVenta(75, 0, 0, 21, { redondearPreciosCentenas: true })).toBe(50);
    expect(calcularPrecioVenta(75.01, 0, 0, 21, { redondearPreciosCentenas: true })).toBe(100);
  });

  it('con redondeo a centenas puede redondear menores a 100 en decenas', () => {
    const opts = { redondearPreciosCentenas: true, redondearMenores100ADecenas: true };
    expect(calcularPrecioVenta(34, 0, 0, 21, opts)).toBe(30);
    expect(calcularPrecioVenta(28, 0, 0, 21, opts)).toBe(30);
    expect(calcularPrecioVenta(65, 0, 0, 21, opts)).toBe(60);
    expect(calcularPrecioVenta(66, 0, 0, 21, opts)).toBe(70);
  });

  it('sin flag de centenas mantiene solo redondeo a centavos', () => {
    const sinFlag = calcularPrecioVenta(100, 20, 21, 21);
    const conFlag = calcularPrecioVenta(100, 20, 21, 21, { redondearPreciosCentenas: false });
    expect(conFlag).toBe(sinFlag);
  });

  it('deriva costo desde PVP con IVA y ganancia', () => {
    expect(costoDesdePvpConIvaYGanancia(121, 21, 21)).toBe(100);
    expect(costoDesdePvpConIvaYGanancia(145.2, 21, 21, 20)).toBe(100);
    expect(costoDesdePvpConIvaYGanancia(130.68, 21, 21, 20, { descuentoCostoPct: 10 })).toBe(100);
  });

  it('infiere ganancia desde costo y PVP con IVA', () => {
    expect(gananciaPorcentajeDesdeCostoYPvpConIva(100, 145.2, 21, 21)).toBe(20);
    expect(
      gananciaPorcentajeDesdeCostoYPvpConIva(100, 130.68, 21, 21, {
        descuentoCostoPct: 10,
      }),
    ).toBe(20);
  });
});

describe('redondearPrecioCentenasSuperior', () => {
  it('regla del peso dentro del bloque centenario (<$51 inferior, desde $51 superior)', () => {
    expect(redondearPrecioCentenasSuperior(12)).toBe(50);
    expect(redondearPrecioCentenasSuperior(55)).toBe(50);
    expect(redondearPrecioCentenasSuperior(60)).toBe(50);
    expect(redondearPrecioCentenasSuperior(75)).toBe(50);
    expect(redondearPrecioCentenasSuperior(75.01)).toBe(100);
    expect(redondearPrecioCentenasSuperior(460)).toBe(500);
    expect(redondearPrecioCentenasSuperior(1232)).toBe(1200);
    expect(redondearPrecioCentenasSuperior(1250)).toBe(1200);
    expect(redondearPrecioCentenasSuperior(1305.45)).toBe(1300);
    expect(redondearPrecioCentenasSuperior(1567)).toBe(1600);
  });

  it('usa decenas en menores a 100 cuando se pide explicitamente', () => {
    const opts = { redondearMenores100ADecenas: true };
    expect(redondearPrecioCentenasSuperior(4, opts)).toBe(10);
    expect(redondearPrecioCentenasSuperior(28, opts)).toBe(30);
    expect(redondearPrecioCentenasSuperior(34, opts)).toBe(30);
    expect(redondearPrecioCentenasSuperior(65, opts)).toBe(60);
    expect(redondearPrecioCentenasSuperior(66, opts)).toBe(70);
    expect(redondearPrecioCentenasSuperior(99, opts)).toBe(100);
    expect(redondearPrecioCentenasSuperior(1250, opts)).toBe(1200);
  });

  it('0 y no positivos', () => {
    expect(redondearPrecioCentenasSuperior(0)).toBe(0);
    expect(redondearPrecioCentenasSuperior(-10)).toBe(-10);
  });
});

describe('subtotal línea POS / ticket (cantidad fraccionaria)', () => {
  it('subtotalLineaMercaderia2Dec coincide con comprobante', () => {
    expect(subtotalLineaMercaderia2Dec(0.37, 2200)).toBe(814);
    expect(subtotalLineaMercaderia2Dec(3, 2200)).toBe(6600);
  });

  it('subtotalLineaRedondeoCentenasSuperior lleva mercadería 2dec al centenar regla $51', () => {
    expect(subtotalLineaRedondeoCentenasSuperior(0.37, 2200)).toBe(800);
    expect(subtotalLineaRedondeoCentenasSuperior(3, 2200)).toBe(6600);
  });

  it('precioUnitarioQueDaSubtotalLinea2Dec permite emitir con subtotal redondeado', () => {
    const pu = precioUnitarioQueDaSubtotalLinea2Dec(0.37, 800);
    expect(subtotalLineaMercaderia2Dec(0.37, pu)).toBe(800);
    expect(subtotalLineaMercaderia2Dec(3, precioUnitarioQueDaSubtotalLinea2Dec(3, 6600))).toBe(6600);
  });

  it('con promo no anula el descuento al redondear cant×PU efectivo (< $100)', () => {
    const opts = { redondearCentenas: true };
    expect(subtotalLineaRedondeoCentenasSuperior(2, 44.875)).toBe(100);
    expect(
      subtotalLineaPosConPromoYCentenas(2, 50, 44.875, 10.25, opts),
    ).toBe(89.75);
  });

  it('con promo redondea el neto al centenar cuando supera $100', () => {
    const opts = { redondearCentenas: true };
    expect(
      subtotalLineaPosConPromoYCentenas(2, 14000, 11149.6, 5700.8, opts),
    ).toBe(22300);
  });
});

describe('clampGananciaPct', () => {
  it('limita al rango numeric(5,2)', () => {
    expect(clampGananciaPct(2172.73)).toBe(GANANCIA_PCT_MAX);
    expect(clampGananciaPct(-5)).toBe(-5);
    expect(clampGananciaPct(-150)).toBe(GANANCIA_PCT_MIN);
  });

  it('parseGananciaPctNullable rechaza fuera de rango', () => {
    expect(parseGananciaPctNullable(50)).toBe(50);
    expect(parseGananciaPctNullable(-17.36)).toBe(-17.36);
    expect(parseGananciaPctNullable(2172.73)).toBeNull();
    expect(parseGananciaPctNullable(null)).toBeNull();
  });

  it('infiera ganancia negativa cuando el PVP con IVA equivale al costo', () => {
    const g = gananciaPorcentajeDesdeCostoYPvpConIva(11000, 11000, 21, 21);
    expect(g).toBeLessThan(0);
    expect(Math.abs(calcularPrecioVenta(11000, g, 21, 21) - 11000)).toBeLessThan(1);
  });
});
