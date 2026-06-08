import { describe, expect, it } from 'vitest';

import {
  composeReplyWithLlmPolish,
  extractFrozenTokens,
  isPolishableTemplateReply,
  shouldUseWhatsAppReplyPolish,
  validatePolishedReply,
} from '@/lib/whatsapp/reply-llm-polish';

describe('reply-llm-polish', () => {
  it('está desactivado por default', () => {
    const prev = process.env.WHATSAPP_AGENT_REPLY_POLISH;
    delete process.env.WHATSAPP_AGENT_REPLY_POLISH;
    expect(shouldUseWhatsAppReplyPolish()).toBe(false);
    process.env.WHATSAPP_AGENT_REPLY_POLISH = prev;
  });

  it('rechaza plantillas largas tipo reporte', () => {
    const long = 'linea\n'.repeat(50) + '$ 1.000,00\n$ 2.000,00';
    expect(isPolishableTemplateReply(long)).toBe(false);
  });

  it('exige conservar montos congelados', () => {
    const template = 'Total: $ 50.000,00 para Juan Perez.';
    expect(validatePolishedReply(template, 'Juan debe $ 50.000,00.')).toBe(true);
    expect(validatePolishedReply(template, 'Juan debe $ 60.000,00.')).toBe(false);
  });

  it('no permite agregar montos si la plantilla no tenía', () => {
    const template = 'Hola, soy el asistente.\nEscribí ayuda para ver el menú.';
    expect(extractFrozenTokens(template)).toEqual([]);
    expect(validatePolishedReply(template, 'Hola! Pedime ayuda cuando quieras.')).toBe(true);
    expect(validatePolishedReply(template, 'Ventas hoy: $ 9.000,00')).toBe(false);
  });

  it('devuelve plantilla si el flag está off', async () => {
    const prev = process.env.WHATSAPP_AGENT_REPLY_POLISH;
    process.env.WHATSAPP_AGENT_REPLY_POLISH = 'false';
    const template = 'Hola, soy el asistente de SmartStock.';
    const out = await composeReplyWithLlmPolish({
      kind: 'assistant_greeting',
      templateReply: template,
      callLlm: async () => 'Texto inventado por LLM',
    });
    expect(out).toBe(template);
    process.env.WHATSAPP_AGENT_REPLY_POLISH = prev;
  });

  it('usa LLM inyectado y valida antes de aceptar', async () => {
    const prev = process.env.WHATSAPP_AGENT_REPLY_POLISH;
    process.env.WHATSAPP_AGENT_REPLY_POLISH = 'true';
    const template = 'Hola, soy el asistente de SmartStock.\nEscribí ayuda para ver opciones.';

    const polished = await composeReplyWithLlmPolish({
      kind: 'assistant_greeting',
      templateReply: template,
      userMessage: 'hola',
      callLlm: async () => '¡Hola! Soy tu asistente de SmartStock. Escribí ayuda para ver opciones.',
    });
    expect(polished).toContain('SmartStock');

    const rejected = await composeReplyWithLlmPolish({
      kind: 'assistant_greeting',
      templateReply: template,
      callLlm: async () => 'Ventas del día: $ 99.999,99',
    });
    expect(rejected).toBe(template);

    process.env.WHATSAPP_AGENT_REPLY_POLISH = prev;
  });
});
