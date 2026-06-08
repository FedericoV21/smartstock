import { describe, expect, it } from 'vitest';

import {
  comprobanteActualizaIvaProducto,
  construirActualizacionCostoProducto,
  esLineaBonificacionOReposicion,
  importesConPercepciones,
  importesDesdeCabeceraManual,
  preciosItemsConIvaIncluidoAplican,
} from './ejecutar-confirmacion-importado';

describe('construirActualizacionCostoProducto', () => {
  it('devuelve el cambio de costo aplicado con variacion porcentual', () => {
    const cambio = construirActualizacionCostoProducto({
      producto_id: 'prod-1',
      codigo: '116',
      nombre: 'NUEZ MARIPOSA X 100 GR (P)',
      precio_costo_anterior: 2000,
      precio_costo_nuevo: 2196.91,
      precio_venta_anterior: 3000,
    });

    expect(cambio).toMatchObject({
      producto_id: 'prod-1',
      codigo: '116',
      nombre: 'NUEZ MARIPOSA X 100 GR (P)',
      precio_costo_anterior: 2000,
      precio_costo_nuevo: 2196.91,
      precio_venta_anterior: 3000,
      precio_venta_nuevo: 3000,
      variacion_pct: 9.85,
    });
  });

  it('ignora diferencias menores al centavo operativo', () => {
    const cambio = construirActualizacionCostoProducto({
      producto_id: 'prod-1',
      codigo: null,
      nombre: 'Producto',
      precio_costo_anterior: 100,
      precio_costo_nuevo: 100.004,
      precio_venta_anterior: 150,
    });

    expect(cambio).toBeNull();
  });

  it('toma costo previo 0 como sin costo previo', () => {
    const cambio = construirActualizacionCostoProducto({
      producto_id: 'prod-2',
      codigo: '138',
      nombre: 'YOGUR FRUTAS ENTERO FRUTILLA',
      precio_costo_anterior: 0,
      precio_costo_nuevo: 1079.75,
      precio_venta_anterior: 1300,
    });

    expect(cambio).toMatchObject({
      precio_costo_anterior: null,
      precio_costo_nuevo: 1079.75,
      variacion_pct: null,
    });
  });
});

describe('importesDesdeCabeceraManual', () => {
  it('respeta subtotal, IVA y total cargados en la cabecera manual', () => {
    const base = {
      subtotal: 100,
      iva_porcentaje: 21,
      iva_monto: 21,
      total: 121,
      items: [{ producto_id: 'p1', cantidad: 1, precio_unitario: 100, subtotal: 100 }],
      alicuotas: [{ porcentaje: 21, baseImp: 100, importe: 21 }],
    };

    const importes = importesDesdeCabeceraManual(
      {
        subtotal: 300.125,
        iva_monto: 63.025,
        percepcion_iibb_monto: 0,
        percepcion_iva_monto: 0,
        impuesto_interno_monto: 0,
        total: 363.15,
      },
      base,
    );

    expect(importes).toMatchObject({
      subtotal: 300.13,
      iva_monto: 63.03,
      total: 363.15,
      iva_porcentaje: 21,
    });
    expect(importes.items).toEqual(base.items);
    expect(importes.items).not.toBe(base.items);
  });

  it('suma percepciones al total sin alterar neto ni IVA', () => {
    const base = {
      subtotal: 109853.67,
      iva_porcentaje: 21,
      iva_monto: 23069.27,
      total: 132922.94,
      items: [{ producto_id: 'p1', cantidad: 1, precio_unitario: 109853.67, subtotal: 109853.67 }],
      alicuotas: [{ porcentaje: 21, baseImp: 109853.67, importe: 23069.27 }],
    };

    const importes = importesConPercepciones(base, 7689.76);

    expect(importes).toMatchObject({
      subtotal: 109853.67,
      iva_monto: 23069.27,
      total: 140612.7,
    });
    expect(importes.items).toEqual(base.items);
    expect(importes.items).not.toBe(base.items);
  });
});

describe('esLineaBonificacionOReposicion', () => {
  it('detecta línea bonificada con precio en cero', () => {
    expect(
      esLineaBonificacionOReposicion({
        precio_unitario: 0,
        precio_costo: 0,
      }),
    ).toBe(true);
  });

  it('no marca como bonificación cuando hay costo y unitario positivos', () => {
    expect(
      esLineaBonificacionOReposicion({
        precio_unitario: 1000,
      }),
    ).toBe(false);
  });

  it('no marca como bonificación si solo el costo está en cero', () => {
    expect(
      esLineaBonificacionOReposicion({
        precio_unitario: 1000,
      }),
    ).toBe(false);
  });
});

describe('IVA de producto desde comprobante importado', () => {
  it('no permite sincronizar IVA ni tratar precios como IVA incluido en remitos', () => {
    expect(comprobanteActualizaIvaProducto('remito')).toBe(false);
    expect(preciosItemsConIvaIncluidoAplican('remito', true)).toBe(false);
  });

  it('mantiene el comportamiento para facturas y tickets', () => {
    expect(comprobanteActualizaIvaProducto('factura_a')).toBe(true);
    expect(comprobanteActualizaIvaProducto('ticket')).toBe(true);
    expect(preciosItemsConIvaIncluidoAplican('factura_b', true)).toBe(true);
    expect(preciosItemsConIvaIncluidoAplican('factura_b', false)).toBe(false);
  });
});
