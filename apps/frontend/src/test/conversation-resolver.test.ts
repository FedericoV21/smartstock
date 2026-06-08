import { describe, expect, it } from 'vitest';

import type { WhatsAppConversationState } from '@/lib/whatsapp/conversation-memory';
import { resolveConversationMessage } from '@/lib/whatsapp/conversation-resolver';

function baseState(partial: Partial<WhatsAppConversationState>): WhatsAppConversationState {
  return {
    topic: null,
    lastIntent: null,
    lastEntityType: null,
    lastEntityName: null,
    pendingPrompt: null,
    lastOptions: [],
    lastReportKey: null,
    lastReportPage: null,
    lastUserMessage: null,
    lastBotSummary: null,
    lastContactField: null,
    turnCount: 1,
    sessionStartedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    slotsActive: true,
    ...partial,
  };
}

describe('resolveConversationMessage', () => {
  it('expande saldo post-acción vía memoria', () => {
    const state = baseState({
      lastEntityType: 'cliente',
      lastEntityName: 'Juan Perez',
      lastIntent: 'cliente_deuda',
      topic: 'deuda_clientes',
    });
    const r = resolveConversationMessage({ text: 'y su saldo', state });
    expect(r.interpreted).toBe(true);
    expect(r.source).toBe('memory');
    expect(r.message).toContain('Juan Perez');
  });

  it('resuelve debt_scope con respuesta clientes', () => {
    const state = baseState({
      pendingPrompt: 'debt_scope',
      lastEntityName: 'ACME',
    });
    const r = resolveConversationMessage({ text: 'clientes', state });
    expect(r.interpreted).toBe(true);
    expect(r.source).toBe('memory');
    expect(r.message).toMatch(/cliente ACME/i);
  });
});
