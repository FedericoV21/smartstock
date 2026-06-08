/**
 * Helper compartido para los flujos que dan de alta o actualizan productos vinculados a un proveedor:
 * importador Excel/CSV, lector de facturas IA, alta manual y POS al vuelo.
 *
 * Centraliza:
 *  - Búsqueda de match cross-proveedor (cuando la pref `unificarProductosEntreProveedores` está activa).
 *  - Regla "el costo solo sube" (cuando `precioCostoSoloSube`).
 *  - Registro de lote por ingreso en `producto_lote_ingreso` (con su vencimiento, costo y proveedor).
 *
 * No reemplaza los upserts existentes; provee primitivas que esos flujos usan.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { BusinessPrefs } from '@/lib/business-prefs/prefs';
import type { Database } from '@/types/database';

type UnidadMedida = Database['public']['Enums']['unidad_medida'];

/** Fila parcial de producto que devuelve la búsqueda; incluye campos clave para decidir update. */
export type ProductoMatch = Pick<
  Database['public']['Tables']['producto']['Row'],
  | 'id'
  | 'sucursal_id'
  | 'codigo'
  | 'codigo_barras'
  | 'nombre'
  | 'precio_costo'
  | 'precio_venta'
  | 'stock_actual'
  | 'porcentaje_ganancia'
  | 'iva_porcentaje'
  | 'activo'
  | 'updated_at'
  | 'unidad'
  | 'unidad_compra'
  | 'contenido_unidad_compra'
  | 'proveedor_id'
>;

/** Normaliza código (tolerando trims y mayúsculas). */
export function normalizarCodigoMatch(codigo: string | null | undefined): string {
  return (codigo ?? '').trim().toLowerCase();
}

/** Normaliza barcode (mismo criterio: trim + lowercase). Devuelve `null` si está vacío. */
export function normalizarBarcodeMatch(barcode: string | null | undefined): string | null {
  const v = (barcode ?? '').trim();
  return v ? v.toLowerCase() : null;
}

/**
 * ¿Pueden estos dos productos considerarse "el mismo SKU" para la pref de unificación?
 * Regla estricta: ambos deben tener `codigo` y `codigo_barras` no vacíos y coincidentes
 * (case insensitive). Si alguno carece de barcode, NO matchean.
 */
export function esMatchEstrictoCodigoBarcode(
  a: { codigo: string | null | undefined; codigo_barras: string | null | undefined },
  b: { codigo: string | null | undefined; codigo_barras: string | null | undefined },
): boolean {
  const ca = normalizarCodigoMatch(a.codigo);
  const cb = normalizarCodigoMatch(b.codigo);
  if (!ca || !cb || ca !== cb) return false;
  const ba = normalizarBarcodeMatch(a.codigo_barras);
  const bb = normalizarBarcodeMatch(b.codigo_barras);
  if (!ba || !bb) return false;
  return ba === bb;
}

const PRODUCTO_MATCH_SELECT =
  'id, sucursal_id, codigo, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, porcentaje_ganancia, iva_porcentaje, activo, updated_at, unidad, unidad_compra, contenido_unidad_compra, proveedor_id';

/**
 * Busca candidatos cross-proveedor para un código dado. Devuelve los productos del tenant
 * que comparten `codigo` (case insensitive). El llamador debe filtrar por barcode con
 * `esMatchEstrictoCodigoBarcode`.
 */
export async function buscarProductosCrossProveedorPorCodigos(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string; sucursalId?: string | null },
  codigos: string[],
): Promise<ProductoMatch[]> {
  const codigosNormalizados = Array.from(
    new Set(codigos.map((c) => c.trim()).filter((c) => c.length > 0)),
  );
  if (codigosNormalizados.length === 0) return [];

  // No filtra por proveedor: la pref unificada matchea aunque vengan de proveedores distintos.
  // Sí acota a la sucursal de catálogo cuando se conoce, para no traer hogares de otras sucursales.
  let q = supabase
    .from('producto')
    .select(PRODUCTO_MATCH_SELECT)
    .eq('tenant_id', ctx.tenantId)
    .in('codigo', codigosNormalizados);

  if (ctx.sucursalId) {
    q = q.eq('sucursal_id', ctx.sucursalId);
  }

  const { data } = await q;
  return (data ?? []) as unknown as ProductoMatch[];
}

