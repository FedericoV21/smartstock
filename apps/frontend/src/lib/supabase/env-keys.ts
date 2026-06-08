/**
 * Variables de entorno de Supabase (hosted).
 * Proyectos nuevos pueden usar publishable (`sb_publishable_...`) en lugar del anon JWT;
 * el service puede ser `service_role` JWT o secret (`sb_secret_...`).
 * @see https://supabase.com/docs/guides/api/api-keys
 */
export function getSupabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
}

export function getSupabaseAnonKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    ''
  );
}

export function getSupabaseServiceRoleKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    ''
  );
}

/**
 * URL pública de la app (invitaciones, enlaces absolutos).
 * Acepta `NEXT_PUBLIC_SITE_URL` o `NEXT_PUBLIC_APP_URL` (documentación / Vercel).
 */
export function getPublicAppBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL?.trim() ? `https://${process.env.VERCEL_URL.trim()}` : '') ||
    'http://localhost:3000';
  return raw.replace(/\/$/, '');
}

/**
 * URL absoluta (https/http) para webhooks de Mercado Pago (`notification_url`, etc.).
 * Si la base no trae esquema (p. ej. `mi-app.vercel.app`), se antepone `https://`.
 * Devuelve `null` si no se puede construir una URL válida.
 */
export function buildPublicAppAbsoluteUrl(pathWithLeadingSlash: string): string | null {
  let base = getPublicAppBaseUrl().trim();
  if (!base) return null;
  base = base.replace(/\/$/, '');
  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base.replace(/^\/+/, '')}`;
  }
  const rel = pathWithLeadingSlash.startsWith('/')
    ? pathWithLeadingSlash
    : `/${pathWithLeadingSlash}`;
  try {
    return new URL(rel, `${base}/`).href;
  } catch {
    return null;
  }
}
