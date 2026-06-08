import { describe, expect, it, vi } from 'vitest';

import {
  parseTenantSelectionReply,
  resolveInboundWhatsAppTenant,
  type WhatsAppTenantChoice,
} from '@/lib/whatsapp/inbound-routing';

const choices: WhatsAppTenantChoice[] = [
  {
    tenantId: 'tenant-a',
    tenantName: 'Kiosco Centro',
    actorId: 'actor-a',
    trustLevel: 'verified',
  },
  {
    tenantId: 'tenant-b',
    tenantName: 'Almacen Norte',
    actorId: 'actor-b',
    trustLevel: 'verified',
  },
];

describe('parseTenantSelectionReply', () => {
  it('resuelve seleccion numerica', () => {
    expect(parseTenantSelectionReply('2', choices)?.tenantId).toBe('tenant-b');
  });

  it('resuelve seleccion por nombre parcial', () => {
    expect(parseTenantSelectionReply('kiosco', choices)?.tenantId).toBe('tenant-a');
  });
});

describe('resolveInboundWhatsAppTenant', () => {
  function mockActorQuery(data: unknown[] = []) {
    const chain: Record<string, unknown> = {};
    chain.eq = () => chain;
    chain.in = () => chain;
    chain.limit = async () => ({ data, error: null });
    return {
      select: () => chain,
    };
  }

  it('resuelve tenant unico por remitente en canal compartido', async () => {
    const upsertMock = vi.fn(async () => ({ error: null }));
    const db = {
      from(table: string) {
        if (table === 'whatsapp_platform_routing_state') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null }),
              }),
            }),
            upsert: upsertMock,
          };
        }
        if (table === 'whatsapp_platform_channel') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: { id: 'platform-1', phone_number_id: '999', activa: true },
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'whatsapp_actor') {
          return mockActorQuery([
            {
              id: 'actor-a',
              tenant_id: 'tenant-a',
              trust_level: 'verified',
              from_wa_id: '5491112345678',
              tenant: { nombre: 'Kiosco Centro' },
            },
          ]);
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const result = await resolveInboundWhatsAppTenant({
      db,
      phoneNumberId: '999',
      fromWaId: '5491112345678',
      textBody: 'ventas hoy',
    });

    expect(result).toEqual({
      mode: 'platform',
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      trustLevel: 'verified',
    });
  });

  it('prioriza actor verificado sobre canal legacy duplicado', async () => {
    const db = {
      from(table: string) {
        if (table === 'whatsapp_platform_channel') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: { id: 'platform-1', phone_number_id: '999', activa: true },
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'whatsapp_actor') {
          return mockActorQuery([
            {
              id: 'actor-verified',
              tenant_id: 'tenant-correct',
              trust_level: 'verified',
              from_wa_id: '5493816285231',
              tenant: { nombre: 'Ginkgo Devs' },
            },
          ]);
        }
        if (table === 'whatsapp_channel') {
          throw new Error('legacy channel must not be queried when verified actor exists');
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const result = await resolveInboundWhatsAppTenant({
      db,
      phoneNumberId: '999',
      fromWaId: '5493816285231',
      textBody: 'stock',
    });

    expect(result).toEqual({
      mode: 'platform',
      tenantId: 'tenant-correct',
      actorId: 'actor-verified',
      trustLevel: 'verified',
    });
  });

  it('resuelve tenant legacy cuando el phone number id no es el central', async () => {
    const db = {
      from(table: string) {
        if (table === 'whatsapp_platform_channel') {
          return {
            select: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: { id: 'platform-1', phone_number_id: '999', activa: true },
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'whatsapp_actor') {
          return mockActorQuery([]);
        }
        if (table === 'whatsapp_channel') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: { tenant_id: 'tenant-legacy' } }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };

    const result = await resolveInboundWhatsAppTenant({
      db,
      phoneNumberId: '888',
      fromWaId: '5491112345678',
      textBody: 'stock',
    });

    expect(result).toEqual({
      mode: 'legacy_channel',
      tenantId: 'tenant-legacy',
    });
  });
});
