import type { Database } from '@/types/database';

export type UnidadMedida = Database['public']['Enums']['unidad_medida'];

const UNIDADES_VALIDAS: UnidadMedida[] = [
  'unidad',
  'kg',
  'litro',
  'metro',
  'caja',
  'pack',
  'gramo',
  'ml',
];

function mapUnidad(s: string | null | undefined): UnidadMedida {
  const v = (s ?? 'unidad').toLowerCase().trim();
  return UNIDADES_VALIDAS.includes(v as UnidadMedida) ? (v as UnidadMedida) : 'unidad';
}

function inferirUnidadStockDesdeGlosa(glosa: string | null | undefined): UnidadMedida | null {
  const t = String(glosa ?? '').toLowerCase().trim();
  if (!t) return null;
  if (/\bkg\b|kilo?s?\b/.test(t)) return 'kg';
  if (/\b(?:gr|g)\b|gramo?s?\b/.test(t)) return 'gramo';
  if (/\bml\b/.test(t)) return 'ml';
  if (/\blitro?s?\b|\blts?\b|\blt\b/.test(t)) return 'litro';
  if (/\bmetro?s?\b|\bmts?\b|\bmt\b/.test(t)) return 'metro';
  if (/\bunidad(?:es)?\b|\bunid(?:ad)?(?:es)?\b|\bund\.?\b|\bu\.?\b/.test(t)) return 'unidad';
  if (/\bcaja\b|\bpack\b|\bbulto\b|\bblister\b|\bdisplay\b/.test(t)) return 'unidad';
  return null;
}

/**
 * Heurísticas conservadoras: solo señales con `x`, `×` o `por` + unidades de masa.
 * Evita marcar pesable por menciones sueltas tipo "500 gr" del paquete sin conector pedido.
 */
export function inferirUnidadVentasPesoDesdeTexto(textoRaw: string | null | undefined): UnidadMedida | null {
  const t = String(textoRaw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 2) return null;

  const lower = t.toLowerCase().replace(/\u00d7/g, 'x');

  const xOuPorKg =
    /\bpor\s+(?:el\s+)?(?:kilos?|kg)\b/.test(lower) ||
    /\bx\s*kg\b/.test(lower) ||
    /\bx\s*[0-9]+(?:[.,][0-9]+)?\s*(?:kg|kilos?)\b/.test(lower);

  if (xOuPorKg) return 'kg';

  const porGr =
    /\bpor\s+[0-9]+(?:[.,][0-9]+)?\s*(?:gramos?|gr|g)\b/.test(lower) ||
    /\bx\s*[0-9]+(?:[.,][0-9]+)?\s*(?:gramos?|gr|g)\b/.test(lower);

  if (porGr) return 'gramo';

  return null;
}

export function esUnidadMedidaPesable(u: UnidadMedida): boolean {
  return u === 'kg' || u === 'gramo';
}

/** Misma combinación que presentación de compra: nombre + glosa opcional de columna Unidad */
function textoComboFilaImport(fila: { nombre: string; unidad?: string | null }): string {
  const nombre = fila.nombre.trim();
  const g = typeof fila.unidad === 'string' ? fila.unidad.trim() : '';
  if (!g.length) return nombre;
  return `${nombre} · ${g}`;
}

export type ResolverUnidadStockImportOpts = {
  /**
   * Si es `true`, ignora la unidad de la fila y fuerza stock pesable en kg.
   * Se usa solo cuando el usuario lo elige explicitamente en el importador.
   */
  forzarProductosPesables?: boolean;
  /**
   * Si es `true`, se aplican patrones en nombre/glosa (x kg, por kilo, etc.) para `kg`/`gramo`.
   * En importación solo debe ser `true` cuando el usuario lo elige explícitamente en el preview.
   */
  aplicarInferenciaPesablePorNombre?: boolean;
};

/**
 * Prioridad: forzado a pesable > unidad válida como enum desde columna > inferencia desde glosa de columna
 * > (opcional) patrones nombre+combo peso conservador > fallback (p. ej. `unidad` o unidad previa DB).
 */
export function resolverUnidadStockImportacion(
  fila: { nombre: string; unidad?: string | null },
  fallback: UnidadMedida = 'unidad',
  opts?: ResolverUnidadStockImportOpts,
): UnidadMedida {
  if (opts?.forzarProductosPesables === true) return 'kg';

  const directo = mapUnidad(fila.unidad);
  if (
    typeof fila.unidad === 'string' &&
    fila.unidad.trim() !== '' &&
    UNIDADES_VALIDAS.includes(fila.unidad.toLowerCase().trim() as UnidadMedida)
  ) {
    return directo;
  }
  const desdeGlosa = inferirUnidadStockDesdeGlosa(fila.unidad ?? null);
  if (desdeGlosa) return desdeGlosa;
  if (opts?.aplicarInferenciaPesablePorNombre === true) {
    const desdeNombre = inferirUnidadVentasPesoDesdeTexto(textoComboFilaImport(fila));
    if (desdeNombre) return desdeNombre;
  }
  return fallback;
}
