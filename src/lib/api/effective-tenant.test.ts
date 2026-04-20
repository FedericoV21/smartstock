import { describe, expect, it } from 'vitest';

import { resolveEffectiveTenantId } from '@/lib/api/effective-tenant';

describe('resolveEffectiveTenantId', () => {
  const home = '00000000-0000-0000-0000-000000000001';
  const other = '00000000-0000-0000-0000-000000000002';

  it('returns home when not super admin', () => {
    expect(
      resolveEffectiveTenantId({
        homeTenantId: home,
        tenantContextoId: other,
        esSuperAdmin: false,
        contextAllowed: true,
      }),
    ).toBe(home);
  });

  it('returns home when context null', () => {
    expect(
      resolveEffectiveTenantId({
        homeTenantId: home,
        tenantContextoId: null,
        esSuperAdmin: true,
        contextAllowed: true,
      }),
    ).toBe(home);
  });

  it('returns home when context not allowed', () => {
    expect(
      resolveEffectiveTenantId({
        homeTenantId: home,
        tenantContextoId: other,
        esSuperAdmin: true,
        contextAllowed: false,
      }),
    ).toBe(home);
  });

  it('returns other tenant when super admin and allowed', () => {
    expect(
      resolveEffectiveTenantId({
        homeTenantId: home,
        tenantContextoId: other,
        esSuperAdmin: true,
        contextAllowed: true,
      }),
    ).toBe(other);
  });
});
