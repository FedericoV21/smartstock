const HEX_6 = /^#[0-9A-Fa-f]{6}$/;

/** Normaliza a `#RRGGBB` mayúsculas o `null` si es inválido / vacío. */
export function normalizeWorkflowHexColor(input: string | null | undefined): string | null {
  if (input == null) return null;
  const t = input.trim();
  if (!t) return null;
  const withHash = t.startsWith('#') ? t : `#${t}`;
  if (!HEX_6.test(withHash)) return null;
  return withHash.toUpperCase();
}

/**
 * Color de texto (#RRGGBB) con contraste razonable sobre un fondo hex.
 * Usa luminancia relativa WCAG (umbral ~0.45).
 */
export function foregroundForHexBg(backgroundHex: string): string {
  const bg = normalizeWorkflowHexColor(backgroundHex);
  if (!bg) return '#171717';
  const r = parseInt(bg.slice(1, 3), 16) / 255;
  const g = parseInt(bg.slice(3, 5), 16) / 255;
  const b = parseInt(bg.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? '#171717' : '#fafafa';
}
