import { defaultNextAfterEmailLink } from '@/lib/auth/auth-completion-paths';
import { hasPendingPasswordResetInSession } from '@/lib/auth/pending-password-reset';

/** Destino tras abrir un enlace del correo (query + hash de Supabase). */
export function resolveEmailLinkDestination(options: {
  type?: string | null;
  hashType?: string | null;
  hasCode?: boolean;
  hasImplicitTokens?: boolean;
}): string {
  const { type = null, hashType = null, hasCode = false, hasImplicitTokens = false } = options;
  const effectiveType = type ?? hashType;
  if (effectiveType) {
    return defaultNextAfterEmailLink(effectiveType);
  }
  if (hasCode || hasImplicitTokens || hasPendingPasswordResetInSession()) {
    return '/recuperar-contrasena/nueva';
  }
  return '/';
}
