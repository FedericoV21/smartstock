import { calcularCheckDigitEAN13, validarEAN13 } from '@/lib/pos/ean13';
import { promocionVigenteParaYmd, fechaLocalYmd } from '@/lib/facturacion/promociones';
import { normalizarPlu5, pluEnteroParaBusqueda } from '@/lib/productos/normalizar-plu';
import type { PromocionMotor } from '@/types/promociones';

/**
 * Orden de columnas para importación automática Qendra / balanza Systel Max.
 * Sin encabezados; delimitador `;`.
 */
export const ORDEN_COLUMNAS_QENDRA_BALANZA = [
  'Sección',
  'Código de PLU',
  'Descripción',
  'Número de PLU',
  'Precio Lista 1',
  'Precio Lista 2',
  'Tipo de venta',
  'Vencimiento',
  'Ingredientes',
] as const;

export type ProductoQendraBalanzaInput = {
  plu: string | null;
  nombre: string;
  precio_venta: number;
  /** Nombre de categoría / sección en balanza. */
  sector: string;
  es_pesable?: boolean;
  unidad?: string;
  fecha_vencimiento?: string | null;
  /** Texto libre (p. ej. descripción del producto) → columna Ingredientes. */
  ingredientes?: string | null;
  /** % de descuento vigente (promo u otro); se aplica al Precio Lista 2. */
  descuento_pct?: number | null;
};

/** Filtro de elegibilidad para export Qendra (debe coincidir con la API). */
export function productoEsExportableQendraBalanza(p: {
  plu: string | null;
  es_pesable: boolean;
  unidad: string;
}): boolean {
  if (!(p.plu ?? '').trim()) return false;
  if (p.es_pesable) return true;
  return p.unidad === 'unidad';
}

/** `p` = peso (balanza por kg); `u` = unidad (PLU por piezas). */
export function tipoVentaQendraProducto(
  es_pesable: boolean | undefined,
  unidad?: string,
): 'p' | 'u' {
  if (unidad === 'unidad') return 'u';
  if (es_pesable === true) return 'p';
  return 'u';
}

