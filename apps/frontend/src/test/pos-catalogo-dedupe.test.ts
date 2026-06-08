import { describe, expect, it } from 'vitest';

import { dedupeProductosCatalogoParaCaja } from '@/lib/pos/enriquecer-productos-pos-sucursal-caja';
import type { ProductoRow } from '@/lib/pos/resolver-producto-barcode-pos';

function row(overrides: Partial<ProductoRow> & { id: string; nombre: string }): ProductoRow {
  return {
    id: overrides.id,
    tenant_id: overrides.tenant_id ?? 'tenant-1',
    codigo: overrides.codigo ?? '9',
    codigo_barras: overrides.codigo_barras ?? null,
    plu: overrides.plu ?? null,
    nombre: overrides.nombre,
    proveedor_id: overrides.proveedor_id ?? 'prov-1',
    sucursal_id: overrides.sucursal_id ?? 'suc-1',
    unidad: overrides.unidad ?? 'unidad',
    stock_actual: overrides.stock_actual ?? 0,
  } as ProductoRow;
}

describe('dedupeProductosCatalogoParaCaja', () => {
  it('mantiene productos distintos aunque compartan codigo y unidad', () => {
    const rows = [
      row({ id: 'bombilla', nombre: 'bombilla de plastico' }),
      row({ id: 'hilo', nombre: 'hilo de barrilete naranja' }),
      row({ id: 'keterolac', nombre: 'Keterolac', codigo_barras: '12345678' }),
    ];

    expect(dedupeProductosCatalogoParaCaja(rows, 'suc-1', new Map()).map((x) => x.id)).toEqual([
      'bombilla',
      'hilo',
      'keterolac',
    ]);
  });

  it('sigue fusionando copias equivalentes entre sucursales y prioriza la caja', () => {
    const rows = [
      row({ id: 'otro-deposito', nombre: 'Keterolac', sucursal_id: 'suc-2', stock_actual: 10 }),
      row({ id: 'deposito-caja', nombre: 'Keterolac', sucursal_id: 'suc-1', stock_actual: -9 }),
    ];

    expect(dedupeProductosCatalogoParaCaja(rows, 'suc-1', new Map()).map((x) => x.id)).toEqual([
      'deposito-caja',
    ]);
  });
});
