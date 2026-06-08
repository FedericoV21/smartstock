import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/types/database';

export type ProductoVarianteAtributos = {
  talle?: string | null;
  color?: string | null;
  material?: string | null;
  medida?: string | null;
  [key: string]: string | number | boolean | null | undefined;
};

export type ProductoVarianteResumen = {
  id: string;
  producto_id: string;
  codigo: string | null;
  codigo_barras: string | null;
  atributos: ProductoVarianteAtributos;
  etiqueta: string;
  activo: boolean;
  orden: number;
  stock_actual?: number;
  stock_minimo?: number;
  ubicacion?: string | null;
};

const VARIANTE_KEYS_V1 = ['talle', 'color', 'material', 'medida'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function normalizarAtributosVariante(raw: unknown): ProductoVarianteAtributos {
  if (!isRecord(raw)) return {};
  const out: ProductoVarianteAtributos = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = k.trim();
    if (!key) continue;
    if (v == null) continue;
    if (typeof v === 'string') {
      const s = v.trim();
      if (s) out[key] = s;
      continue;
    }
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

export function etiquetaVariante(
  atributosRaw: unknown,
  etiquetaRaw?: string | null,
): string {
  const etiqueta = typeof etiquetaRaw === 'string' ? etiquetaRaw.trim() : '';
  if (etiqueta) return etiqueta;
  const atributos = normalizarAtributosVariante(atributosRaw);
  const partes = VARIANTE_KEYS_V1
    .map((key) => {
      const value = atributos[key];
      return value == null ? '' : String(value).trim();
    })
    .filter(Boolean);
  if (partes.length > 0) return partes.join(' / ');
  const extras = Object.entries(atributos)
    .filter(([key]) => !(VARIANTE_KEYS_V1 as readonly string[]).includes(key))
    .map(([, value]) => (value == null ? '' : String(value).trim()))
    .filter(Boolean);
  return extras.length > 0 ? extras.join(' / ') : 'Variante';
}

export function etiquetaProductoConVariante(
  productoNombre: string,
  variante?: { atributos?: unknown; etiqueta?: string | null } | null,
): string {
  if (!variante) return productoNombre;
  return `${productoNombre} - ${etiquetaVariante(variante.atributos, variante.etiqueta)}`;
}

export function promoProductoKey(productoId: string): string {
  return productoId;
}

export function promoVarianteKey(productoId: string, varianteId: string | null | undefined): string {
  return varianteId ? `${productoId}::${varianteId}` : promoProductoKey(productoId);
}

type VarianteStockRow = {
  variante_id: string;
  stock_actual: number;
  stock_minimo: number;
  ubicacion: string | null;
};

export async function fetchStockVariantePorIds(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; sucursalId: string; varianteIds: string[] },
): Promise<Map<string, { stock_actual: number; stock_minimo: number; ubicacion: string | null }>> {
  const out = new Map<string, { stock_actual: number; stock_minimo: number; ubicacion: string | null }>();
  const ids = [...new Set(args.varianteIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const { data, error } = await supabase
    .from('producto_variante_stock_sucursal')
    .select('variante_id, stock_actual, stock_minimo, ubicacion')
    .eq('tenant_id', args.tenantId)
    .eq('sucursal_id', args.sucursalId)
    .in('variante_id', ids);

  if (error || !data) return out;
  for (const row of data as unknown as VarianteStockRow[]) {
    out.set(row.variante_id, {
      stock_actual: Number(row.stock_actual),
      stock_minimo: Number(row.stock_minimo),
      ubicacion: row.ubicacion,
    });
  }
  return out;
}

export async function fetchStockTotalVariantesPorProducto(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; sucursalId: string; productoIds: string[] },
): Promise<Map<string, { stock_actual: number; stock_minimo: number }>> {
  const out = new Map<string, { stock_actual: number; stock_minimo: number }>();
  const ids = [...new Set(args.productoIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const { data, error } = await supabase
    .from('producto_variante_stock_sucursal')
    .select('producto_id, stock_actual, stock_minimo')
    .eq('tenant_id', args.tenantId)
    .eq('sucursal_id', args.sucursalId)
    .in('producto_id', ids);

  if (error || !data) return out;
  for (const row of data as unknown as { producto_id: string; stock_actual: number; stock_minimo: number }[]) {
    const cur = out.get(row.producto_id) ?? { stock_actual: 0, stock_minimo: 0 };
    cur.stock_actual += Number(row.stock_actual);
    cur.stock_minimo += Number(row.stock_minimo);
    out.set(row.producto_id, cur);
  }
  return out;
}

export function atributosVarianteToJson(atributos: ProductoVarianteAtributos): Json {
  return atributos as Json;
}
