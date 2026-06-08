/** Cookie/sesión local: el usuario debe fijar contraseña antes de usar la app. */
export const PENDING_PASSWORD_RESET_COOKIE = 'ss_pending_pwd';

const STORAGE_KEY = PENDING_PASSWORD_RESET_COOKIE;

export function markPendingPasswordReset(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* ignore */
  }
  document.cookie = `${PENDING_PASSWORD_RESET_COOKIE}=1; path=/; max-age=3600; SameSite=Lax`;
}

export function clearPendingPasswordReset(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  document.cookie = `${PENDING_PASSWORD_RESET_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

export function hasPendingPasswordResetInSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
