import { createHash } from 'node:crypto';

import type { Database } from '@/types/database';

type UnidadMedida = Database['public']['Enums']['unidad_medida'];
type ProductoRow = Pick<
  Database['public']['Tables']['producto']['Row'],
  | 'activo'
  | 'codigo'
  | 'contenido_unidad_compra'
  | 'iva_porcentaje'
  | 'nombre'
  | 'precio_costo'
  | 'precio_venta'
  | 'proveedor_id'
  | 'unidad'
  | 'unidad_compra'
>;
type ProductoUpdate = Database['public']['Tables']['producto']['Update'];
type PrecioSucursalRow = Pick<
  Database['public']['Tables']['precio_sucursal']['Row'],
  'id' | 'precio_costo' | 'precio_venta' | 'porcentaje_ganancia' | 'sucursal_id'
>;
type PrecioSucursalUpdate = Database['public']['Tables']['precio_sucursal']['Update'];

export const PRODUCTO_SNAPSHOT_SELECT =
  'id, activo, codigo, contenido_unidad_compra, iva_porcentaje, nombre, precio_costo, precio_venta, proveedor_id, unidad, unidad_compra';
export const PRECIO_SUCURSAL_SNAPSHOT_SELECT =
  'id, producto_id, precio_costo, precio_venta, porcentaje_ganancia, sucursal_id';

export type ProductoCatalogoSnapshot = {
  activo: boolean;
  codigo: string;
  contenido_unidad_compra: number | null;
  iva_porcentaje: number | null;
  nombre: string;
  precio_costo: number;
  precio_venta: number;
  proveedor_id: string | null;
  unidad: UnidadMedida;
  unidad_compra: UnidadMedida | null;
};

export type PrecioSucursalSnapshot = {
  id: string;
  precio_costo: number | null;
  precio_venta: number | null;
  porcentaje_ganancia: number | null;
  sucursal_id: string;
};

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numReq(value: number | string | null | undefined): number {
  return num(value) ?? 0;
}

export function snapshotProductoCatalogo(row: ProductoRow): ProductoCatalogoSnapshot {
  return {
    activo: Boolean(row.activo),
    codigo: row.codigo,
    contenido_unidad_compra: num(row.contenido_unidad_compra),
    iva_porcentaje: num(row.iva_porcentaje),
    nombre: row.nombre,
    precio_costo: numReq(row.precio_costo),
    precio_venta: numReq(row.precio_venta),
    proveedor_id: row.proveedor_id ?? null,
    unidad: row.unidad,
    unidad_compra: row.unidad_compra ?? null,
  };
}

export function snapshotPreciosSucursal(rows: PrecioSucursalRow[]): PrecioSucursalSnapshot[] {
  return rows
    .map((row) => ({
      id: row.id,
      precio_costo: num(row.precio_costo),
      precio_venta: num(row.precio_venta),
      porcentaje_ganancia: num(row.porcentaje_ganancia),
      sucursal_id: row.sucursal_id,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function ordenarValor(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordenarValor);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = ordenarValor((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(ordenarValor(value));
}

export function hashSnapshot(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function snapshotCoincide(value: unknown, hashEsperado: string | null | undefined): boolean {
  return Boolean(hashEsperado) && hashSnapshot(value) === hashEsperado;
}

export function productoUpdateDesdeSnapshot(snapshot: ProductoCatalogoSnapshot): ProductoUpdate {
  return {
    activo: snapshot.activo,
    codigo: snapshot.codigo,
    contenido_unidad_compra: snapshot.contenido_unidad_compra,
    iva_porcentaje: snapshot.iva_porcentaje,
    nombre: snapshot.nombre,
    precio_costo: snapshot.precio_costo,
    precio_venta: snapshot.precio_venta,
    proveedor_id: snapshot.proveedor_id,
    unidad: snapshot.unidad,
    unidad_compra: snapshot.unidad_compra,
  };
}

export function precioSucursalUpdateDesdeSnapshot(
  snapshot: PrecioSucursalSnapshot,
): PrecioSucursalUpdate {
  return {
    precio_costo: snapshot.precio_costo,
    precio_venta: snapshot.precio_venta,
    porcentaje_ganancia: snapshot.porcentaje_ganancia,
  };
}
