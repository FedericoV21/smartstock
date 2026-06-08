import { calcularPrecioVenta } from '@/lib/productos/calcular-precio-venta';
import type { ProductoNuevoEmitirBorrador } from '@/lib/facturacion/emitir-producto-borrador';
import type { Database } from '@/types/database';

export type UnidadMedidaPos = Database['public']['Enums']['unidad_medida'];

/** Datos del producto nuevo que vive solo en el carrito hasta confirmar el cobro. */
export type ProductoBorradorPos = {
  borrador_id: string;
  codigo_barras: string | null;
  codigo: string;
  nombre: string;
  proveedor_id: string;
  categoria_id: string | null;
  unidad: UnidadMedidaPos;
  precio_costo: number;
  iva_porcentaje: number;
  ganancia_pct: number;
  precio_venta: number;
  stock_inicial: number;
  stock_minimo: number;
  es_pesable: boolean;
  plu: string | null;
  unidad_compra?: UnidadMedidaPos | null;
  contenido_unidad_compra?: number | null;
};

export type ProductoScannedLite = {
  id: string;
  codigo: string;
  codigo_barras?: string | null;
  nombre: string;
  precio_costo?: number | null;
  precio_venta: number;
  porcentaje_ganancia?: number | null;
  ganancia_tramos?: { cantidad_desde: number; ganancia_pct: number }[];
  stock_actual: number;
  es_pesable?: boolean;
  unidad?: string;
  unidad_compra?: string | null;
  contenido_unidad_compra?: number | null;
  iva_porcentaje?: number | null;
  imagen_url?: string | null;
  proveedor?: { id: string; nombre: string } | null;
};

export function itemLineaEsBorrador(it: { borrador?: ProductoBorradorPos | null }): boolean {
  return it.borrador != null;
}

export function productoScannedDesdeBorrador(
  b: ProductoBorradorPos,
  proveedorNombre: string | null,
): ProductoScannedLite {
  return {
    id: b.borrador_id,
    codigo: b.codigo,
    codigo_barras: b.codigo_barras,
    nombre: b.nombre,
    precio_costo: b.precio_costo,
    precio_venta: b.precio_venta,
    porcentaje_ganancia: b.ganancia_pct,
    ganancia_tramos: [],
    stock_actual: b.stock_inicial,
    es_pesable: b.es_pesable,
    unidad: b.unidad,
    unidad_compra: b.unidad_compra ?? null,
    contenido_unidad_compra: b.contenido_unidad_compra ?? null,
    iva_porcentaje: b.iva_porcentaje,
    imagen_url: null,
    proveedor: proveedorNombre
      ? { id: b.proveedor_id, nombre: proveedorNombre }
      : { id: b.proveedor_id, nombre: '—' },
  };
}

export function precioVentaDesdeCostoGananciaIva(
  costoNeto: number,
  gananciaPct: number,
  ivaPct: number,
  ivaDefaultTenant: number,
  redondearPreciosCentenas: boolean,
  redondearMenores100ADecenas: boolean = false,
): number {
  return calcularPrecioVenta(costoNeto, gananciaPct, ivaPct, ivaDefaultTenant, {
    redondearPreciosCentenas,
    redondearMenores100ADecenas,
  });
}

export function borradorToProductoNuevoEmitir(b: ProductoBorradorPos): ProductoNuevoEmitirBorrador {
  return {
    borrador_id: b.borrador_id,
    codigo_barras: b.codigo_barras,
    codigo: b.codigo,
    nombre: b.nombre,
    proveedor_id: b.proveedor_id,
    categoria_id: b.categoria_id,
    unidad: b.unidad,
    precio_costo: b.precio_costo,
    iva_porcentaje: b.iva_porcentaje,
    ganancia_pct: b.ganancia_pct,
    precio_venta: b.precio_venta,
    stock_inicial: b.stock_inicial,
    stock_minimo: b.stock_minimo,
    es_pesable: b.es_pesable,
    plu: b.plu,
    unidad_compra: b.unidad_compra ?? null,
    contenido_unidad_compra: b.contenido_unidad_compra ?? null,
  };
}
