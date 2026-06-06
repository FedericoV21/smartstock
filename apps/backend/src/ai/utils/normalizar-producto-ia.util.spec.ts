import { normalizarProductoDesdeIa } from './normalizar-producto-ia.util';

describe('normalizarProductoDesdeIa', () => {
  it('normaliza producto con precio legacy y descuento', () => {
    const out = normalizarProductoDesdeIa({
      codigo: ' A1 ',
      nombre: ' Yerba ',
      precio: 1200,
      descuento_costo_pct: '10%',
      stock_actual: '5',
      unidad: 'unidad',
      categoria: 'Almac├®n',
    });
    expect(out).toEqual({
      codigo: 'A1',
      nombre: 'Yerba',
      precioVenta: 1200,
      precioCosto: null,
      descuentoCostoPct: 10,
      stockActual: 5,
      unidad: 'unidad',
      categoria: 'Almac├®n',
    });
  });

  it('rechaza filas sin nombre', () => {
    expect(normalizarProductoDesdeIa({ codigo: 'X', nombre: '  ' })).toBeNull();
  });
});
