import { pluEnteroParaBusqueda } from '@/lib/productos/normalizar-plu';
import { normalizarTextoBusqueda } from '@/lib/search/normalize-busqueda';

export type PosCatalogoBusquedaItem = {
  id: string;
  producto_id: string;
  producto_variante_id?: string | null;
  codigo: string;
  codigo_barras?: string | null;
  plu?: string | null;
  nombre: string;
  texto_buscable?: string | null;
  precio_venta: number;
  stock_actual: number;
  stock_minimo?: number | null;
  unidad?: string | null;
  unidad_compra?: string | null;
  contenido_unidad_compra?: number | null;
  es_pesable?: boolean | null;
  usa_variantes?: boolean | null;
  imagen_url?: string | null;
  sucursal_id?: string | null;
  proveedor?: { id: string; nombre: string } | null;
  rubro?: string | null;
  subrubro?: string | null;
  categoria?: { id: string; nombre: string } | null;
  variante?: {
    id: string;
    codigo?: string | null;
    codigo_barras?: string | null;
    atributos?: Record<string, unknown> | null;
    etiqueta?: string | null;
  } | null;
};

export type PosCatalogoBusquedaRankedItem = PosCatalogoBusquedaItem & {
  rank_score: number;
};

export type PosCatalogoSearchOptions = {
  proveedorId?: string | null;
  sucursalId?: string | null;
  limit?: number;
};

const DEFAULT_LIMIT = 40;

