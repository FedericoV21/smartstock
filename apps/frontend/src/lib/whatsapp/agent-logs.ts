export type WhatsAppAgentLogChannel = 'live' | 'sandbox';
export type WhatsAppAgentLogStatus = 'success' | 'fallback' | 'error' | 'blocked';

export type WhatsAppToolTrace = {
  name: string;
  args: Record<string, unknown>;
  status: 'success' | 'error';
  durationMs: number;
  result?: unknown;
  error?: string | null;
};

export type WhatsAppAgentTurnLogInput = {
  tenantId: string;
  actorId?: string | null;
  usuarioId?: string | null;
  inboundMessageId?: string | null;
  actionLogId?: string | null;
  fromWaId?: string | null;
  channel: WhatsAppAgentLogChannel;
  source: 'webhook_text' | 'audio_stt' | 'sandbox_text';
  inputBody: string;
  resolvedMessage?: string | null;
  replies?: unknown;
  intent?: string | null;
  confidence?: number | null;
  fallbackReason?: string | null;
  status: WhatsAppAgentLogStatus;
  toolName?: string | null;
  toolArgs?: unknown;
  toolResult?: unknown;
  toolTrace?: WhatsAppToolTrace | null;
  processingTrace?: unknown;
  durationMs?: number | null;
  errorDetail?: string | null;
};

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|passwd|authorization|otp|hash|salt|signature|access_token|refresh_token|api_key|apikey|raw_payload|rawpayload|meta_payload)/i;
const MAX_STRING_LENGTH = 20_000;
const MAX_ARRAY_LENGTH = 100;
const MAX_OBJECT_KEYS = 80;
const MAX_DEPTH = 8;

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
}

function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[max-depth]';

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeForLog(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeForLog(item, depth + 1);
    }
    return out;
  }

  return String(value);
}

function isUuid(value: string | null | undefined): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function clampConfidence(value: number | null | undefined): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function normalizeReplies(value: unknown): { replies: unknown; replyBody: string | null } {
  const replies = Array.isArray(value) ? value : [];
  const replyBody = replies
    .map((reply) => {
      if (!reply || typeof reply !== 'object') return '';
      const body = (reply as { body?: unknown }).body;
      return typeof body === 'string' ? body.trim() : '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return {
    replies: sanitizeForLog(replies),
    replyBody: replyBody ? truncateString(replyBody) : null,
  };
}

export async function recordWhatsAppAgentTurnLog(params: {
  db: any;
  log: WhatsAppAgentTurnLogInput;
}): Promise<void> {
  const { db, log } = params;
  const { replies, replyBody } = normalizeReplies(log.replies);
  const toolTrace = log.toolTrace ? (sanitizeForLog(log.toolTrace) as WhatsAppToolTrace) : null;
  const toolArgs = log.toolArgs !== undefined ? sanitizeForLog(log.toolArgs) : toolTrace?.args ?? null;
  const toolResult =
    log.toolResult !== undefined
      ? sanitizeForLog(log.toolResult)
      : toolTrace && 'result' in toolTrace
        ? sanitizeForLog(toolTrace.result)
        : null;

  const payload = {
    tenant_id: log.tenantId,
    actor_id: isUuid(log.actorId) ? log.actorId : null,
    usuario_id: isUuid(log.usuarioId) ? log.usuarioId : null,
    inbound_message_id: isUuid(log.inboundMessageId) ? log.inboundMessageId : null,
    action_log_id: isUuid(log.actionLogId) ? log.actionLogId : null,
    from_wa_id: log.fromWaId?.trim() || null,
    channel: log.channel,
    source: log.source,
    input_body: truncateString(log.inputBody),
    resolved_message: log.resolvedMessage ? truncateString(log.resolvedMessage) : null,
    reply_body: replyBody,
    replies,
    intent: log.intent?.trim() || null,
    confidence: clampConfidence(log.confidence),
    fallback_reason: log.fallbackReason?.trim() || null,
    status: log.status,
    tool_name: log.toolName?.trim() || toolTrace?.name || null,
    tool_args: toolArgs,
    tool_result: toolResult,
    tool_trace: toolTrace,
    processing_trace: sanitizeForLog(log.processingTrace ?? {}),
    duration_ms: Number.isFinite(Number(log.durationMs)) ? Math.max(0, Math.trunc(Number(log.durationMs))) : null,
    error_detail: log.errorDetail ? truncateString(log.errorDetail) : null,
  };

  const { error } = await db.from('whatsapp_agent_turn_log' as any).insert(payload);
  if (error) {
    console.error('[wa-agent-turn-log] insert error', {
      tenantId: log.tenantId,
      actorId: log.actorId ?? null,
      intent: log.intent ?? null,
      toolName: payload.tool_name,
      error: error.message,
    });
  }
}
