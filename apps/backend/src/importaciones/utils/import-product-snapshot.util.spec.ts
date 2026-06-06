import { Producto } from '../../products/entities/producto.entity';
import { UnidadMedida } from '../../products/enums/unidad-medida.enum';
import {
  asProductoImportSnapshot,
  productoUpdateFromSnapshot,
  snapshotProductoImport,
} from './import-product-snapshot.util';

describe('import-product-snapshot.util', () => {
  const producto = {
    id: 'p1',
    tenantId: 't1',
    sucursalId: 's1',
    codigo: 'SKU-1',
    codigoBarras: null,
    nombre: 'Yerba',
    descripcion: null,
    categoriaId: null,
    proveedorId: null,
    unidad: UnidadMedida.unidad,
    esPesable: false,
    precioCosto: '100.00',
    precioVenta: '150.00',
    stockActual: '5.000',
    stockMinimo: '1.000',
    fechaVencimiento: null,
    plu: null,
    ivaPorcentaje: null,
    porcentajeGanancia: null,
    descuentoCostoPct: null,
    usaVariantes: false,
    activo: true,
  } as Producto;

  it('snapshots producto with snake_case keys', () => {
    const snap = snapshotProductoImport(producto);
    expect(snap.codigo).toBe('SKU-1');
    expect(snap.precio_costo).toBe(100);
    expect(snap.stock_actual).toBe(5);
  });

  it('round-trips snapshot to producto update patch', () => {
    const snap = snapshotProductoImport(producto);
    const patch = productoUpdateFromSnapshot(snap);
    expect(patch.nombre).toBe('Yerba');
    expect(patch.precioVenta).toBe('150.00');
  });

  it('parses stored snapshot json', () => {
    const raw = snapshotProductoImport(producto);
    expect(asProductoImportSnapshot(raw)?.nombre).toBe('Yerba');
  });
});
