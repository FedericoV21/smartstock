const HEX_6 = /^#[0-9A-Fa-f]{6}$/;

/** Normaliza a `#RRGGBB` may├║sculas o `null` si es inv├ílido / vac├¡o. */
export function normalizeWorkflowHexColor(input: string | null | undefined): string | null {
  if (input == null) return null;
  const t = input.trim();
  if (!t) return null;
  const withHash = t.startsWith('#') ? t : `#${t}`;
  if (!HEX_6.test(withHash)) return null;
  return withHash.toUpperCase();
}
