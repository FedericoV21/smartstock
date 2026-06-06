import { BadRequestException } from '@nestjs/common';

import { assertProveedorFiltersValid, enrichListProducts } from './products-list.helpers';
import { margenGananciaSobreCostoSinIva } from './utils/calcular-precio-venta';
import { UnidadMedida } from './enums/unidad-medida.enum';
import type { Producto } from './entities/producto.entity';

describe('products-list.helpers', () => {
  it('assertProveedorFiltersValid rejects mixed proveedor filters', () => {
    expect(() =>
      assertProveedorFiltersValid({
        proveedorId: '00000000-0000-4000-8000-000000000001',
        proveedorIds: ['00000000-0000-4000-8000-000000000002'],
      }),
    ).toThrow(BadRequestException);
  });

  it('enrichListProducts adds margen and relations', () => {
    const p = {
      id: 'p1',
      tenantId: 't1',
      codigo: 'A',
      nombre: 'Prod',
      descripcion: null,
      categoriaId: 'c1',
      proveedorId: 'pr1',
      sucursalId: 's1',
      unidad: UnidadMedida.unidad,
      precioCosto: '100.00',
      precioVenta: '150.00',
      stockActual: '2.000',
      stockMinimo: '1.000',
      codigoBarras: null,
      plu: null,
      esPesable: false,
      fechaVencimiento: null,
      imagenUrl: null,
      usaVariantes: false,
      activo: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Producto;

    const [row] = enrichListProducts([p], {
      categorias: new Map([['c1', { id: 'c1', nombre: 'Cat' } as never]]),
      proveedores: new Map([['pr1', { id: 'pr1', nombre: 'Prov' } as never]]),
      sucursales: new Map([
        ['s1', { id: 's1', nombre: 'CASA', codigo: 'CASA' } as never],
      ]),
    });

    expect(row.categoria).toEqual({ id: 'c1', nombre: 'Cat' });
    expect(row.proveedor).toEqual({ id: 'pr1', nombre: 'Prov' });
    expect(row.sucursal).toEqual({ id: 's1', nombre: 'CASA', codigo: 'CASA' });
    expect(row.margenGananciaPct).toBe(
      margenGananciaSobreCostoSinIva(100, 150, null, 21),
    );
  });
});