export function posCatalogoCacheKey(tenantId: string, sucursalId: string): string {
  return `pos_catalogo:${tenantId}:${sucursalId}`;
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function textoCatalogoNormalizado(item: PosCatalogoBusquedaItem): string {
  const fromApi = cleanText(item.texto_buscable);
  if (fromApi) return normalizarTextoBusqueda(fromApi);

  return normalizarTextoBusqueda(
    [
      item.nombre,
      item.codigo,
      item.codigo_barras,
      item.plu,
      pluEnteroParaBusqueda(item.plu),
      item.proveedor?.nombre,
      item.categoria?.nombre,
      item.rubro,
      item.subrubro,
      item.variante?.codigo,
      item.variante?.codigo_barras,
      item.variante?.etiqueta,
      item.variante?.atributos ? JSON.stringify(item.variante.atributos) : '',
    ]
      .map(cleanText)
      .filter(Boolean)
      .join(' '),
  );
}

function nombreNormalizado(item: PosCatalogoBusquedaItem): string {
  return normalizarTextoBusqueda(item.nombre);
}

function codigoNormalizado(value: unknown): string {
  return normalizarTextoBusqueda(cleanText(value));
}

export function rankPosCatalogoItem(
  item: PosCatalogoBusquedaItem,
  rawQuery: string,
): number | null {
  const raw = cleanText(rawQuery);
  if (raw.length === 0) return null;

  const q = normalizarTextoBusqueda(raw);
  const digits = onlyDigits(raw);
  const qPluEntero = digits ? pluEnteroParaBusqueda(digits) : pluEnteroParaBusqueda(raw);
  const codigo = codigoNormalizado(item.codigo);
  const barcode = codigoNormalizado(item.codigo_barras);
  const plu = codigoNormalizado(item.plu);
  const pluEntero = pluEnteroParaBusqueda(item.plu);
  const nombre = nombreNormalizado(item);
  const texto = textoCatalogoNormalizado(item);

  if (
    digits.length >= 6 &&
    (onlyDigits(cleanText(item.codigo_barras)) === digits ||
      onlyDigits(cleanText(item.codigo)) === digits ||
      pluEntero === qPluEntero)
  ) {
    return 0;
  }
  if (codigo && codigo === q) return 1;
  if (barcode && barcode === q) return 2;
  if (plu && plu === q) return 2;
  if (qPluEntero && pluEntero && pluEntero === qPluEntero) return 2;
  if (codigo && codigo.startsWith(q)) return 3;
  if (barcode && barcode.startsWith(q)) return 3;
  if (plu && plu.startsWith(q)) return 3;
  if (qPluEntero && pluEntero && pluEntero.startsWith(qPluEntero)) return 3;
  if (nombre.startsWith(q)) return 4;
  if (nombre.includes(` ${q}`)) return 5;
  if (texto.includes(q)) return 6;

  return null;
}

function dedupeKey(item: PosCatalogoBusquedaItem): string {
  if (item.producto_variante_id) return `var:${item.producto_id}:${item.producto_variante_id}`;
  return [
    'prod',
    codigoNormalizado(item.codigo),
    cleanText(item.unidad).toLowerCase(),
    nombreNormalizado(item),
    codigoNormalizado(item.proveedor?.id),
    codigoNormalizado(item.codigo_barras),
    codigoNormalizado(item.plu),
  ].join('\0');
}

function pickBetterCatalogItem(
  current: PosCatalogoBusquedaRankedItem,
  candidate: PosCatalogoBusquedaRankedItem,
  sucursalId: string,
): PosCatalogoBusquedaRankedItem {
  if (candidate.rank_score !== current.rank_score) {
    return candidate.rank_score < current.rank_score ? candidate : current;
  }

  const candHome = sucursalId && candidate.id && candidate.sucursal_id === sucursalId;
  const curHome = sucursalId && current.id && current.sucursal_id === sucursalId;
  if (candHome !== curHome) return candHome ? candidate : current;

  const candStock = Number(candidate.stock_actual ?? 0);
  const curStock = Number(current.stock_actual ?? 0);
  if (candStock !== curStock) return candStock > curStock ? candidate : current;

  return candidate.id.localeCompare(current.id) < 0 ? candidate : current;
}

export function buscarEnCatalogoPos(
  items: PosCatalogoBusquedaItem[],
  rawQuery: string,
  options: PosCatalogoSearchOptions = {},
): PosCatalogoBusquedaRankedItem[] {
  const proveedorId = cleanText(options.proveedorId);
  const sucursalId = cleanText(options.sucursalId);
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 200));
  const deduped = new Map<string, PosCatalogoBusquedaRankedItem>();

  for (const item of items) {
    if (proveedorId && item.proveedor?.id !== proveedorId) continue;
    const rank = rankPosCatalogoItem(item, rawQuery);
    if (rank == null) continue;

    const ranked: PosCatalogoBusquedaRankedItem = { ...item, rank_score: rank };
    const key = dedupeKey(item);
    const prev = deduped.get(key);
    deduped.set(key, prev ? pickBetterCatalogItem(prev, ranked, sucursalId) : ranked);
  }

  return [...deduped.values()]
    .sort(
      (a, b) =>
        a.rank_score - b.rank_score ||
        a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }) ||
        cleanText(a.codigo).localeCompare(cleanText(b.codigo), 'es', { sensitivity: 'base' }) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

export function listarCatalogoProveedorPos(
  items: PosCatalogoBusquedaItem[],
  options: PosCatalogoSearchOptions = {},
): PosCatalogoBusquedaItem[] {
  const proveedorId = cleanText(options.proveedorId);
  const sucursalId = cleanText(options.sucursalId);
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 200));
  const deduped = new Map<string, PosCatalogoBusquedaRankedItem>();

  for (const item of items) {
    if (proveedorId && item.proveedor?.id !== proveedorId) continue;
    const ranked: PosCatalogoBusquedaRankedItem = { ...item, rank_score: 10 };
    const key = dedupeKey(item);
    const prev = deduped.get(key);
    deduped.set(key, prev ? pickBetterCatalogItem(prev, ranked, sucursalId) : ranked);
  }

  return [...deduped.values()]
    .sort(
      (a, b) =>
        a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }) ||
        cleanText(a.codigo).localeCompare(cleanText(b.codigo), 'es', { sensitivity: 'base' }) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}
