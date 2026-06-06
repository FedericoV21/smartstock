import type { Producto } from '../../products/entities/producto.entity';

export type StockOverlayPos = {
  stock_actual: number;
  stock_minimo: number;
  ubicacion: string | null;
};

function cleanPart(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function claveCatalogoEquivalente(row: {
  codigo: string;
  unidad: string;
  nombre: string;
  proveedorId?: string | null;
  codigoBarras?: string | null;
  plu?: string | null;
}): string {
  return [
    cleanPart(row.codigo),
    cleanPart(row.unidad),
    cleanPart(row.nombre),
    cleanPart(row.proveedorId),
    cleanPart(row.codigoBarras),
    cleanPart(row.plu),
  ].join('\0');
}

function pickProductoParaSucursal(
  rows: Producto[],
  sucursalCajaId: string,
  stockMap: Map<string, StockOverlayPos>,
): Producto {
  if (rows.length === 1) return rows[0]!;
  const enCaja = rows.find((r) => r.sucursalId === sucursalCajaId);
  if (enCaja) return enCaja;
  const conStock = rows
    .filter((r) => (stockMap.get(r.id)?.stock_actual ?? 0) > 0)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  if (conStock[0]) return conStock[0];
  return [...rows].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))[0]!;
}

export function dedupeProductosCatalogoParaCaja(
  rows: Producto[],
  sucursalCajaId: string,
  stockMap: Map<string, StockOverlayPos>,
): Producto[] {
  const groups = new Map<string, Producto[]>();
  for (const r of rows) {
    const k = claveCatalogoEquivalente(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const picked = [...groups.values()].map((g) => pickProductoParaSucursal(g, sucursalCajaId, stockMap));
  picked.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  return picked;
}
