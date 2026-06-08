import { describe, expect, it } from 'vitest';

import {
  normalizarTramos,
  resolverGananciaPctPorCantidad,
  precioUnitarioConIvaPorCantidad,
} from '@/lib/productos/precio-por-tramos';

describe('precio-por-tramos', () => {
  it('normaliza, deduplica y ordena tramos', () => {
    const out = normalizarTramos([
      { cantidad_desde: 50, ganancia_pct: 55 },
      { cantidad_desde: 1, ganancia_pct: 60 },
      { cantidad_desde: 50, ganancia_pct: 56 }, // dup: último gana
      { cantidad_desde: 0, ganancia_pct: 10 } as any, // inválido
    ]);
    expect(out).toEqual([
      { cantidad_desde: 1, ganancia_pct: 60 },
      { cantidad_desde: 50, ganancia_pct: 56 },
    ]);
  });

  it('elige el tramo de mayor cantidad_desde <= cantidad', () => {
    const tramos = [
      { cantidad_desde: 1, ganancia_pct: 60 },
      { cantidad_desde: 50, ganancia_pct: 55 },
      { cantidad_desde: 300, ganancia_pct: 50 },
    ];
    expect(resolverGananciaPctPorCantidad(1, tramos)).toBe(60);
    expect(resolverGananciaPctPorCantidad(49, tramos)).toBe(60);
    expect(resolverGananciaPctPorCantidad(50, tramos)).toBe(55);
    expect(resolverGananciaPctPorCantidad(299, tramos)).toBe(55);
    expect(resolverGananciaPctPorCantidad(300, tramos)).toBe(50);
    expect(resolverGananciaPctPorCantidad(999, tramos)).toBe(50);
  });

  it('fallback a ganancia base si no hay tramo aplicable', () => {
    const r = precioUnitarioConIvaPorCantidad({
      precio_costo: 100,
      porcentaje_ganancia_base: 40,
      iva_porcentaje: 0,
      iva_default: 21,
      cantidad: 1,
      tramos: [{ cantidad_desde: 50, ganancia_pct: 10 }],
    });
    expect(r.ganancia_pct_usada).toBe(40);
    expect(r.precio_unitario).toBeGreaterThan(0);
  });

  it('permite forzar un tramo existente sin cambiar la cantidad vendida', () => {
    const r = precioUnitarioConIvaPorCantidad({
      precio_costo: 100,
      porcentaje_ganancia_base: 50,
      iva_porcentaje: 0,
      iva_default: 21,
      cantidad: 75,
      tramos: [
        { cantidad_desde: 1, ganancia_pct: 50 },
        { cantidad_desde: 100, ganancia_pct: 45 },
      ],
      tramo_forzado_cantidad_desde: 100,
    });
    expect(r.ganancia_pct_usada).toBe(45);
    expect(r.precio_unitario).toBe(145);
  });

  it('ignora un tramo forzado que no existe', () => {
    const r = precioUnitarioConIvaPorCantidad({
      precio_costo: 100,
      porcentaje_ganancia_base: 50,
      iva_porcentaje: 0,
      iva_default: 21,
      cantidad: 75,
      tramos: [
        { cantidad_desde: 1, ganancia_pct: 50 },
        { cantidad_desde: 100, ganancia_pct: 45 },
      ],
      tramo_forzado_cantidad_desde: 80,
    });
    expect(r.ganancia_pct_usada).toBe(50);
    expect(r.precio_unitario).toBe(150);
  });

  it('propaga redondeo a centenas', () => {
    const r = precioUnitarioConIvaPorCantidad({
      precio_costo: 100,
      porcentaje_ganancia_base: 20,
      iva_porcentaje: 21,
      iva_default: 21,
      cantidad: 1,
      tramos: null,
      redondearPreciosCentenas: true,
    });
    expect(r.precio_unitario).toBe(100);
  });

  it('propaga redondeo de menores a 100 en decenas', () => {
    const r = precioUnitarioConIvaPorCantidad({
      precio_costo: 66,
      porcentaje_ganancia_base: 0,
      iva_porcentaje: 0,
      iva_default: 21,
      cantidad: 1,
      tramos: null,
      redondearPreciosCentenas: true,
      redondearMenores100ADecenas: true,
    });
    expect(r.precio_unitario).toBe(70);
  });

  it('aplica descuento sobre costo antes de ganancia, IVA y redondeo POS', () => {
    const r = precioUnitarioConIvaPorCantidad({
      precio_costo: 465,
      porcentaje_ganancia_base: 42,
      descuento_costo_pct: 50,
      iva_porcentaje: 21,
      iva_default: 21,
      cantidad: 1,
      tramos: null,
      redondearPreciosCentenas: true,
    });
    expect(r.precio_unitario).toBe(400);
  });

  it('rebaja_ganancia_pct resta puntos a la ganancia usada (margen efectivo puede ser negativo)', () => {
    const r = precioUnitarioConIvaPorCantidad({
      precio_costo: 100,
      porcentaje_ganancia_base: 50,
      iva_porcentaje: 0,
      iva_default: 21,
      cantidad: 1,
      tramos: null,
      rebaja_ganancia_pct: 80,
    });
    expect(r.ganancia_pct_usada).toBe(50);
    expect(r.ganancia_pct_ajustada).toBe(-30);
    expect(r.precio_unitario).toBe(70);
  });

  it('aumento_ganancia_pct suma puntos a la ganancia usada', () => {
    const r = precioUnitarioConIvaPorCantidad({
      precio_costo: 100,
      porcentaje_ganancia_base: 50,
      iva_porcentaje: 0,
      iva_default: 21,
      cantidad: 1,
      tramos: null,
      aumento_ganancia_pct: 5,
    });
    expect(r.ganancia_pct_usada).toBe(50);
    expect(r.ganancia_pct_ajustada).toBe(55);
    expect(r.precio_unitario).toBe(155);
  });

  it('combina aumento horario y rebaja manual en puntos', () => {
    const r = precioUnitarioConIvaPorCantidad({
      precio_costo: 100,
      porcentaje_ganancia_base: 50,
      iva_porcentaje: 0,
      iva_default: 21,
      cantidad: 1,
      tramos: null,
      aumento_ganancia_pct: 10,
      rebaja_ganancia_pct: 20,
    });
    expect(r.ganancia_pct_ajustada).toBe(40);
    expect(r.precio_unitario).toBe(140);
  });

  it('infiere ganancia desde PVP cuando no hay porcentaje configurado y hay aumento', () => {
    const r = precioUnitarioConIvaPorCantidad({
      precio_costo: 100,
      precio_venta_base: 150,
      porcentaje_ganancia_base: null,
      iva_porcentaje: 0,
      iva_default: 21,
      cantidad: 1,
      tramos: null,
      aumento_ganancia_pct: 5,
    });
    expect(r.ganancia_pct_usada).toBe(50);
    expect(r.ganancia_pct_ajustada).toBe(55);
    expect(r.precio_unitario).toBe(155);
  });
});
