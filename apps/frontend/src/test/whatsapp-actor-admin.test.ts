import { describe, expect, it, vi } from 'vitest';

import { removeWhatsAppActor } from '@/lib/whatsapp/actor-admin';

function createActorAdminDb(options: {
  actor: Record<string, unknown>;
  deleteMock?: ReturnType<typeof vi.fn>;
}) {
  const updates: Array<Record<string, unknown>> = [];

  const db = {
    from(table: string) {
      if (table === 'whatsapp_actor') {
        return {
          select: (_columns?: string, _opts?: unknown) => {
            const chain = {
              eq: () => chain,
              in: () => chain,
              maybeSingle: async () => ({ data: options.actor, error: null }),
              eqSecond: () => ({
                eq: async () => ({ count: 0, error: null }),
              }),
            };

            return {
              eq: (column: string) => {
                if (column === 'tenant_id') {
                  return {
                    eq: (column2: string) => {
                      if (column2 === 'id') {
                        return {
                          maybeSingle: async () => ({ data: options.actor, error: null }),
                        };
                      }
                      return {
                        eq: async () => ({ error: null }),
                      };
                    },
                  };
                }
                return chain;
              },
              in: () => ({
                eq: () => ({
                  eq: async () => ({ count: 0, error: null }),
                }),
              }),
            };
          },
          update: (payload: Record<string, unknown>) => {
            updates.push(payload);
            return {
              eq: () => ({
                eq: async () => ({ error: null }),
              }),
            };
          },
          delete: () => ({
            eq: () => ({
              eq: options.deleteMock ?? (async () => ({ error: null })),
            }),
          }),
        };
      }

      if (table === 'whatsapp_auth_challenge') {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                in: async () => ({ error: null }),
              }),
            }),
          }),
        };
      }

      if (table === 'whatsapp_platform_routing_state') {
        return {
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
  };

  return { db, updates };
}

describe('removeWhatsAppActor', () => {
  it('desactiva actor verificado en modo unlink', async () => {
    const { db, updates } = createActorAdminDb({
      actor: {
        id: 'actor-1',
        tenant_id: 'tenant-1',
        from_wa_id: '5491112345678',
        trust_level: 'verified',
        activo: true,
      },
    });

    const result = await removeWhatsAppActor({
      db,
      tenantId: 'tenant-1',
      actorId: 'actor-1',
      mode: 'unlink',
    });

    expect(result.mode).toBe('unlink');
    expect(updates.some((row) => row.activo === false)).toBe(true);
  });

  it('elimina actor no verificado en modo delete', async () => {
    const deleteMock = vi.fn(async () => ({ error: null }));
    const { db } = createActorAdminDb({
      actor: {
        id: 'actor-2',
        tenant_id: 'tenant-1',
        from_wa_id: '5491198765432',
        trust_level: 'unverified',
        activo: false,
      },
      deleteMock,
    });

    await removeWhatsAppActor({
      db,
      tenantId: 'tenant-1',
      actorId: 'actor-2',
      mode: 'delete',
    });

    expect(deleteMock).toHaveBeenCalled();
  });
});
