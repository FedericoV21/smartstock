import { describe, expect, it } from 'vitest';

import { precioUnitarioLineaEmitirConTramos } from '@/lib/facturacion/precio-unitario-linea-emitir';
import { mergePrecioProductoConSucursal } from '@/lib/producto/precio-sucursal';
import { precioUnitarioBaseParaCantidadPos } from '@/lib/pos/precio-linea-pos';

describe('precio por sucursal', () => {
  it('mergea ganancia propia y marca el PVP como derivado', () => {
    const out = mergePrecioProductoConSucursal(
      { precio_costo: 100, precio_venta: 150, porcentaje_ganancia: 50 },
      { precio_costo: null, precio_venta: 130, porcentaje_ganancia: 30 },
    );

    expect(out.precio_costo).toBe(100);
    expect(out.precio_venta).toBe(130);
    expect(out.porcentaje_ganancia).toBe(30);
    expect(out.precio_sucursal_ganancia_aplicada).toBe(true);
    expect(out.precio_sucursal_manual).toBeUndefined();
  });

  it('usa la ganancia de sucursal como tramo base al emitir', () => {
    const pu = precioUnitarioLineaEmitirConTramos(
      { cantidad: 1, precio_unitario: 130 },
      {
        precio_costo: 100,
        precio_venta: 130,
        porcentaje_ganancia: 30,
        iva_porcentaje: 0,
        precio_sucursal_ganancia_aplicada: true,
      },
      [
        { cantidad_desde: 1, ganancia_pct: 50 },
        { cantidad_desde: 10, ganancia_pct: 20 },
      ],
      21,
      false,
    );

    expect(pu).toBe(130);
  });

  it('conserva un precio manual legacy de sucursal si no hay ganancia propia', () => {
    const pu = precioUnitarioLineaEmitirConTramos(
      { cantidad: 1, precio_unitario: 180 },
      {
        precio_costo: 100,
        precio_venta: 180,
        porcentaje_ganancia: 50,
        iva_porcentaje: 0,
        precio_sucursal_manual: true,
      },
      [{ cantidad_desde: 1, ganancia_pct: 50 }],
      21,
      false,
    );

    expect(pu).toBe(180);
  });

  it('el POS tambien conserva precio manual legacy sin recalcular', () => {
    const pu = precioUnitarioBaseParaCantidadPos(
      {
        precio_costo: 100,
        precio_venta: 180,
        porcentaje_ganancia: 50,
        iva_porcentaje: 0,
        precio_sucursal_manual: true,
        ganancia_tramos: [{ cantidad_desde: 1, ganancia_pct: 50 }],
      },
      1,
      21,
      false,
    );

    expect(pu).toBe(180);
  });

  it('el POS recalcula tramos con descuento sobre costo', () => {
    const pu = precioUnitarioBaseParaCantidadPos(
      {
        precio_costo: 465,
        precio_venta: 399.49,
        porcentaje_ganancia: 42,
        descuento_costo_pct: 50,
        iva_porcentaje: 21,
      },
      1,
      21,
      true,
    );

    expect(pu).toBe(400);
  });

  it('el POS suma aumento horario sobre la ganancia propia de sucursal', () => {
    const pu = precioUnitarioBaseParaCantidadPos(
      {
        precio_costo: 100,
        precio_venta: 130,
        porcentaje_ganancia: 30,
        iva_porcentaje: 0,
        precio_sucursal_ganancia_aplicada: true,
      },
      1,
      21,
      false,
      undefined,
      undefined,
      5,
    );

    expect(pu).toBe(135);
  });

  it('el POS infiere ganancia desde precio manual cuando hay aumento horario', () => {
    const pu = precioUnitarioBaseParaCantidadPos(
      {
        precio_costo: 100,
        precio_venta: 180,
        porcentaje_ganancia: null,
        iva_porcentaje: 0,
        precio_sucursal_manual: true,
      },
      1,
      21,
      false,
      undefined,
      undefined,
      5,
    );

    expect(pu).toBe(185);
  });

  it('el POS usa un tramo elegido manualmente para una cantidad menor', () => {
    const pu = precioUnitarioBaseParaCantidadPos(
      {
        precio_costo: 100,
        precio_venta: 150,
        porcentaje_ganancia: 50,
        iva_porcentaje: 0,
        ganancia_tramos: [
          { cantidad_desde: 1, ganancia_pct: 50 },
          { cantidad_desde: 100, ganancia_pct: 45 },
        ],
      },
      75,
      21,
      false,
      undefined,
      undefined,
      undefined,
      100,
    );

    expect(pu).toBe(145);
  });
});
