import { describe, expect, it } from 'vitest';

import {
  isFirstTurnInSession,
  parseConversationStateRow,
  sessionTtlHours,
  slotTtlMinutes,
  summarizeBotReplyForMemory,
} from '@/lib/whatsapp/conversation-memory';

describe('conversation-memory v2', () => {
  it('parseConversationStateRow devuelve slots activos dentro de TTL', () => {
    const state = parseConversationStateRow({
      topic: 'ventas',
      last_intent: 'reporte_ventas',
      last_entity_type: null,
      last_entity_name: null,
      pending_prompt: null,
      last_options: [],
      last_report_key: null,
      last_report_page: null,
      last_user_message: 'ventas hoy',
      last_bot_summary: 'Total del dia: $1000',
      last_contact_field: null,
      turn_count: 2,
      session_started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(state?.slotsActive).toBe(true);
    expect(state?.topic).toBe('ventas');
    expect(state?.turnCount).toBe(2);
  });

  it('parseConversationStateRow limpia slots si expires_at venció pero mantiene sesión', () => {
    const state = parseConversationStateRow({
      topic: 'ventas',
      last_intent: 'reporte_ventas',
      last_entity_type: 'cliente',
      last_entity_name: 'Juan',
      pending_prompt: 'report_scope',
      last_options: ['A', 'B'],
      last_report_key: 'deuda_clientes',
      last_report_page: 2,
      last_user_message: 'y ayer?',
      last_bot_summary: 'Resumen corto',
      last_contact_field: 'telefono',
      turn_count: 5,
      session_started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(state).not.toBeNull();
    expect(state?.slotsActive).toBe(false);
    expect(state?.topic).toBeNull();
    expect(state?.lastIntent).toBeNull();
    expect(state?.turnCount).toBe(5);
    expect(state?.lastUserMessage).toBe('y ayer?');
  });

  it('parseConversationStateRow retorna null si la sesión larga expiró', () => {
    const state = parseConversationStateRow({
      turn_count: 1,
      session_started_at: new Date(Date.now() - (sessionTtlHours() + 1) * 3_600_000).toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(state).toBeNull();
  });

  it('isFirstTurnInSession y summarizeBotReplyForMemory', () => {
    expect(isFirstTurnInSession(null)).toBe(true);
    expect(
      isFirstTurnInSession({
        turnCount: 0,
      } as any),
    ).toBe(true);
    expect(summarizeBotReplyForMemory('Linea 1\nLinea 2 larga')).toBe('Linea 1');
  });

  it('slotTtlMinutes y sessionTtlHours tienen defaults razonables', () => {
    expect(slotTtlMinutes()).toBeGreaterThanOrEqual(5);
    expect(sessionTtlHours()).toBeGreaterThanOrEqual(1);
  });
});
