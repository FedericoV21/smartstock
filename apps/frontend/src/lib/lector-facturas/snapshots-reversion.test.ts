import { describe, expect, it } from 'vitest';

import {
  hashSnapshot,
  productoUpdateDesdeSnapshot,
  snapshotCoincide,
  snapshotPreciosSucursal,
  snapshotProductoCatalogo,
  stableJson,
} from './snapshots-reversion';

describe('snapshots de reversion de factura importada', () => {
  it('genera JSON estable aunque cambie el orden de claves', () => {
    const a = { b: 2, a: { d: 4, c: 3 } };
    const b = { a: { c: 3, d: 4 }, b: 2 };

    expect(stableJson(a)).toBe(stableJson(b));
    expect(hashSnapshot(a)).toBe(hashSnapshot(b));
  });

  it('normaliza el snapshot de producto a campos restaurables', () => {
    const snapshot = snapshotProductoCatalogo({
      activo: true,
      codigo: 'P-1',
      contenido_unidad_compra: '12' as unknown as number,
      iva_porcentaje: '21' as unknown as number,
      nombre: 'Producto',
      precio_costo: '100.5' as unknown as number,
      precio_venta: '150.75' as unknown as number,
      proveedor_id: null,
      unidad: 'unidad',
      unidad_compra: 'caja',
    });

    expect(snapshot).toMatchObject({
      contenido_unidad_compra: 12,
      iva_porcentaje: 21,
      precio_costo: 100.5,
      precio_venta: 150.75,
    });
    expect(productoUpdateDesdeSnapshot(snapshot)).toMatchObject({
      codigo: 'P-1',
      unidad_compra: 'caja',
    });
  });

  it('ordena precios por id antes de comparar hashes', () => {
    const rows = [
      { id: 'b', precio_costo: 20, precio_venta: 30, porcentaje_ganancia: 50, sucursal_id: 's2' },
      { id: 'a', precio_costo: 10, precio_venta: 15, porcentaje_ganancia: 50, sucursal_id: 's1' },
    ];

    const snapshot = snapshotPreciosSucursal(rows);

    expect(snapshot.map((row) => row.id)).toEqual(['a', 'b']);
    expect(snapshotCoincide([...snapshot].reverse(), hashSnapshot(snapshot))).toBe(false);
    expect(snapshotCoincide(snapshot, hashSnapshot(snapshot))).toBe(true);
  });
});
