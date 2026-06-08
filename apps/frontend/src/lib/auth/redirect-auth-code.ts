import type { NextRequest } from 'next/server';

import {
  defaultNextAfterEmailLink,
  isAuthCompletionPath,
} from '@/lib/auth/auth-completion-paths';

const CALLBACK_PATHS = ['/api/auth/callback', '/auth/confirm'];

/** Si el correo aterrizó en /login (u otra ruta) con ?code=, reenviar al callback de la app. */
export function authCodeCallbackRedirectUrl(request: NextRequest): URL | null {
  const path = request.nextUrl.pathname;
  if (CALLBACK_PATHS.some((p) => path.startsWith(p))) {
    return null;
  }

  /** Recovery / invitación: el cliente intercambia el código (PKCE en cookie del navegador). */
  if (isAuthCompletionPath(path)) {
    return null;
  }

  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');

  if (!code && !(tokenHash && type)) {
    return null;
  }

  const callbackUrl = request.nextUrl.clone();
  callbackUrl.pathname = '/api/auth/callback';

  if (!callbackUrl.searchParams.has('next')) {
    let next = defaultNextAfterEmailLink(type);
    if (!type && code) {
      if (path.startsWith('/register')) {
        next = '/register';
      } else if (path.startsWith('/recuperar-contrasena')) {
        next = '/recuperar-contrasena/nueva';
        callbackUrl.searchParams.set('type', 'recovery');
      } else if (path.startsWith('/login') || path === '/') {
        next = '/recuperar-contrasena/nueva';
        callbackUrl.searchParams.set('type', 'recovery');
      }
    }
    callbackUrl.searchParams.set('next', next);
  } else if (!type && code && (path.startsWith('/login') || path === '/')) {
    callbackUrl.searchParams.set('type', 'recovery');
  }

  return callbackUrl;
}
