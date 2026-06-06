import { parsearPorcentajeLista } from './parse-porcentaje-lista.util';

export interface ProductoRawIa {
  codigo?: unknown;
  nombre?: unknown;
  precio?: unknown;
  precio_costo?: unknown;
  precio_venta?: unknown;
  descuento_costo_pct?: unknown;
  unidad?: unknown;
  stock_actual?: unknown;
  stock?: unknown;
  categoria?: unknown;
}

export interface ProductoNormalizadoIa {
  codigo: string | null;
  nombre: string;
  precioVenta: number | null;
  precioCosto: number | null;
  descuentoCostoPct: number | null;
  stockActual: number | null;
  unidad: string | null;
  categoria: string | null;
}

function numeroNoNegativo(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  return null;
}

function stockEnteroONull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.round(v);
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export function normalizarProductoDesdeIa(p: ProductoRawIa): ProductoNormalizadoIa | null {
  if (!p || typeof p.nombre !== 'string' || p.nombre.trim() === '') return null;

  let precioVenta = numeroNoNegativo(p.precio_venta);
  const precioCosto = numeroNoNegativo(p.precio_costo);
  const precioLegacy = numeroNoNegativo(p.precio);
  if (precioVenta == null && precioLegacy != null) precioVenta = precioLegacy;

  const categoriaRaw = p.categoria;
  const categoria =
    categoriaRaw != null && String(categoriaRaw).trim() !== '' ? String(categoriaRaw).trim() : null;

  const stockRaw = p.stock_actual ?? p.stock;
  const pct = parsearPorcentajeLista(p.descuento_costo_pct);
  const descuentoCostoPct = pct != null && pct >= 0 && pct <= 100 ? pct : null;

  return {
    codigo: p.codigo != null ? String(p.codigo).trim() || null : null,
    nombre: String(p.nombre).trim(),
    precioVenta,
    precioCosto,
    descuentoCostoPct,
    stockActual: stockEnteroONull(stockRaw),
    unidad: p.unidad != null ? String(p.unidad).trim() || null : null,
    categoria,
  };
}
