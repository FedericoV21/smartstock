/**
 * Restringe el parámetro `next` del callback de Supabase a rutas relativas
 * de la app (evita redirecciones abiertas).
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (next == null || typeof next !== 'string') {
    return fallback;
  }
  const t = next.trim();
  if (!t.startsWith('/') || t.startsWith('//')) {
    return fallback;
  }
  if (t.includes('://') || t.includes('\\') || t.includes('\0')) {
    return fallback;
  }
  return t;
}