/**
 * Aplica la regla "el costo solo sube".
 * - Si `precioCostoSoloSube` es false, devuelve `nuevoCosto` siempre.
 * - Si es true y `nuevoCosto` es null/0/undefined, conserva `costoActual`.
 * - Si es true y `nuevoCosto < costoActual`, conserva `costoActual`.
 */
export function decidirNuevoCosto(
  precioCostoSoloSube: boolean,
  costoActual: number | null | undefined,
  nuevoCosto: number | null | undefined,
): number | null {
  const actual = costoActual == null ? null : Number(costoActual);
  const nuevo = nuevoCosto == null ? null : Number(nuevoCosto);

  if (!precioCostoSoloSube) {
    return nuevo == null || !Number.isFinite(nuevo) ? actual : nuevo;
  }

  if (nuevo == null || !Number.isFinite(nuevo) || nuevo <= 0) {
    return actual;
  }
  if (actual == null || !Number.isFinite(actual)) {
    return nuevo;
  }
  return nuevo > actual ? nuevo : actual;
}

/** Origen del lote (alineado con el CHECK constraint de la tabla). */
export type LoteIngresoOrigen =
  | 'importacion'
  | 'lector_facturas'
  | 'manual'
  | 'pos'
  | 'comprobante_compra';

export type RegistrarLoteIngresoParams = {
  tenantId: string;
  productoId: string;
  sucursalId: string;
  proveedorId?: string | null;
  cantidad: number;
  fechaVencimiento?: string | null;
  precioCosto?: number | null;
  origen: LoteIngresoOrigen;
  importacionLogId?: string | null;
  lectorFacturaLogId?: string | null;
  movimientoId?: string | null;
  creadoPor?: string | null;
};

/**
 * Inserta una fila en `producto_lote_ingreso`. Si la cantidad es 0/negativa y no hay vencimiento,
 * no inserta (no aporta información).
 */
export async function registrarLoteIngreso(
  supabase: SupabaseClient<Database>,
  params: RegistrarLoteIngresoParams,
): Promise<{ id: string | null; error: string | null }> {
  const cantidad = Number(params.cantidad);
  if (!Number.isFinite(cantidad)) {
    return { id: null, error: null };
  }
  if (cantidad <= 0 && !params.fechaVencimiento) {
    return { id: null, error: null };
  }

  const insert: Database['public']['Tables']['producto_lote_ingreso']['Insert'] = {
    tenant_id: params.tenantId,
    producto_id: params.productoId,
    sucursal_id: params.sucursalId,
    proveedor_id: params.proveedorId ?? null,
    cantidad,
    fecha_vencimiento: params.fechaVencimiento ?? null,
    precio_costo: params.precioCosto ?? null,
    origen: params.origen,
    importacion_log_id: params.importacionLogId ?? null,
    lector_factura_log_id: params.lectorFacturaLogId ?? null,
    movimiento_id: params.movimientoId ?? null,
    creado_por: params.creadoPor ?? null,
  };

  const { data, error } = await supabase
    .from('producto_lote_ingreso')
    .insert(insert)
    .select('id')
    .single();

  if (error) {
    return { id: null, error: error.message };
  }
  return { id: (data as { id: string } | null)?.id ?? null, error: null };
}

/** Conveniente para llamadores que sólo quieren saber si la pref está activa. */
export function debeUnificarEntreProveedores(prefs: BusinessPrefs): boolean {
  return prefs.unificarProductosEntreProveedores === true;
}

/**
 * Decide si un match candidato es "cross-proveedor" frente a la fila importada.
 * Verdadero cuando ambos tienen `proveedor_id` no nulo y distinto.
 */
export function esCrossProveedor(
  productoExistente: { proveedor_id: string | null },
  proveedorImport: string | null,
): boolean {
  if (!proveedorImport) return false;
  if (!productoExistente.proveedor_id) return false;
  return productoExistente.proveedor_id !== proveedorImport;
}

/** Re-export por conveniencia. */
export type { UnidadMedida };
