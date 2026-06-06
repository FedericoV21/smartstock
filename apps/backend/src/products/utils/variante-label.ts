const VARIANTE_KEYS_V1 = ['talle', 'color', 'material', 'medida'] as const;

export type ProductoVarianteAtributos = Record<string, string | number | boolean | null | undefined>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function normalizarAtributosVariante(raw: unknown): ProductoVarianteAtributos {
  if (!isRecord(raw)) return {};
  const out: ProductoVarianteAtributos = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = k.trim();
    if (!key || v == null) continue;
    if (typeof v === 'string') {
      const s = v.trim();
      if (s) out[key] = s;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[key] = v;
    } else if (typeof v === 'boolean') {
      out[key] = v;
    }
  }
  return out;
}

export function etiquetaVariante(atributosRaw: unknown, etiquetaRaw?: string | null): string {
  const etiqueta = typeof etiquetaRaw === 'string' ? etiquetaRaw.trim() : '';
  if (etiqueta) return etiqueta;

  const atributos = normalizarAtributosVariante(atributosRaw);
  const partes = VARIANTE_KEYS_V1.map((key) => {
    const value = atributos[key];
    return value == null ? '' : String(value).trim();
  }).filter(Boolean);

  if (partes.length > 0) return partes.join(' / ');

  const extras = Object.entries(atributos)
    .filter(([key]) => !(VARIANTE_KEYS_V1 as readonly string[]).includes(key))
    .map(([, value]) => (value == null ? '' : String(value).trim()))
    .filter(Boolean);

  return extras.length > 0 ? extras.join(' / ') : 'Variante';
}
