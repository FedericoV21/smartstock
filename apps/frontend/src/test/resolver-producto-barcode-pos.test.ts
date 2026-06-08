import { describe, expect, it } from 'vitest';

import {
  pickProductoBarcodeParaSucursalCaja,
  type ProductoRow,
} from '@/lib/pos/resolver-producto-barcode-pos';

function row(id: string, sucursal_id: string): ProductoRow {
  return { id, sucursal_id } as ProductoRow;
}

function stockMap(
  entries: [string, number][],
): Map<string, { stock_actual: number; stock_minimo: number; ubicacion: string | null }> {
  const m = new Map<string, { stock_actual: number; stock_minimo: number; ubicacion: string | null }>();
  for (const [id, stock_actual] of entries) {
    m.set(id, { stock_actual, stock_minimo: 0, ubicacion: null });
  }
  return m;
}

describe('pickProductoBarcodeParaSucursalCaja', () => {
  it('prefiere la fila cuyo depósito hogar es la sucursal de la caja', () => {
    const caja = 's-b';
    const a = row('1', 's-a');
    const b = row('2', caja);
    const m = stockMap([
      ['1', 99],
      ['2', 1],
    ]);
    expect(pickProductoBarcodeParaSucursalCaja([a, b], caja, m).id).toBe('2');
  });

  it('sin hogar en caja elige la fila con mayor stock en esa caja', () => {
    const caja = 's-b';
    const a = row('1', 's-a');
    const d = row('4', 's-d');
    const m = stockMap([
      ['1', 10],
      ['4', 3],
    ]);
    expect(pickProductoBarcodeParaSucursalCaja([a, d], caja, m).id).toBe('1');
  });

  it('empate por stock usa id lexicográfico', () => {
    const caja = 's-b';
    const x = row('z', 's-a');
    const y = row('a', 's-d');
    const m = stockMap([
      ['z', 5],
      ['a', 5],
    ]);
    expect(pickProductoBarcodeParaSucursalCaja([x, y], caja, m).id).toBe('a');
  });
});
