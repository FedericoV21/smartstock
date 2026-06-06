import { ConfigService } from '@nestjs/config';

import { getJwtSigningSecret } from './jwt-secret.util';

describe('getJwtSigningSecret', () => {
  it('prefiere JWT_SECRET sobre SUPABASE_JWT_SECRET', () => {
    const config = {
      get: (k: string) =>
        k === 'JWT_SECRET' ? '  primary  ' : k === 'SUPABASE_JWT_SECRET' ? 'legacy' : undefined,
    } as unknown as ConfigService;
    expect(getJwtSigningSecret(config)).toBe('primary');
  });

  it('usa SUPABASE_JWT_SECRET si JWT_SECRET no est├í', () => {
    const config = {
      get: (k: string) => (k === 'JWT_SECRET' ? '' : k === 'SUPABASE_JWT_SECRET' ? 'legacy-only' : undefined),
    } as unknown as ConfigService;
    expect(getJwtSigningSecret(config)).toBe('legacy-only');
  });

  it('lanza si no hay ninguno', () => {
    const config = {
      get: () => undefined,
    } as unknown as ConfigService;
    expect(() => getJwtSigningSecret(config)).toThrow('Falta JWT_SECRET');
  });
});
