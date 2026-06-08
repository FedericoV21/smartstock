import { describe, expect, it, vi } from 'vitest';

import { recordWhatsAppAgentTurnLog } from '@/lib/whatsapp/agent-logs';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const INBOUND_ID = '44444444-4444-4444-8444-444444444444';
const ACTION_ID = '55555555-5555-4555-8555-555555555555';

describe('recordWhatsAppAgentTurnLog', () => {
  it('persiste un turno sanitizando secretos y normalizando replies', async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      from: vi.fn((table: string) => {
        expect(table).toBe('whatsapp_agent_turn_log');
        return {
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            inserted.push(payload);
            return { error: null };
          }),
        };
      }),
    };

    await recordWhatsAppAgentTurnLog({
      db,
      log: {
        tenantId: TENANT_ID,
        actorId: ACTOR_ID,
        usuarioId: USER_ID,
        inboundMessageId: INBOUND_ID,
        actionLogId: ACTION_ID,
        fromWaId: '5491111111111',
        channel: 'live',
        source: 'webhook_text',
        inputBody: 'que stock tengo de coca',
        resolvedMessage: 'stock de coca',
        replies: [{ body: 'Stock total: 12 unidades', messageType: 'text' }],
        intent: 'stock_producto',
        confidence: 1.5,
        status: 'success',
        toolName: 'getProductStock',
        toolArgs: {
          targetName: 'coca',
          access_token: 'secret-token',
          nested: { otpCode: '123456', visible: true },
        },
        toolResult: { reply: 'Stock total: 12 unidades' },
        processingTrace: {
          raw_payload: { ignored: 'this is not a real Meta dump in tests' },
          authorization: 'Bearer secret',
        },
        durationMs: 42.8,
      },
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      tenant_id: TENANT_ID,
      actor_id: ACTOR_ID,
      usuario_id: USER_ID,
      inbound_message_id: INBOUND_ID,
      action_log_id: ACTION_ID,
      channel: 'live',
      source: 'webhook_text',
      input_body: 'que stock tengo de coca',
      resolved_message: 'stock de coca',
      reply_body: 'Stock total: 12 unidades',
      intent: 'stock_producto',
      confidence: 1,
      status: 'success',
      tool_name: 'getProductStock',
      duration_ms: 42,
    });
    expect(inserted[0].tool_args).toMatchObject({
      targetName: 'coca',
      access_token: '[redacted]',
      nested: { otpCode: '[redacted]', visible: true },
    });
    expect(inserted[0].processing_trace).toMatchObject({
      raw_payload: '[redacted]',
      authorization: '[redacted]',
    });
  });
});
