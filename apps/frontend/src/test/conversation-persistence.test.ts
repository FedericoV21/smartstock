import { describe, expect, it } from 'vitest';

import {
  buildMemoryPatchFromAction,
  buildMemoryPatchFromInvoiceChat,
} from '@/lib/whatsapp/conversation-persistence';
import { resolveConversationMessage } from '@/lib/whatsapp/conversation-resolver';
import { conversationStateFixture } from '@/lib/whatsapp/conversation-memory';
import { suggestNextStep } from '@/lib/whatsapp/suggest-next-step';
import { buildWhatsAppCapabilitiesCatalog } from '@/lib/whatsapp/capabilities-catalog';

describe('conversation persistence V144-WA-009', () => {
  it('persiste entidad tras pago a proveedor ejecutado', () => {
    const patch = buildMemoryPatchFromAction({
      telemetry: {
        intent: 'action_executed_proveedor_pago_directo',
        payload: { proveedor_nombre: 'Arcor SA' },
      },
      userMessage: 'si 1234',
      botReply: 'Pago registrado correctamente.',
    });
    expect(patch?.lastEntityType).toBe('proveedor');
    expect(patch?.lastEntityName).toBe('Arcor SA');
    expect(patch?.lastIntent).toBe('proveedor_deuda');
  });

  it('limpia pending al cancelar acción', () => {
    const patch = buildMemoryPatchFromAction({
      telemetry: { intent: 'action_cancelled' },
      userMessage: 'cancelar',
      botReply: 'Acción cancelada.',
    });
    expect(patch?.pendingPrompt).toBeNull();
    expect(patch?.lastIntent).toBe('action_cancelled');
  });

  it('patch tras factura aplicada', () => {
    const patch = buildMemoryPatchFromInvoiceChat({
      userMessage: 'confirmar 4821',
      botReply: 'Factura cargada. Comprobante #99.',
    });
    expect(patch.lastIntent).toBe('invoice_ticket_applied');
    expect(patch.pendingPrompt).toBeNull();
  });

  it('patch tras cerrar ticket', () => {
    const patch = buildMemoryPatchFromInvoiceChat({
      userMessage: 'cerrar',
      botReply: 'Ticket cerrado.',
    });
    expect(patch.lastIntent).toBe('invoice_ticket_closed');
  });

  it('suggestNextStep para cliente_deuda', () => {
    const hint = suggestNextStep('cliente_deuda', buildWhatsAppCapabilitiesCatalog({
      modules: { facturador_simple: true, stock: true },
      rolWhatsapp: 'operador',
      channel: 'live',
    }));
    expect(hint).toMatch(/saldo/i);
  });

  it('anáfora y su saldo post-acción con memoria de cliente', () => {
    const state = conversationStateFixture({
      topic: 'deuda_clientes',
      lastIntent: 'cliente_deuda',
      lastEntityType: 'cliente',
      lastEntityName: 'Maria Lopez',
    });
    const r = resolveConversationMessage({ text: 'y su saldo', state });
    expect(r.interpreted).toBe(true);
    expect(r.message).toContain('Maria Lopez');
  });

  it('de nuevo repite deuda del mismo cliente', () => {
    const state = conversationStateFixture({
      topic: 'deuda_clientes',
      lastIntent: 'cliente_deuda',
      lastEntityType: 'cliente',
      lastEntityName: 'Pedro',
    });
    const r = resolveConversationMessage({ text: 'de nuevo', state });
    expect(r.message).toContain('Pedro');
  });

  it('no suggestNextStep en intents de asistente', () => {
    expect(suggestNextStep('assistant_greeting', null)).toBeNull();
  });
});
