function pareceHtml(texto: string): boolean {
  const t = texto.trim().toLowerCase();
  return t.includes('<html') || t.includes('<body') || t.includes('<head') || t.includes('</');
}

const DEFAULT_MAX_BUSQUEDA_CHARS = 200;

/** Ver detalle del parámetro en `mensajeErrorBusquedaAmigable`. */
export type MensajeErrorBusquedaOpts = {
  /** Estado HTTP devuelto por `fetch` (no el cuerpo). */
  responseStatus?: number;
  /** Longitud útil del término ya enviado al API (ej. tras trim/slice). */
  terminoChars?: number;
  /** Solo mostrar mensaje por término largo si supera este umbral (default razonable). */
  maxBusquedaChars?: number;
};

/**
 * Evita filtrar mensajes técnicos crudos (HTML, gateways, etc.) al usuario final.
 * El texto “demasiado larga” solo aplica ante 414 HTTP o ante un término que realmente fue largo;
 * gateways a veces meten la cadena «414» en HTML con otro código de estado.
 */
export function mensajeErrorBusquedaAmigable(
  raw: string | null | undefined,
  fallback: string,
  opts?: MensajeErrorBusquedaOpts,
): string {
  const t = (raw ?? '').trim();
  if (!t) return fallback;
  if (pareceHtml(t)) {
    const maxQ = opts?.maxBusquedaChars ?? DEFAULT_MAX_BUSQUEDA_CHARS;
    const termLargo =
      opts?.terminoChars !== undefined && opts.terminoChars > maxQ;

    if (opts?.responseStatus === 414 || termLargo) {
      return 'La búsqueda enviada es demasiado larga para el servidor. Probá con un término más corto.';
    }
    return fallback;
  }
  return t;
}

