import { afterEach, describe, expect, it } from 'vitest';

import { resolveEmailLinkDestination } from './email-link-destination';
import { clearPendingPasswordReset, markPendingPasswordReset } from './pending-password-reset';

describe('resolveEmailLinkDestination', () => {
  afterEach(() => {
    clearPendingPasswordReset();
  });

  it('recovery en query o hash va a nueva contraseña', () => {
    expect(resolveEmailLinkDestination({ type: 'recovery' })).toBe('/recuperar-contrasena/nueva');
    expect(resolveEmailLinkDestination({ hashType: 'recovery' })).toBe('/recuperar-contrasena/nueva');
  });

  it('tokens en hash sin type pero con marca local va a nueva contraseña', () => {
    markPendingPasswordReset();
    expect(resolveEmailLinkDestination({ hasImplicitTokens: true })).toBe(
      '/recuperar-contrasena/nueva',
    );
  });

  it('magic link sin recovery va al inicio', () => {
    expect(resolveEmailLinkDestination({ hashType: 'magiclink', hasImplicitTokens: true })).toBe('/');
  });
});