function escapeCampoQendra(v: string): string {
  const s = v.replace(/\r?\n/g, ' ').trim();
  if (/[;"]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Precio con coma decimal (formato Qendra: 7500,00). */
export function formatPrecioQendra(precio: number): string {
  const n = Number.isFinite(precio) ? precio : 0;
  return n.toFixed(2).replace('.', ',');
}

/**
 * Precio Lista 2: precio con descuento si hay % vigente; si no, `0,00`.
 */
export function precioLista2Qendra(
  precioLista1: number,
  descuentoPct?: number | null,
): string {
  const pct = descuentoPct != null ? Number(descuentoPct) : NaN;
  if (Number.isFinite(pct) && pct > 0 && pct < 100) {
    return formatPrecioQendra(precioLista1 * (1 - pct / 100));
  }
  return '0,00';
}

/** PLU numérico sin ceros a la izquierda (ej. 00005 → 5, 00001 → 1). */
export function pluParaExportQendra(plu: string | null): string {
  return pluEnteroParaBusqueda(plu);
}

/**
 * Vencimiento para Qendra: `0` sin fecha; si hay fecha, días hasta el vencimiento (mín. 1).
 */
export function vencimientoQendraExport(
  fechaVencimiento: string | null | undefined,
  hoyYmd?: string,
): string {
  const raw = (fechaVencimiento ?? '').trim();
  if (!raw) return '0';
  const ymd = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '0';
  const hoy = hoyYmd ?? fechaLocalYmd(new Date());
  const dias = diasEntreYmdUtc(hoy, ymd);
  if (dias <= 0) return '0';
  return String(dias);
}

function diasEntreYmdUtc(desde: string, hasta: string): number {
  const [y0, m0, d0] = desde.split('-').map(Number);
  const [y1, m1, d1] = hasta.split('-').map(Number);
  const t0 = Date.UTC(y0, m0 - 1, d0);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  return Math.round((t1 - t0) / 86_400_000);
}

/**
 * EAN-13 de catálogo para pesables: prefijo 20 + PLU (5) + peso 00000 + verificador.
 * Si el producto ya tiene un EAN-13 válido que empieza en 2, se reutiliza.
 */
export function codigoBarrasCatalogoPesable(
  plu: string | null,
  codigoBarras?: string | null,
): string {
  const cb = (codigoBarras ?? '').replace(/\D/g, '');
  if (cb.length === 13 && cb[0] === '2' && validarEAN13(cb)) {
    return cb;
  }
  const plu5 = normalizarPlu5(plu);
  if (!plu5) return '';
  const base12 = `20${plu5}00000`;
  return base12 + calcularCheckDigitEAN13(base12);
}

export function truncarDescripcionBalanza(nombre: string, max = 40): string {
  const t = nombre.trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
}

/** Una fila CSV en el orden exigido por Qendra (9 columnas). */
export function productoAFilaQendraBalanza(p: ProductoQendraBalanzaInput): string[] {
  const plu = pluParaExportQendra(p.plu);
  const precioLista1 = p.precio_venta;
  return [
    p.sector.trim(),
    plu,
    truncarDescripcionBalanza(p.nombre),
    plu,
    formatPrecioQendra(precioLista1),
    precioLista2Qendra(precioLista1, p.descuento_pct),
    tipoVentaQendraProducto(p.es_pesable, p.unidad),
    vencimientoQendraExport(p.fecha_vencimiento),
    (p.ingredientes ?? '').trim(),
  ];
}

/** CSV UTF-8 (BOM) sin encabezados, delimitador `;`, CRLF. */
export function filasQendraBalanzaACsv(filas: string[][]): string {
  const lines = filas.map((row) => row.map((c) => escapeCampoQendra(c ?? '')).join(';'));
  return `\uFEFF${lines.join('\r\n')}`;
}

export function dedupeProductosPorId<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

type PromoEmbed = {
  activa: boolean;
  tipo: string;
  porcentaje: number | null;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  dias_semana: number[] | null;
};

/** Mejor % off vigente por producto (promos `porcentaje_off` activas hoy). */
export async function descuentosPromoPorProductoIds(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerClient>>,
  productoIds: string[],
  fechaYmd?: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (productoIds.length === 0) return out;

  const hoy = fechaYmd ?? fechaLocalYmd(new Date());
  const CHUNK = 200;

  for (let i = 0; i < productoIds.length; i += CHUNK) {
    const lote = productoIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('producto_promocion')
      .select(
        'producto_id, promocion:promocion_id(activa, tipo, porcentaje, vigente_desde, vigente_hasta, dias_semana)',
      )
      .in('producto_id', lote);

    if (error) {
      console.error('[export-qendra-balanza] promociones', error.message);
      continue;
    }

    for (const row of data ?? []) {
      const productoId = row.producto_id as string;
      const embed = row.promocion as PromoEmbed | PromoEmbed[] | null;
      const promo = Array.isArray(embed) ? embed[0] : embed;
      if (!promo || promo.tipo !== 'porcentaje_off' || !promo.activa) continue;

      const motor: PromocionMotor = {
        id: '',
        nombre: '',
        tipo: 'porcentaje_off',
        activa: promo.activa,
        porcentaje: promo.porcentaje,
        vigente_desde: promo.vigente_desde,
        vigente_hasta: promo.vigente_hasta,
        dias_semana: promo.dias_semana,
        cantidad_lleva: null,
        cantidad_paga: null,
        unidad_descuento: null,
        cantidad_minima: null,
        rangos_volumen: null,
        precio_combo: null,
        combo_items: null,
      };

      if (!promocionVigenteParaYmd(motor, hoy)) continue;

      const pct = Number(promo.porcentaje ?? 0);
      if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) continue;

      const prev = out.get(productoId) ?? 0;
      if (pct > prev) out.set(productoId, pct);
    }
  }

  return out;
}
