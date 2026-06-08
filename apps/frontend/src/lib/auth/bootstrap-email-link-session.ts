import type { EmailOtpType, SupabaseClient } from '@supabase/supabase-js';

/**
 * Completa la sesión cuando el enlace del correo llega directo a una página
 * (código PKCE, token_hash o tokens en el hash) en lugar de pasar por /api/auth/callback.
 */
export async function bootstrapEmailLinkSession(supabase: SupabaseClient): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const url = new URL(window.location.href);

  const code = url.searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return false;
    url.searchParams.delete('code');
    const cleaned = `${url.pathname}${url.search}`;
    window.history.replaceState({}, '', cleaned);
    return true;
  }

  const tokenHash = url.searchParams.get('token_hash');
  const otpType = url.searchParams.get('type');
  if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: otpType as EmailOtpType,
    });
    if (error) return false;
    url.searchParams.delete('token_hash');
    url.searchParams.delete('type');
    const cleaned = `${url.pathname}${url.search}`;
    window.history.replaceState({}, '', cleaned);
    return true;
  }

  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) return false;
    window.history.replaceState({}, '', url.pathname);
    return true;
  }

  return false;
}

/** Espera a que exista sesión tras un redirect (cookies pueden demorar un instante). */
export async function waitForAuthUser(
  supabase: SupabaseClient,
  attempts = 8,
  delayMs = 150,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}
