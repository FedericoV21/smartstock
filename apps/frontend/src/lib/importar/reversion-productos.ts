import type { SupabaseClient } from '@supabase/supabase-js';

import { hashSnapshot, snapshotPreciosSucursal, type PrecioSucursalSnapshot } from '@/lib/lector-facturas/snapshots-reversion';
import type { Database, Json } from '@/types/database';

type ProductoRow = Database['public']['Tables']['producto']['Row'];
type ProductoUpdate = Database['public']['Tables']['producto']['Update'];

export const PRODUCTO_IMPORT_SNAPSHOT_SELECT =
  'id, tenant_id, sucursal_id, codigo, codigo_barras, nombre, descripcion, categoria_id, proveedor_id, unidad, es_pesable, precio_costo, precio_venta, stock_actual, stock_minimo, fecha_vencimiento, plu, rubro, subrubro, iva_porcentaje, porcentaje_ganancia, descuento_costo_pct, ubicacion, moneda, unidad_compra, contenido_unidad_compra, usa_variantes, activo';

export const PRECIO_SUCURSAL_IMPORT_SNAPSHOT_SELECT =
  'id, producto_id, precio_costo, precio_venta, porcentaje_ganancia, sucursal_id';

export type ProductoImportSnapshot = Pick<
  ProductoRow,
  | 'id'
  | 'tenant_id'
  | 'sucursal_id'
  | 'codigo'
  | 'codigo_barras'
  | 'nombre'
  | 'descripcion'
  | 'categoria_id'
  | 'proveedor_id'
  | 'unidad'
  | 'es_pesable'
  | 'precio_costo'
  | 'precio_venta'
  | 'stock_actual'
  | 'stock_minimo'
  | 'fecha_vencimiento'
  | 'plu'
  | 'rubro'
  | 'subrubro'
  | 'iva_porcentaje'
  | 'porcentaje_ganancia'
  | 'descuento_costo_pct'
  | 'ubicacion'
  | 'moneda'
  | 'unidad_compra'
  | 'contenido_unidad_compra'
  | 'usa_variantes'
  | 'activo'
>;

type ProductoSnapshotSource = ProductoImportSnapshot | (Partial<ProductoImportSnapshot> & {
  id: string;
  tenant_id: string;
  sucursal_id: string;
  codigo: string;
  nombre: string;
  unidad: ProductoRow['unidad'];
});

function num(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numReq(value: number | string | null | undefined): number {
  return num(value) ?? 0;
}

export function snapshotProductoImport(row: ProductoSnapshotSource): ProductoImportSnapshot {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    sucursal_id: row.sucursal_id,
    codigo: row.codigo,
    codigo_barras: row.codigo_barras ?? null,
    nombre: row.nombre,
    descripcion: row.descripcion ?? null,
    categoria_id: row.categoria_id ?? null,
    proveedor_id: row.proveedor_id ?? null,
    unidad: row.unidad,
    es_pesable: Boolean(row.es_pesable),
    precio_costo: numReq(row.precio_costo),
    precio_venta: numReq(row.precio_venta),
    stock_actual: numReq(row.stock_actual),
    stock_minimo: numReq(row.stock_minimo),
    fecha_vencimiento: row.fecha_vencimiento ?? null,
    plu: row.plu ?? null,
    rubro: row.rubro ?? null,
    subrubro: row.subrubro ?? null,
    iva_porcentaje: num(row.iva_porcentaje),
    porcentaje_ganancia: num(row.porcentaje_ganancia),
    descuento_costo_pct: num(row.descuento_costo_pct),
    ubicacion: row.ubicacion ?? null,
    moneda: row.moneda ?? '$',
    unidad_compra: row.unidad_compra ?? null,
    contenido_unidad_compra: num(row.contenido_unidad_compra),
    usa_variantes: Boolean(row.usa_variantes),
    activo: Boolean(row.activo),
  };
}

