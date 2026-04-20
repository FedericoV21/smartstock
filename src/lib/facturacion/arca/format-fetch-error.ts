/**
 * Node/Undici suele rechazar con TypeError "fetch failed"; el motivo real
 * (DNS, TLS, timeout, conexión) viene en `error.cause`.
 */
export function formatFetchError(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }
  const parts: string[] = [];
  let current: unknown = err;
  let depth = 0;
  while (current instanceof Error && depth < 8) {
    const code =
      'code' in current && typeof (current as NodeJS.ErrnoException).code === 'string'
        ? String((current as NodeJS.ErrnoException).code)
        : null;
    const line = [current.name, current.message, code ? `code=${code}` : null]
      .filter(Boolean)
      .join(' ');
    if (line && !parts.includes(line)) {
      parts.push(line);
    }
    current = current.cause;
    depth++;
  }
  return parts.length > 0 ? parts.join(' → ') : String(err);
}
