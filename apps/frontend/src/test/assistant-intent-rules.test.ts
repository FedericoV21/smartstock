import { describe, expect, it } from 'vitest';

import { runWhatsAppReadOnlyAgent } from '@/lib/whatsapp/read-only-agent';

function mockDb() {
  return {
    from(table: string) {
      if (table === 'modulo_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  facturador_simple: true,
                  stock: true,
                  facturador_pos: false,
                  analizador_rentabilidad: false,
                  lector_facturas: true,
                  importador_excel: false,
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe('assistant meta intents', () => {
  it('responde a hola con saludo', async () => {
    const result = await runWhatsAppReadOnlyAgent({
      db: mockDb(),
      tenantId: 't1',
      message: 'hola',
      enableV2: true,
      rolWhatsapp: 'operador',
      channel: 'live',
    });
    expect(result.intent).toBe('assistant_greeting');
    expect(result.reply.toLowerCase()).toContain('hola');
    expect(result.reply.toLowerCase()).toContain('ayuda');
  });

  it('responde a ayuda con menu', async () => {
    const result = await runWhatsAppReadOnlyAgent({
      db: mockDb(),
      tenantId: 't1',
      message: 'que podes hacer',
      enableV2: true,
      rolWhatsapp: 'operador',
    });
    expect(result.intent).toBe('assistant_help');
    expect(result.reply).toContain('Consultas');
  });
});
