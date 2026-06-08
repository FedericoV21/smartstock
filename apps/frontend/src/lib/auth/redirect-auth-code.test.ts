import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { authCodeCallbackRedirectUrl } from './redirect-auth-code';

function requestFor(path: string, query = ''): NextRequest {
  return new NextRequest(`https://app.example.com${path}${query}`);
}

describe('authCodeCallbackRedirectUrl', () => {
  it('no redirige rutas de finalización de correo (recovery en cliente)', () => {
    const req = requestFor('/recuperar-contrasena/nueva', '?code=abc&type=recovery');
    expect(authCodeCallbackRedirectUrl(req)).toBeNull();
  });

  it('sí redirige /login con code al callback del servidor', () => {
    const req = requestFor('/login', '?code=abc');
    const url = authCodeCallbackRedirectUrl(req);
    expect(url?.pathname).toBe('/api/auth/callback');
    expect(url?.searchParams.get('type')).toBe('recovery');
    expect(url?.searchParams.get('next')).toBe('/recuperar-contrasena/nueva');
  });
});