export function productoUpdateDesdeSnapshotImport(snapshot: ProductoImportSnapshot): ProductoUpdate {
  return {
    activo: snapshot.activo,
    categoria_id: snapshot.categoria_id,
    codigo: snapshot.codigo,
    codigo_barras: snapshot.codigo_barras,
    descripcion: snapshot.descripcion,
    descuento_costo_pct: snapshot.descuento_costo_pct,
    es_pesable: snapshot.es_pesable,
    fecha_vencimiento: snapshot.fecha_vencimiento,
    iva_porcentaje: snapshot.iva_porcentaje,
    moneda: snapshot.moneda,
    nombre: snapshot.nombre,
    plu: snapshot.plu,
    porcentaje_ganancia: snapshot.porcentaje_ganancia,
    precio_costo: snapshot.precio_costo,
    precio_venta: snapshot.precio_venta,
    proveedor_id: snapshot.proveedor_id,
    rubro: snapshot.rubro,
    stock_actual: snapshot.stock_actual,
    stock_minimo: snapshot.stock_minimo,
    subrubro: snapshot.subrubro,
    sucursal_id: snapshot.sucursal_id,
    ubicacion: snapshot.ubicacion,
    unidad: snapshot.unidad,
    unidad_compra: snapshot.unidad_compra,
    contenido_unidad_compra: snapshot.contenido_unidad_compra,
    usa_variantes: snapshot.usa_variantes,
  };
}

export function asProductoImportSnapshot(value: unknown): ProductoImportSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<ProductoImportSnapshot>;
  if (
    typeof row.id !== 'string' ||
    typeof row.tenant_id !== 'string' ||
    typeof row.sucursal_id !== 'string' ||
    typeof row.codigo !== 'string' ||
    typeof row.nombre !== 'string' ||
    typeof row.unidad !== 'string'
  ) {
    return null;
  }
  return snapshotProductoImport(row as ProductoSnapshotSource);
}

export function asPrecioSucursalSnapshots(value: unknown): PrecioSucursalSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is PrecioSucursalSnapshot => {
    if (!row || typeof row !== 'object') return false;
    const r = row as Partial<PrecioSucursalSnapshot>;
    return typeof r.id === 'string' && typeof r.sucursal_id === 'string';
  });
}

export async function obtenerProductoImportSnapshot(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  productoId: string,
): Promise<ProductoImportSnapshot | null> {
  const { data, error } = await supabase
    .from('producto')
    .select(PRODUCTO_IMPORT_SNAPSHOT_SELECT)
    .eq('tenant_id', tenantId)
    .eq('id', productoId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data ? snapshotProductoImport(data as ProductoSnapshotSource) : null;
}

export async function obtenerPreciosSucursalImportSnapshot(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  productoId: string,
): Promise<PrecioSucursalSnapshot[]> {
  const { data, error } = await supabase
    .from('precio_sucursal')
    .select(PRECIO_SUCURSAL_IMPORT_SNAPSHOT_SELECT)
    .eq('tenant_id', tenantId)
    .eq('producto_id', productoId);

  if (error) {
    throw new Error(error.message);
  }
  return snapshotPreciosSucursal(data ?? []);
}

export async function registrarSnapshotImportacionProducto(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string;
    importacionLogId: string | null;
    productoId: string;
    accion: 'created' | 'updated';
    filaOriginal: number;
    productoBefore: ProductoImportSnapshot | null;
    productoAfter: ProductoImportSnapshot;
    precioSucursalBefore?: PrecioSucursalSnapshot[];
    precioSucursalAfter?: PrecioSucursalSnapshot[];
    movimientoId?: string | null;
    productoVarianteId?: string | null;
  },
): Promise<void> {
  if (!args.importacionLogId) return;

  const { error } = await supabase.from('importacion_producto_snapshot').insert({
    tenant_id: args.tenantId,
    importacion_log_id: args.importacionLogId,
    producto_id: args.productoId,
    accion: args.accion,
    fila_original: args.filaOriginal,
    producto_before: args.productoBefore as unknown as Json,
    producto_after: args.productoAfter as unknown as Json,
    precio_sucursal_before: (args.precioSucursalBefore ?? []) as unknown as Json,
    precio_sucursal_after: (args.precioSucursalAfter ?? []) as unknown as Json,
    movimiento_id: args.movimientoId ?? null,
    producto_variante_id: args.productoVarianteId ?? null,
  });

  if (error) {
    if (
      error.message.includes('importacion_producto_snapshot') &&
      error.message.includes('schema cache')
    ) {
      return;
    }
    console.error('[importar/reversion] snapshot:', error.message);
  }
}

export function resumenReversionHash(resumen: unknown): string {
  return hashSnapshot(resumen);
}
