import { describe, expect, it } from 'vitest';

import { inferirUnidadVentasPesoDesdeTexto, resolverUnidadStockImportacion } from './inferir-unidad-stock-desde-texto';

describe('inferirUnidadVentasPesoDesdeTexto', () => {
  it('detecta por kg / por kilo', () => {
    expect(inferirUnidadVentasPesoDesdeTexto('Jamón por kg')).toBe('kg');
    expect(inferirUnidadVentasPesoDesdeTexto('Queso por kilo')).toBe('kg');
  });

  it('detecta x kg y x N kg', () => {
    expect(inferirUnidadVentasPesoDesdeTexto('Fiambre x kg')).toBe('kg');
    expect(inferirUnidadVentasPesoDesdeTexto('Queso × 2,5 kg')).toBe('kg');
    expect(inferirUnidadVentasPesoDesdeTexto('Producto x 1 kg')).toBe('kg');
  });

  it('detecta x N gr / x100gr', () => {
    expect(inferirUnidadVentasPesoDesdeTexto('Snack x 250 gr')).toBe('gramo');
    expect(inferirUnidadVentasPesoDesdeTexto('Barra x100gr')).toBe('gramo');
  });

  it('no marca por bolsa 500 gr sin x/por', () => {
    expect(inferirUnidadVentasPesoDesdeTexto('Alfajor bolsa 500 gr')).toBeNull();
  });

  it('no confunde caja x 500 unidades', () => {
    expect(inferirUnidadVentasPesoDesdeTexto('Clavo caja x 500')).toBeNull();
  });
});

describe('resolverUnidadStockImportacion', () => {
  it('prioriza enum explícito en columna', () => {
    expect(
      resolverUnidadStockImportacion({ nombre: 'x kg pero es unidad', unidad: 'unidad' }, 'unidad'),
    ).toBe('unidad');
  });

  it('permite forzar pesable en kg aunque la columna diga unidad', () => {
    expect(
      resolverUnidadStockImportacion(
        { nombre: 'Producto unitario', unidad: 'unidad' },
        'unidad',
        { forzarProductosPesables: true },
      ),
    ).toBe('kg');
  });

  it('sin opt-in no infiere pesable solo por nombre', () => {
    expect(resolverUnidadStockImportacion({ nombre: 'Jamón criollo x kg', unidad: null }, 'unidad')).toBe(
      'unidad',
    );
  });

  it('con opt-in infiere kg por nombre', () => {
    expect(
      resolverUnidadStockImportacion(
        { nombre: 'Jamón criollo x kg', unidad: null },
        'unidad',
        { aplicarInferenciaPesablePorNombre: true },
      ),
    ).toBe('kg');
  });

  it('fallback si no hay señales', () => {
    expect(resolverUnidadStockImportacion({ nombre: 'Galletitas', unidad: null }, 'unidad')).toBe('unidad');
  });
});
