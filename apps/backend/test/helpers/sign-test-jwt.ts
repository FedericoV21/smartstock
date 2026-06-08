import { JwtService } from '@nestjs/jwt';

import { DEMO_SUCURSAL_ID, DEMO_TENANT_ID, DEMO_USER_SUB } from './e2e-constants';

type SignOptions = {
  tenantId?: string;
  rol?: 'admin' | 'operador' | 'visor';
  sub?: string;
  sucursalDefaultId?: string;
};

export function signTestJwt(overrides: SignOptions = {}): string {
  const secret =
    process.env.JWT_SECRET ||
    process.env.SUPABASE_JWT_SECRET ||
    'e2e-test-jwt-secret-do-not-use-in-production-32';

  const jwt = new JwtService({ secret });
  return jwt.sign({
    sub: overrides.sub ?? DEMO_USER_SUB,
    email: 'demo-admin@kiosco.test',
    tenant_id: overrides.tenantId ?? DEMO_TENANT_ID,
    rol: overrides.rol ?? 'admin',
    sucursal_default_id: overrides.sucursalDefaultId ?? DEMO_SUCURSAL_ID,
  });
}
