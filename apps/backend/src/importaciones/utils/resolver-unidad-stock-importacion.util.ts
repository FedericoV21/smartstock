import { UnidadMedida } from '../../products/enums/unidad-medida.enum';

const UNIDADES_VALIDAS = Object.values(UnidadMedida);

function mapUnidad(s: string | null | undefined): UnidadMedida {
  const v = (s ?? 'unidad').toLowerCase().trim();
  return UNIDADES_VALIDAS.includes(v as UnidadMedida) ? (v as UnidadMedida) : UnidadMedida.unidad;
}

function inferirUnidadStockDesdeGlosa(glosa: string | null | undefined): UnidadMedida | null {
  const t = String(glosa ?? '').toLowerCase().trim();
  if (!t) return null;
  if (/\bkg\b|kilo?s?\b/.test(t)) return UnidadMedida.kg;
  if (/\b(?:gr|g)\b|gramo?s?\b/.test(t)) return UnidadMedida.gramo;
  if (/\bml\b/.test(t)) return UnidadMedida.ml;
  if (/\blitro?s?\b|\blts?\b|\blt\b/.test(t)) return UnidadMedida.litro;
  if (/\bmetro?s?\b|\bmts?\b|\bmt\b/.test(t)) return UnidadMedida.metro;
  if (/\bunidad(?:es)?\b|\bunid(?:ad)?(?:es)?\b|\bund\.?\b|\bu\.?\b/.test(t)) return UnidadMedida.unidad;
  if (/\bcaja\b|\bpack\b|\bbulto\b|\bblister\b|\bdisplay\b/.test(t)) return UnidadMedida.unidad;
  return null;
}

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

  if (xOuPorKg) return UnidadMedida.kg;

  const porGr =
    /\bpor\s+[0-9]+(?:[.,][0-9]+)?\s*(?:gramos?|gr|g)\b/.test(lower) ||
    /\bx\s*[0-9]+(?:[.,][0-9]+)?\s*(?:gramos?|gr|g)\b/.test(lower);

  if (porGr) return UnidadMedida.gramo;

  return null;
}

function textoComboFilaImport(fila: { nombre: string; unidad?: string | null }): string {
  const nombre = fila.nombre.trim();
  const g = typeof fila.unidad === 'string' ? fila.unidad.trim() : '';
  if (!g.length) return nombre;
  return `${nombre} · ${g}`;
}

export type ResolverUnidadStockImportOpts = {
  forzarProductosPesables?: boolean;
  aplicarInferenciaPesablePorNombre?: boolean;
};

export function resolverUnidadStockImportacion(
  fila: { nombre: string; unidad?: string | null },
  fallback: UnidadMedida = UnidadMedida.unidad,
  opts?: ResolverUnidadStockImportOpts,
): UnidadMedida {
  if (opts?.forzarProductosPesables === true) return UnidadMedida.kg;

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
