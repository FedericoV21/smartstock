import { describe, expect, it } from 'vitest';

import { mapUnidadFacturaTexto, normalizarLineaLectorFactura } from './normalizar-linea-lector-factura';

describe('normalizarLineaLectorFactura', () => {
  const base = {
    nombre_producto_catalogo: null as string | null,
    unidad_factura: null as string | null,
    unidad_stock_producto: 'unidad' as const,
    cantidad: 2,
    precio_unitario: 121,
    precio_costo_input: 121,
    inferir_pack: false,
    precios_con_iva_incluido: false,
    iva_porcentaje: 21 as number | null,
    iva_default: 21,
  };

  it('divide PU entre contenido cuando infiere pack', () => {
    const r = normalizarLineaLectorFactura({
      ...base,
      descripcion_factura: 'Clavos caja x 500',
      inferir_pack: true,
    });
    expect(r.aplico_inferencia_pack).toBe(true);
    expect(r.cantidad).toBe(1000);
    expect(r.precio_unitario).toBeCloseTo(0.24, 5);
    expect(r.precio_costo).toBeCloseTo(0.24, 5);
  });

  it('mantiene cantidad y PU cuando x N describe gramos de la presentacion', () => {
    const r = normalizarLineaLectorFactura({
      ...base,
      descripcion_factura: 'NUEZ MARIPOSA X 100 GR (P)',
      inferir_pack: true,
      cantidad: 8,
      precio_unitario: 2196.91,
      precio_costo_input: 2196.91,
    });
    expect(r.aplico_inferencia_pack).toBe(false);
    expect(r.cantidad).toBe(8);
    expect(r.precio_unitario).toBe(2196.91);
    expect(r.precio_costo).toBe(2196.91);
  });

  it('calcula costo neto cuando precios van con IVA incluido', () => {
    const r = normalizarLineaLectorFactura({
      ...base,
      descripcion_factura: 'Producto X',
      precios_con_iva_incluido: true,
      cantidad: 1,
      precio_unitario: 121,
      precio_costo_input: 121,
    });
    expect(r.precio_unitario).toBe(121);
    expect(r.precio_costo).toBe(100);
  });

  it('aplica pack primero y luego neto de IVA', () => {
    const r = normalizarLineaLectorFactura({
      ...base,
      descripcion_factura: 'Item caja x 500',
      inferir_pack: true,
      precios_con_iva_incluido: true,
      cantidad: 1,
      precio_unitario: 605,
      precio_costo_input: 605,
      iva_porcentaje: 21,
    });
    expect(r.cantidad).toBe(500);
    expect(r.precio_unitario).toBeCloseTo(1.21, 5);
    expect(r.precio_costo).toBeCloseTo(1.0, 5);
  });

  it('permite forzar presentacion de compra habitual del catalogo', () => {
    const r = normalizarLineaLectorFactura({
      ...base,
      descripcion_factura: 'Producto suelto',
      cantidad: 10,
      precio_unitario: 2600,
      precio_costo_input: 2600,
      presentacion_modo: 'presentacion_compra',
      contenido_presentacion_compra: 26,
    });
    expect(r.aplico_inferencia_pack).toBe(true);
    expect(r.cantidad).toBe(260);
    expect(r.precio_unitario).toBe(100);
    expect(r.precio_costo).toBe(100);
  });

  it('permite forzar unidad base aunque el texto parezca caja', () => {
    const r = normalizarLineaLectorFactura({
      ...base,
      descripcion_factura: 'Producto caja x 26',
      inferir_pack: true,
      cantidad: 10,
      precio_unitario: 100,
      precio_costo_input: 100,
      presentacion_modo: 'unidad_base',
      contenido_presentacion_compra: 26,
    });
    expect(r.aplico_inferencia_pack).toBe(false);
    expect(r.cantidad).toBe(10);
    expect(r.precio_unitario).toBe(100);
    expect(r.precio_costo).toBe(100);
  });
});

describe('mapUnidadFacturaTexto', () => {
  it('normaliza abreviaturas con puntuacion de kg', () => {
    expect(mapUnidadFacturaTexto('Kg.')).toBe('kg');
    expect(mapUnidadFacturaTexto('KGS')).toBe('kg');
  });

  it('normaliza abreviaturas de unidades', () => {
    expect(mapUnidadFacturaTexto('Un.')).toBe('unidad');
    expect(mapUnidadFacturaTexto('und')).toBe('unidad');
  });
});
