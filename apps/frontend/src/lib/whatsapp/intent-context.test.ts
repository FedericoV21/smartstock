import { describe, expect, it } from 'vitest';

import {
  conversationStateToIntentContext,
  expandMessageWithIntentContext,
  formatIntentContextForLlmPrompt,
} from '@/lib/whatsapp/intent-context';
import type { WhatsAppConversationState } from '@/lib/whatsapp/conversation-memory';

describe('intent-context', () => {
  it('expande periodo de ventas desde lastIntent', () => {
    const expanded = expandMessageWithIntentContext('y ayer?', {
      lastIntent: 'reporte_ventas',
      topic: 'ventas',
    });
    expect(expanded).toBe('ventas ayer');
  });

  it('expande productos mas vendidos mes anterior', () => {
    const expanded = expandMessageWithIntentContext('y del mes anterior?', {
      lastIntent: 'reporte_ventas_productos',
      topic: 'ventas',
    });
    expect(expanded).toBe('productos mas vendidos mes anterior');
  });

  it('expande seguir pagina de reporte de stock', () => {
    const expanded = expandMessageWithIntentContext('segui', {
      lastReportKey: 'stock_general',
      lastReportPage: 1,
    });
    expect(expanded).toBe('reporte stock general pagina 2');
  });

  it('expande telefono con lastEntityName cliente', () => {
    const expanded = expandMessageWithIntentContext('y su telefono', {
      lastIntent: 'reporte_ventas_clientes',
      lastEntityType: 'cliente',
      lastEntityName: 'Juan Perez',
    });
    expect(expanded).toBe('telefono de cliente Juan Perez');
  });

  it('formatIntentContextForLlmPrompt incluye lastIntent', () => {
    const lines = formatIntentContextForLlmPrompt({ lastIntent: 'reporte_ventas', topic: 'ventas' });
    expect(lines.some((l) => l.includes('lastIntent: reporte_ventas'))).toBe(true);
  });

  it('conversationStateToIntentContext mapea estado y pendingPrompt', () => {
    const state: WhatsAppConversationState = {
      topic: 'ventas',
      lastIntent: 'reporte_ganancias',
      lastEntityType: null,
      lastEntityName: null,
      pendingPrompt: 'report_scope',
      lastOptions: [],
      lastReportKey: null,
      lastReportPage: null,
      lastUserMessage: null,
      lastBotSummary: null,
      lastContactField: null,
      turnCount: 1,
      sessionStartedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      slotsActive: true,
    };
    const ctx = conversationStateToIntentContext(state);
    expect(ctx?.lastIntent).toBe('reporte_ganancias');
    expect(ctx?.pendingPrompt).toBe('report_scope');
  });

  it('expande y su saldo con entidad cliente en contexto', () => {
    const expanded = expandMessageWithIntentContext('y su saldo', {
      lastEntityType: 'cliente',
      lastEntityName: 'Maria',
      topic: 'deuda_clientes',
    });
    expect(expanded).toContain('Maria');
  });
});
