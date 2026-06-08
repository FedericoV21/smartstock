import { describe, expect, it } from 'vitest';

import { precioUnitarioLineaEmitirConTramos } from '@/lib/facturacion/precio-unitario-linea-emitir';

describe('precioUnitarioLineaEmitirConTramos', () => {
  it('con rebaja fuerza recomputo desde costo aunque el body traiga otro precio', () => {
    const pu = precioUnitarioLineaEmitirConTramos(
      { cantidad: 1, precio_unitario: 999, rebaja_ganancia_pct: 10 },
      { precio_costo: 100, precio_venta: 200, porcentaje_ganancia: 50, iva_porcentaje: 0 },
      null,
      21,
      false,
    );
    expect(pu).toBe(140);
  });

  it('sin rebaja respeta precio manual si difiere del catálogo', () => {
    const pu = precioUnitarioLineaEmitirConTramos(
      { cantidad: 1, precio_unitario: 175 },
      { precio_costo: 100, precio_venta: 150, porcentaje_ganancia: 50, iva_porcentaje: 0 },
      null,
      21,
      false,
    );
    expect(pu).toBe(175);
  });

  it('cuando emite desde POS recalcula usando descuento sobre costo', () => {
    const pu = precioUnitarioLineaEmitirConTramos(
      { cantidad: 1, precio_unitario: 399.49 },
      {
        precio_costo: 465,
        precio_venta: 399.49,
        porcentaje_ganancia: 42,
        descuento_costo_pct: 50,
        iva_porcentaje: 21,
      },
      null,
      21,
      true,
    );
    expect(pu).toBe(400);
  });

  it('con aumento horario recalcula aunque el body traiga precio catalogo', () => {
    const pu = precioUnitarioLineaEmitirConTramos(
      { cantidad: 1, precio_unitario: 150 },
      { precio_costo: 100, precio_venta: 150, porcentaje_ganancia: 50, iva_porcentaje: 0 },
      null,
      21,
      false,
      false,
      5,
    );
    expect(pu).toBe(155);
  });

  it('con aumento horario respeta precio manual si no coincide con catalogo ni calculado', () => {
    const pu = precioUnitarioLineaEmitirConTramos(
      { cantidad: 1, precio_unitario: 175 },
      { precio_costo: 100, precio_venta: 150, porcentaje_ganancia: 50, iva_porcentaje: 0 },
      null,
      21,
      false,
      false,
      5,
    );
    expect(pu).toBe(175);
  });

  it('con aumento horario infiere ganancia desde PVP cuando no hay porcentaje', () => {
    const pu = precioUnitarioLineaEmitirConTramos(
      { cantidad: 1, precio_unitario: 150 },
      { precio_costo: 100, precio_venta: 150, porcentaje_ganancia: null, iva_porcentaje: 0 },
      null,
      21,
      false,
      false,
      5,
    );
    expect(pu).toBe(155);
  });

  it('recalcula con el tramo forzado aunque la cantidad vendida sea menor', () => {
    const pu = precioUnitarioLineaEmitirConTramos(
      { cantidad: 75, precio_unitario: 150, tramo_ganancia_forzado_cantidad_desde: 100 },
      { precio_costo: 100, precio_venta: 150, porcentaje_ganancia: 50, iva_porcentaje: 0 },
      [
        { cantidad_desde: 1, ganancia_pct: 50 },
        { cantidad_desde: 100, ganancia_pct: 45 },
      ],
      21,
      false,
    );
    expect(pu).toBe(145);
  });

  it('combina rebaja de ganancia con tramo forzado', () => {
    const pu = precioUnitarioLineaEmitirConTramos(
      {
        cantidad: 75,
        precio_unitario: 150,
        rebaja_ganancia_pct: 10,
        tramo_ganancia_forzado_cantidad_desde: 100,
      },
      { precio_costo: 100, precio_venta: 150, porcentaje_ganancia: 50, iva_porcentaje: 0 },
      [
        { cantidad_desde: 1, ganancia_pct: 50 },
        { cantidad_desde: 100, ganancia_pct: 45 },
      ],
      21,
      false,
    );
    expect(pu).toBe(135);
  });
});
