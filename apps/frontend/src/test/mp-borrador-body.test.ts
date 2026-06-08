import { describe, expect, it } from 'vitest';

import {
  resolverAjustesGlobalesDesdeBorrador,
  resolverPrecioListaDesdeItemBorrador,
} from '@/lib/mp-point/borrador-body';

describe('resolverPrecioListaDesdeItemBorrador', () => {
  it('usa precio_unitario_original cuando viene informado', () => {
    expect(
      resolverPrecioListaDesdeItemBorrador({
        precio_unitario: 76.09,
        precio_unitario_original: 38046.39,
        descuento_manual_pct: 99.8,
      }),
    ).toBe(38046.39);
  });

  it('reconstruye precio de lista si original es null y hay descuento manual', () => {
    expect(
      resolverPrecioListaDesdeItemBorrador({
        precio_unitario: 76.09,
        precio_unitario_original: null,
        descuento_manual_pct: 99.8,
        recargo_manual_pct: 0,
      }),
    ).toBe(38045);
  });

  it('evita cambiar el precio si no hay ajustes manuales', () => {
    expect(
      resolverPrecioListaDesdeItemBorrador({
        precio_unitario: 123.45,
        precio_unitario_original: null,
        descuento_manual_pct: 0,
        recargo_manual_pct: 0,
      }),
    ).toBe(123.45);
  });
});

describe('resolverAjustesGlobalesDesdeBorrador', () => {
  it('no vuelve a aplicar descuentos globales ya incorporados en las lineas del borrador', () => {
    expect(
      resolverAjustesGlobalesDesdeBorrador({
        total: 546072,
        total_mercaderia: 550000,
        descuento_global_monto: 3928,
        recargo_global_monto: 0,
      }),
    ).toEqual({
      descuento_global_pct: 0,
      recargo_global_pct: 0,
      descuento_global_monto: 0,
      recargo_global_monto: 0,
    });
  });

  it('mantiene recargos globales que no estan incorporados en las lineas del borrador', () => {
    expect(
      resolverAjustesGlobalesDesdeBorrador({
        total: 553928,
        total_mercaderia: 550000,
        descuento_global_monto: 0,
        recargo_global_monto: 3928,
      }),
    ).toEqual({
      descuento_global_pct: 0,
      recargo_global_pct: 0,
      descuento_global_monto: 0,
      recargo_global_monto: 3928,
    });
  });
});
