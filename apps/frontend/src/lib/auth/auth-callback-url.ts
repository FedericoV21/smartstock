import { getPublicAppBaseUrl } from '@/lib/supabase/env-keys';

import { safeNextPath } from './safe-redirect';

function publicAppOrigin(): string {
  const base =
    typeof window !== 'undefined' ? window.location.origin : getPublicAppBaseUrl();
  return base.replace(/\/$/, '');
}

/**
 * URL absoluta de aterrizaje en una página cliente (recovery, invitación).
 * El intercambio PKCE del `code` del correo debe hacerse en el navegador, no en
 * `/api/auth/callback`, para no perder el code_verifier de la cookie.
 * Debe estar en Supabase → Authentication → Redirect URLs.
 */
export function buildAuthEmailLandingUrl(next?: string | null): string {
  return `${publicAppOrigin()}${safeNextPath(next, '/')}`;
}

/**
 * URL absoluta para `emailRedirectTo` cuando el flujo pasa por el Route Handler
 * (p. ej. registro). Debe estar permitida en Redirect URLs.
 */
export function buildAuthCallbackUrl(next?: string | null): string {
  const path = safeNextPath(next, '/');
  return `${publicAppOrigin()}/api/auth/callback?next=${encodeURIComponent(path)}`;
}
