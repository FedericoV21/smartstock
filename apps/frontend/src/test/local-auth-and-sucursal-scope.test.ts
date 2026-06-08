import { describe, expect, it } from 'vitest';

import {
  buildLocalAuthEmail,
  hashPin,
  isValidPin,
  normalizeLocalUsername,
  verifyPin,
} from '@/lib/auth/local-credentials';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';

describe('local-credentials', () => {
  it('normaliza username y genera email técnico local', () => {
    const username = normalizeLocalUsername('  Caja_1  ');
    expect(username).toBe('caja_1');
    expect(buildLocalAuthEmail('tenant-123', username)).toBe(
      'l983b5c31df590f8c67f469d10915205e@example.invalid',
    );
  });

  it('valida y verifica PIN hasheado', async () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12')).toBe(false);

    const hash = await hashPin('1234');
    expect(await verifyPin('1234', hash)).toBe(true);
    expect(await verifyPin('9999', hash)).toBe(false);
  });
});

describe('resolveAndValidateSucursalScope', () => {
  it('devuelve 403 cuando usuario no puede operar la sucursal', async () => {
    const session = {
      userId: 'u1',
      supabase: {
        rpc: async () => ({ data: false, error: null }),
      },
    } as any;

    const result = await resolveAndValidateSucursalScope(session, 'suc-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  it('permite cuando no hay sucursal y usuario tiene default null', async () => {
    const session = {
      userId: 'u1',
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { sucursal_default_id: null }, error: null }),
            }),
          }),
        }),
      },
    } as any;

    const result = await resolveAndValidateSucursalScope(session, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sucursalId).toBeNull();
    }
  });

  it('admin/super admin: default de otro tenant resuelve a sucursal del tenant efectivo', async () => {
    let sucursalFromCalls = 0;
    const session = {
      userId: 'u1',
      tenantId: 'tenant-efectivo',
      isSuperAdmin: true,
      rol: 'admin',
      supabase: {
        from: (table: string) => {
          if (table === 'usuario') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { sucursal_default_id: 'suc-otro-tenant' },
                    error: null,
                  }),
                }),
              }),
            };
          }
          sucursalFromCalls += 1;
          if (sucursalFromCalls === 1) {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    order: () => ({
                      limit: async () => ({ data: [{ id: 'suc-local' }], error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        },
      },
    } as any;

    const result = await resolveAndValidateSucursalScope(session, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sucursalId).toBe('suc-local');
    }
  });

  it('admin sin sucursal_default_id usa la primera sucursal activa del tenant', async () => {
    const session = {
      userId: 'u1',
      tenantId: 'tenant-1',
      isSuperAdmin: false,
      rol: 'admin',
      supabase: {
        from: (table: string) => {
          if (table === 'usuario') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { sucursal_default_id: null },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    order: () => ({
                      limit: async () => ({ data: [{ id: 'suc-pick' }], error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        },
      },
    } as any;

    const result = await resolveAndValidateSucursalScope(session, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sucursalId).toBe('suc-pick');
    }
  });
});

