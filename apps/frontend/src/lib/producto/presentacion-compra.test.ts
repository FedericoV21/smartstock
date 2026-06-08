import { describe, expect, it } from 'vitest';

import {
  normalizarPreciosProductoPresentacionCompra,
  resolverCostoPresentacionCompra,
  resolverPreciosPresentacionCompra,
  resolverPresentacionCompraImport,
} from './presentacion-compra';
import { precioUnitarioBaseParaCantidadPos } from '@/lib/pos/precio-linea-pos';

describe('resolverPresentacionCompraImport', () => {
  const filaEjemplo = { nombre: 'Tornillo caja x 300 u', glosaUnidadColumna: null as string | null };

  it('sin flag no infiere desde el nombre', () => {
    expect(resolverPresentacionCompraImport(filaEjemplo, 'unidad')).toBeNull();
    expect(
      resolverPresentacionCompraImport(filaEjemplo, 'unidad', {
        aplicarInferenciaPresentacionCompraDesdeNombre: false,
      }),
    ).toBeNull();
  });

  it('con flag infiere caja cuando no hay columnas UM compra', () => {
    const r = resolverPresentacionCompraImport(filaEjemplo, 'unidad', {
      aplicarInferenciaPresentacionCompraDesdeNombre: true,
    });
    expect(r).toEqual({ unidad_compra: 'caja', contenido_unidad_compra: 300 });
  });

  it('columnas explícitas ganan aunque el flag esté apagado', () => {
    expect(
      resolverPresentacionCompraImport(
        {
          nombre: 'Otro',
          unidad_compra: 'pack',
          contenido_unidad_compra: 6,
        },
        'unidad',
      ),
    ).toEqual({ unidad_compra: 'pack', contenido_unidad_compra: 6 });
  });
});

describe('resolverCostoPresentacionCompra', () => {
  it('detecta costo guardado como caja y devuelve costo unitario', () => {
    const r = resolverCostoPresentacionCompra(
      {
        precioCosto: 6027.46,
        precioVenta: 300,
        porcentajeGanancia: 33,
        ivaPorcentaje: 21,
        unidadCompra: 'caja',
        contenidoUnidadCompra: 30,
      },
      21,
    );

    expect(r).toEqual({
      costoUnitarioStock: 200.92,
      costoUnidadCompra: 6027.46,
      costoGuardadoComoUnidadCompra: true,
    });
  });

  it('mantiene el costo unitario cuando ya esta normalizado', () => {
    const r = resolverCostoPresentacionCompra(
      {
        precioCosto: 200.92,
        precioVenta: 323.52,
        porcentajeGanancia: 33,
        ivaPorcentaje: 21,
        unidadCompra: 'caja',
        contenidoUnidadCompra: 30,
      },
      21,
    );

    expect(r).toEqual({
      costoUnitarioStock: 200.92,
      costoUnidadCompra: 6027.6,
      costoGuardadoComoUnidadCompra: false,
    });
  });

  it('mantiene costo y venta cuando ya estan guardados por unidad aunque sean altos', () => {
    const r = resolverPreciosPresentacionCompra(
      {
        precioCosto: 1153.85,
        precioVenta: 1955.83,
        porcentajeGanancia: 40,
        ivaPorcentaje: 21,
        unidadCompra: 'caja',
        contenidoUnidadCompra: 26,
      },
      21,
    );

    expect(r.costoUnitarioStock).toBe(1153.85);
    expect(r.costoUnidadCompra).toBe(30000.1);
    expect(r.precioVentaUnitarioStock).toBe(1955.83);
    expect(r.precioVentaUnidadCompra).toBe(50851.58);
    expect(r.costoGuardadoComoUnidadCompra).toBe(false);
    expect(r.precioVentaGuardadoComoUnidadCompra).toBe(false);
  });

  it('normaliza el producto para POS cuando el costo viene por caja y la venta por unidad', () => {
    const p = normalizarPreciosProductoPresentacionCompra(
      {
        precio_costo: 6027.46,
        precio_venta: 300,
        porcentaje_ganancia: 33,
        iva_porcentaje: 21,
        unidad_compra: 'caja',
        contenido_unidad_compra: 30,
      },
      21,
    );

    expect(p.precio_costo).toBe(200.92);
    expect(p.precio_venta).toBe(300);
  });

  it('permite que POS calcule unidad y caja desde el costo unitario corregido', () => {
    const p = normalizarPreciosProductoPresentacionCompra(
      {
        precio_costo: 6027.46,
        precio_venta: 300,
        porcentaje_ganancia: 33,
        iva_porcentaje: 21,
        unidad_compra: 'caja',
        contenido_unidad_compra: 30,
      },
      21,
    );

    const unitario = precioUnitarioBaseParaCantidadPos(p, 1, 21, true);
    expect(unitario).toBe(300);
    expect(unitario * 30).toBe(9000);
  });

  it('no vuelve a dividir un producto recien guardado desde costo por caja', () => {
    const p = normalizarPreciosProductoPresentacionCompra(
      {
        precio_costo: 1153.85,
        precio_venta: 1955.83,
        porcentaje_ganancia: 40,
        iva_porcentaje: 21,
        unidad_compra: 'caja',
        contenido_unidad_compra: 26,
      },
      21,
    );

    expect(p.precio_costo).toBe(1153.85);
    expect(p.precio_venta).toBe(1955.83);
  });

  it('no infiere costo de caja sin un precio de venta para contrastar', () => {
    const r = resolverCostoPresentacionCompra({
      precioCosto: 6027.46,
      precioVenta: null,
      unidadCompra: 'caja',
      contenidoUnidadCompra: 30,
    });

    expect(r).toEqual({
      costoUnitarioStock: 6027.46,
      costoUnidadCompra: 180823.8,
      costoGuardadoComoUnidadCompra: false,
    });
  });
});
