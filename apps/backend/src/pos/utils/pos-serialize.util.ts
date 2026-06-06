import type { Categoria } from '../../catalog/entities/categoria.entity';
import type { Proveedor } from '../../catalog/entities/proveedor.entity';
import type { Producto } from '../../products/entities/producto.entity';
import type { ProductoVariante } from '../../products/entities/producto-variante.entity';

export type PosProductoPayload = {
  id: string;
  codigo: string;
  nombre: string;
  precio_costo: number;
  precio_venta: number;
  porcentaje_ganancia: number | null;
  stock_actual: number;
  stock_minimo: number;
  unidad: string;
  unidad_compra: string | null;
  contenido_unidad_compra: number | null;
  es_pesable: boolean;
  codigo_barras: string | null;
  plu: string | null;
  usa_variantes: boolean;
  iva_porcentaje: number | null;
  imagen_url: string | null;
  sucursal_id: string | null;
  rubro: string | null;
  subrubro: string | null;
  categoria: { id: string; nombre: string } | null;
  proveedor: { id: string; nombre: string } | null;
  producto_variante_id?: string | null;
  variante?: {
    id: string;
    codigo: string | null;
    codigo_barras: string | null;
    atributos: Record<string, unknown> | null;
    etiqueta: string | null;
  } | null;
  variantes?: Array<{
    id: string;
    codigo: string | null;
    codigo_barras: string | null;
    atributos: Record<string, unknown>;
    etiqueta: string;
    activo: boolean;
    orden: number;
    stock_actual: number;
    stock_minimo: number;
    ubicacion: string | null;
  }>;
};

export type PosRefNombre = { id: string; nombre: string };

export function serializePosProducto(
  p: Producto,
  opts: {
    precioCosto?: number;
    precioVenta?: number;
    porcentajeGanancia?: number | null;
    stockActual?: number;
    stockMinimo?: number;
    categoria?: Categoria | PosRefNombre | null;
    proveedor?: Proveedor | PosRefNombre | null;
    productoVarianteId?: string | null;
    variante?: PosProductoPayload['variante'];
    variantes?: PosProductoPayload['variantes'];
    nombreOverride?: string;
    codigoOverride?: string | null;
    codigoBarrasOverride?: string | null;
  } = {},
): PosProductoPayload {
  return {
    id: p.id,
    codigo: opts.codigoOverride ?? p.codigo,
    nombre: opts.nombreOverride ?? p.nombre,
    precio_costo: opts.precioCosto ?? Number(p.precioCosto),
    precio_venta: opts.precioVenta ?? Number(p.precioVenta),
    porcentaje_ganancia:
      opts.porcentajeGanancia !== undefined
        ? opts.porcentajeGanancia
        : p.porcentajeGanancia != null
          ? Number(p.porcentajeGanancia)
          : null,
    stock_actual: opts.stockActual ?? Number(p.stockActual),
    stock_minimo: opts.stockMinimo ?? Number(p.stockMinimo),
    unidad: p.unidad,
    unidad_compra: null,
    contenido_unidad_compra: null,
    es_pesable: p.esPesable,
    codigo_barras: opts.codigoBarrasOverride ?? p.codigoBarras,
    plu: p.plu,
    usa_variantes: p.usaVariantes,
    iva_porcentaje: p.ivaPorcentaje != null ? Number(p.ivaPorcentaje) : null,
    imagen_url: p.imagenUrl,
    sucursal_id: p.sucursalId,
    rubro: null,
    subrubro: null,
    categoria: opts.categoria ? { id: opts.categoria.id, nombre: opts.categoria.nombre } : null,
    proveedor: opts.proveedor ? { id: opts.proveedor.id, nombre: opts.proveedor.nombre } : null,
    producto_variante_id: opts.productoVarianteId ?? null,
    variante: opts.variante ?? null,
    variantes: opts.variantes,
  };
}

export function mapCatalogoBusquedaItem(
  row: PosProductoPayload,
): Record<string, unknown> {
  return {
    id: row.id,
    producto_id: row.id,
    producto_variante_id: row.producto_variante_id ?? null,
    codigo: row.codigo,
    codigo_barras: row.codigo_barras,
    plu: row.plu,
    nombre: row.nombre,
    texto_buscable: [row.codigo, row.nombre, row.codigo_barras, row.plu].filter(Boolean).join(' '),
    precio_venta: row.precio_venta,
    stock_actual: row.stock_actual,
    stock_minimo: row.stock_minimo,
    unidad: row.unidad,
    unidad_compra: row.unidad_compra,
    contenido_unidad_compra: row.contenido_unidad_compra,
    es_pesable: row.es_pesable,
    usa_variantes: row.usa_variantes,
    imagen_url: row.imagen_url,
    sucursal_id: row.sucursal_id,
    proveedor: row.proveedor,
    categoria: row.categoria,
    rubro: row.rubro,
    subrubro: row.subrubro,
    variante: row.variante ?? null,
  };
}

export function etiquetaVariantePos(
  atributos: Record<string, unknown> | null | undefined,
  etiqueta: string | null | undefined,
): string {
  const e = typeof etiqueta === 'string' ? etiqueta.trim() : '';
  if (e) return e;
  const attrs = atributos ?? {};
  const parts = ['talle', 'color', 'material', 'medida']
    .map((k) => {
      const v = attrs[k];
      return v == null ? '' : String(v).trim();
    })
    .filter(Boolean);
  return parts.join(' / ') || 'Variante';
}

export function attachVariantesList(
  producto: PosProductoPayload,
  variantes: ProductoVariante[],
  stockPorVariante: Map<string, { stock_actual: number; stock_minimo: number; ubicacion: string | null }>,
): PosProductoPayload {
  if (!producto.usa_variantes || variantes.length === 0) return producto;
  return {
    ...producto,
    variantes: variantes.map((v) => {
      const st = stockPorVariante.get(v.id);
      return {
        id: v.id,
        codigo: v.codigo,
        codigo_barras: v.codigoBarras,
        atributos: v.atributos,
        etiqueta: etiquetaVariantePos(v.atributos, v.etiqueta),
        activo: v.activo,
        orden: v.orden,
        stock_actual: st?.stock_actual ?? 0,
        stock_minimo: st?.stock_minimo ?? 0,
        ubicacion: st?.ubicacion ?? null,
      };
    }),
  };
}
