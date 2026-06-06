import { createHash } from 'crypto';

import { PrecioSucursal } from '../../branches/entities/precio-sucursal.entity';
import { Producto } from '../../products/entities/producto.entity';

export type ProductoImportSnapshot = {
  id: string;
  tenant_id: string;
  sucursal_id: string | null;
  codigo: string;
  codigo_barras: string | null;
  nombre: string;
  descripcion: string | null;
  categoria_id: string | null;
  proveedor_id: string | null;
  unidad: string;
  es_pesable: boolean;
  precio_costo: number;
  precio_venta: number;
  stock_actual: number;
  stock_minimo: number;
  fecha_vencimiento: string | null;
  plu: string | null;
  iva_porcentaje: number | null;
  porcentaje_ganancia: number | null;
  descuento_costo_pct: number | null;
  usa_variantes: boolean;
  activo: boolean;
};

export type PrecioSucursalSnapshot = {
  id: string;
  producto_id: string;
  sucursal_id: string;
  precio_costo: number | null;
  precio_venta: number | null;
  porcentaje_ganancia: number | null;
};

function num(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numReq(value: string | number | null | undefined): number {
  return num(value) ?? 0;
}

export function snapshotProductoImport(producto: Producto): ProductoImportSnapshot {
  return {
    id: producto.id,
    tenant_id: producto.tenantId,
    sucursal_id: producto.sucursalId,
    codigo: producto.codigo,
    codigo_barras: producto.codigoBarras,
    nombre: producto.nombre,
    descripcion: producto.descripcion,
    categoria_id: producto.categoriaId,
    proveedor_id: producto.proveedorId,
    unidad: producto.unidad,
    es_pesable: producto.esPesable,
    precio_costo: numReq(producto.precioCosto),
    precio_venta: numReq(producto.precioVenta),
    stock_actual: numReq(producto.stockActual),
    stock_minimo: numReq(producto.stockMinimo),
    fecha_vencimiento: producto.fechaVencimiento,
    plu: producto.plu,
    iva_porcentaje: num(producto.ivaPorcentaje),
    porcentaje_ganancia: num(producto.porcentajeGanancia),
    descuento_costo_pct: num(producto.descuentoCostoPct),
    usa_variantes: producto.usaVariantes,
    activo: producto.activo,
  };
}

export function snapshotPreciosSucursal(rows: PrecioSucursal[]): PrecioSucursalSnapshot[] {
  return rows.map((row) => ({
    id: row.id,
    producto_id: row.productoId,
    sucursal_id: row.sucursalId,
    precio_costo: num(row.precioCosto),
    precio_venta: num(row.precioVenta),
    porcentaje_ganancia: num(row.porcentajeGanancia),
  }));
}

export function asProductoImportSnapshot(value: unknown): ProductoImportSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Partial<ProductoImportSnapshot>;
  if (
    typeof row.id !== 'string' ||
    typeof row.tenant_id !== 'string' ||
    typeof row.codigo !== 'string' ||
    typeof row.nombre !== 'string' ||
    typeof row.unidad !== 'string'
  ) {
    return null;
  }
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    sucursal_id: row.sucursal_id ?? null,
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
    iva_porcentaje: num(row.iva_porcentaje),
    porcentaje_ganancia: num(row.porcentaje_ganancia),
    descuento_costo_pct: num(row.descuento_costo_pct),
    usa_variantes: Boolean(row.usa_variantes),
    activo: Boolean(row.activo),
  };
}

export function asPrecioSucursalSnapshots(value: unknown): PrecioSucursalSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is PrecioSucursalSnapshot => {
    if (!row || typeof row !== 'object') return false;
    const r = row as Partial<PrecioSucursalSnapshot>;
    return typeof r.id === 'string' && typeof r.sucursal_id === 'string';
  });
}

export function productoUpdateFromSnapshot(snapshot: ProductoImportSnapshot): Partial<Producto> {
  return {
    activo: snapshot.activo,
    categoriaId: snapshot.categoria_id,
    codigo: snapshot.codigo,
    codigoBarras: snapshot.codigo_barras,
    descripcion: snapshot.descripcion,
    descuentoCostoPct:
      snapshot.descuento_costo_pct == null ? null : String(snapshot.descuento_costo_pct),
    esPesable: snapshot.es_pesable,
    fechaVencimiento: snapshot.fecha_vencimiento,
    ivaPorcentaje: snapshot.iva_porcentaje == null ? null : String(snapshot.iva_porcentaje),
    nombre: snapshot.nombre,
    plu: snapshot.plu,
    porcentajeGanancia:
      snapshot.porcentaje_ganancia == null ? null : String(snapshot.porcentaje_ganancia),
    precioCosto: snapshot.precio_costo.toFixed(2),
    precioVenta: snapshot.precio_venta.toFixed(2),
    proveedorId: snapshot.proveedor_id,
    stockActual: snapshot.stock_actual.toFixed(3),
    stockMinimo: snapshot.stock_minimo.toFixed(3),
    sucursalId: snapshot.sucursal_id,
    unidad: snapshot.unidad as Producto['unidad'],
    usaVariantes: snapshot.usa_variantes,
  };
}

export function resumenReversionHash(resumen: unknown): string {
  return createHash('sha256').update(JSON.stringify(resumen)).digest('hex');
}
