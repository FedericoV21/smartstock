import type { AccessTokenPayload } from '../interfaces/access-token-payload.interface';
import { APP_ROLES } from '../interfaces/access-token-payload.interface';

const allowed = new Set<string>(APP_ROLES);

export function resolveAppRole(user: AccessTokenPayload): string | undefined {
  for (const key of ['app_role', 'tenant_role', 'rol'] as const) {
    const v = user[key];
    if (typeof v === 'string' && allowed.has(v)) {
      return v;
    }
  }
  if (typeof user.role === 'string' && allowed.has(user.role)) {
    return user.role;
  }
  return undefined;
}
