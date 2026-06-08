import type {
  ConversationEntityType,
  ConversationPendingPrompt,
  ConversationTopic,
} from '@/lib/whatsapp/conversation-memory';
import { summarizeBotReplyForMemory } from '@/lib/whatsapp/conversation-memory';

export type ConversationStatePatch = {
  topic?: ConversationTopic;
  lastIntent?: string | null;
  lastEntityType?: ConversationEntityType;
  lastEntityName?: string | null;
  pendingPrompt?: ConversationPendingPrompt;
  lastOptions?: string[];
  lastUserMessage?: string | null;
  lastBotSummary?: string | null;
  incrementTurn?: boolean;
};

type ActionTelemetry = {
  intent: string;
  payload?: Record<string, unknown> | null;
};

function pickString(payload: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = payload?.[key];
  if (typeof v !== 'string') return null;
  const clean = v.trim();
  return clean.length > 0 ? clean.slice(0, 120) : null;
}

function baseTurnPatch(userMessage: string, botReply: string): ConversationStatePatch {
  return {
    lastUserMessage: userMessage.slice(0, 500),
    lastBotSummary: summarizeBotReplyForMemory(botReply),
    incrementTurn: true,
  };
}

function patchFromExecutedAction(actionType: string, payload: Record<string, unknown> | null | undefined): ConversationStatePatch {
  const proveedor = pickString(payload, 'proveedor_nombre');
  const cliente = pickString(payload, 'cliente_nombre');
  const producto = pickString(payload, 'producto_nombre');

  if (actionType === 'proveedor_pago_directo' && proveedor) {
    return {
      topic: 'deuda_proveedores',
      lastIntent: 'proveedor_deuda',
      lastEntityType: 'proveedor',
      lastEntityName: proveedor,
      pendingPrompt: null,
    };
  }
  if (
    (actionType === 'cliente_cobro_directo' || actionType === 'cliente_cobro_factura') &&
    cliente
  ) {
    return {
      topic: 'deuda_clientes',
      lastIntent: 'cliente_deuda',
      lastEntityType: 'cliente',
      lastEntityName: cliente,
      pendingPrompt: null,
    };
  }
  if (actionType === 'stock_ajuste_directo' && producto) {
    return {
      topic: 'stock',
      lastIntent: 'stock_producto',
      lastEntityType: 'producto',
      lastEntityName: producto,
      pendingPrompt: null,
    };
  }
  if (actionType === 'lector_factura_confirmar_importado') {
    return {
      topic: 'stock',
      lastIntent: 'invoice_ticket_applied',
      pendingPrompt: null,
      lastEntityType: null,
      lastEntityName: null,
    };
  }

  return { pendingPrompt: null, lastIntent: `action_executed_${actionType}` };
}

export function shouldPersistActionConversationMemory(intent: string): boolean {
  return (
    intent.startsWith('action_executed_') ||
    intent === 'action_cancelled' ||
    intent === 'action_waiting_confirmation' ||
    intent === 'action_confirmation_expired'
  );
}

export function buildMemoryPatchFromAction(params: {
  telemetry: ActionTelemetry;
  userMessage: string;
  botReply: string;
}): ConversationStatePatch | null {
  const { telemetry, userMessage, botReply } = params;
  if (!shouldPersistActionConversationMemory(telemetry.intent)) return null;

  const base = baseTurnPatch(userMessage, botReply);

  if (telemetry.intent === 'action_cancelled' || telemetry.intent === 'action_confirmation_expired') {
    return {
      ...base,
      pendingPrompt: null,
      lastIntent: telemetry.intent,
    };
  }

  if (telemetry.intent === 'action_waiting_confirmation') {
    const pendingType = String(telemetry.payload?.action_type ?? '');
    const entityPatch = pendingType
      ? patchFromExecutedAction(pendingType, telemetry.payload ?? {})
      : { pendingPrompt: null };
    return {
      ...base,
      ...entityPatch,
      lastIntent: 'action_waiting_confirmation',
    };
  }

  if (telemetry.intent.startsWith('action_executed_')) {
    const actionType = telemetry.intent.slice('action_executed_'.length);
    return {
      ...base,
      ...patchFromExecutedAction(actionType, telemetry.payload ?? {}),
    };
  }

  return base;
}

export function buildMemoryPatchFromInvoiceChat(params: {
  userMessage: string;
  botReply: string;
}): ConversationStatePatch {
  const base = baseTurnPatch(params.userMessage, params.botReply);
  const text = params.userMessage
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const reply = params.botReply.toLowerCase();

  if (/^(cerrar|cancelar|cancelo)/.test(text)) {
    return {
      ...base,
      pendingPrompt: null,
      lastIntent: 'invoice_ticket_closed',
      lastOptions: [],
    };
  }

  if (/comprobante|cargada|factura cargada|importad/i.test(reply)) {
    return {
      ...base,
      topic: 'stock',
      lastIntent: 'invoice_ticket_applied',
      pendingPrompt: null,
      lastOptions: [],
    };
  }

  if (/pendientes|enlazar|buscar\s+\d+/i.test(text) || /item\s+\d+/i.test(reply)) {
    return {
      ...base,
      lastIntent: 'invoice_ticket_review',
      pendingPrompt: null,
    };
  }

  return {
    ...base,
    lastIntent: 'invoice_ticket_command',
  };
}
