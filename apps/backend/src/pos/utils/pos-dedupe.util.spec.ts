import { dedupeProductosCatalogoParaCaja } from './pos-dedupe.util';
import type { Producto } from '../../products/entities/producto.entity';

function producto(partial: Partial<Producto> & Pick<Producto, 'id' | 'codigo' | 'nombre'>): Producto {
  return {
    unidad: 'un',
    sucursalId: null,
    proveedorId: null,
    codigoBarras: null,
    plu: null,
    ...partial,
  } as Producto;
}

describe('pos-dedupe', () => {
  it('elige producto de la sucursal de caja cuando hay duplicados equivalentes', () => {
    const sucursal = 'suc-1';
    const a = producto({ id: 'a', codigo: 'X1', nombre: 'Item', sucursalId: 'otra' });
    const b = producto({ id: 'b', codigo: 'X1', nombre: 'Item', sucursalId: sucursal });
    const stockMap = new Map([
      ['a', { stock_actual: 10, stock_minimo: 0, ubicacion: null }],
      ['b', { stock_actual: 0, stock_minimo: 0, ubicacion: null }],
    ]);
    const out = dedupeProductosCatalogoParaCaja([a, b], sucursal, stockMap);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('b');
  });
});
