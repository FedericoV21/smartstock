/**
 * Memoria conversacional por actor (WhatsApp).
 *
 * TTL corto (slots): `expires_at` — topic, intent, entidad, opciones, report cursor.
 *   Config: `WHATSAPP_CONVERSATION_TTL_MINUTES` (default 30).
 *
 * Sesión larga: `session_started_at` + `turn_count` — bienvenida y resumen de turno.
 *   Config: `WHATSAPP_CONVERSATION_SESSION_HOURS` (default 24).
 *
 * Cuando vencen los slots pero la sesión sigue activa, se conservan
 * `last_user_message`, `last_bot_summary`, `turn_count` y se limpian los slots.
 */

export type ConversationTopic = 'stock' | 'deuda_proveedores' | 'deuda_clientes' | 'ventas' | null;
export type ConversationEntityType = 'producto' | 'proveedor' | 'cliente' | null;
export type ConversationPendingPrompt = 'debt_scope' | 'report_scope' | null;
export type ConversationContactField = 'telefono' | 'mail' | 'direccion' | null;
export type ConversationReportKey =
  | 'stock_general'
  | 'stock_bajo'
  | 'deuda_clientes'
  | 'deuda_proveedores'
  | null;

export type WhatsAppConversationState = {
  topic: ConversationTopic;
  lastIntent: string | null;
  lastEntityType: ConversationEntityType;
  lastEntityName: string | null;
  pendingPrompt: ConversationPendingPrompt;
  lastOptions: string[];
  lastReportKey: ConversationReportKey;
  lastReportPage: number | null;
  lastUserMessage: string | null;
  lastBotSummary: string | null;
  lastContactField: ConversationContactField;
  turnCount: number;
  sessionStartedAt: string | null;
  expiresAt: string;
  slotsActive: boolean;
};

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function slotTtlMinutes(): number {
  const raw = Number(process.env.WHATSAPP_CONVERSATION_TTL_MINUTES ?? 30);
  if (!Number.isFinite(raw)) return 30;
  return Math.max(5, Math.min(240, Math.trunc(raw)));
}

export function sessionTtlHours(): number {
  const raw = Number(process.env.WHATSAPP_CONVERSATION_SESSION_HOURS ?? 24);
  if (!Number.isFinite(raw)) return 24;
  return Math.max(1, Math.min(168, Math.trunc(raw)));
}

function nowIso(): string {
  return new Date().toISOString();
}

function expiresAtIso(minutes = slotTtlMinutes()): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function safeTopic(value: unknown): ConversationTopic {
  const v = normalizeText(String(value ?? ''));
  if (v === 'stock') return 'stock';
  if (v === 'deuda_proveedores') return 'deuda_proveedores';
  if (v === 'deuda_clientes') return 'deuda_clientes';
  if (v === 'ventas') return 'ventas';
  return null;
}

function safeEntityType(value: unknown): ConversationEntityType {
  const v = normalizeText(String(value ?? ''));
  if (v === 'producto') return 'producto';
  if (v === 'proveedor') return 'proveedor';
  if (v === 'cliente') return 'cliente';
  return null;
}

function safePendingPrompt(value: unknown): ConversationPendingPrompt {
  const v = normalizeText(String(value ?? ''));
  if (v === 'debt_scope') return 'debt_scope';
  if (v === 'report_scope') return 'report_scope';
  return null;
}

function safeContactField(value: unknown): ConversationContactField {
  const v = normalizeText(String(value ?? ''));
  if (v === 'telefono') return 'telefono';
  if (v === 'mail') return 'mail';
  if (v === 'direccion') return 'direccion';
  return null;
}

function safeReportKey(value: unknown): ConversationReportKey {
  const v = normalizeText(String(value ?? ''));
  if (v === 'stock_general') return 'stock_general';
  if (v === 'stock_bajo') return 'stock_bajo';
  if (v === 'deuda_clientes') return 'deuda_clientes';
  if (v === 'deuda_proveedores') return 'deuda_proveedores';
  return null;
}

function safeReportPage(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const page = Math.trunc(n);
  if (page < 1) return null;
  return Math.min(page, 999);
}

function safeEntityName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (!clean) return null;
  return clean.slice(0, 120);
}

function safeIntent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (!clean) return null;
  return clean.slice(0, 80);
}

function safeTurnMessage(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (!clean) return null;
  return clean.slice(0, maxLen);
}

function safeTurnCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10_000, Math.trunc(n)));
}

function safeOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const clean = item.trim();
    if (!clean) continue;
    out.push(clean.slice(0, 140));
    if (out.length >= 10) break;
  }
  return out;
}

function areSlotsExpired(expiresAt: string): boolean {
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return true;
  return ms <= Date.now();
}

function isSessionExpired(sessionStartedAt: string | null): boolean {
  if (!sessionStartedAt) return true;
  const ms = Date.parse(sessionStartedAt);
  if (!Number.isFinite(ms)) return true;
  return Date.now() - ms > sessionTtlHours() * 3_600_000;
}

/** Primer turno de la sesión (para bienvenida opcional). */
export function isFirstTurnInSession(state: WhatsAppConversationState | null): boolean {
  if (!state) return true;
  return state.turnCount <= 0;
}

/** Helper para tests y fixtures: rellena campos v2 con defaults. */
export function conversationStateFixture(
  partial: Partial<WhatsAppConversationState> & { expiresAt?: string },
): WhatsAppConversationState {
  const expiresAt = partial.expiresAt ?? new Date(Date.now() + 30 * 60_000).toISOString();
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
    turnCount: 0,
    sessionStartedAt: new Date().toISOString(),
    slotsActive: true,
    ...partial,
    expiresAt,
  };
}

export function summarizeBotReplyForMemory(reply: string): string | null {
  const clean = reply.trim();
  if (!clean) return null;
  const firstLine = clean.split('\n').map((l) => l.trim()).find(Boolean) ?? clean;
  return firstLine.slice(0, 280);
}

export function parseConversationStateRow(row: unknown): WhatsAppConversationState | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;

  const sessionStartedAt =
    typeof r.session_started_at === 'string' && r.session_started_at.trim()
      ? r.session_started_at
      : null;

  if (isSessionExpired(sessionStartedAt)) return null;

  const expiresAt = String(r.expires_at ?? '');
  const slotsActive = !areSlotsExpired(expiresAt);

  const sessionFields = {
    lastUserMessage: safeTurnMessage(r.last_user_message, 500),
    lastBotSummary: safeTurnMessage(r.last_bot_summary, 280),
    lastContactField: safeContactField(r.last_contact_field),
    turnCount: safeTurnCount(r.turn_count),
    sessionStartedAt,
    expiresAt: slotsActive ? expiresAt : expiresAtIso(),
    slotsActive,
  };

  if (!slotsActive) {
    return {
      topic: null,
      lastIntent: null,
      lastEntityType: null,
      lastEntityName: null,
      pendingPrompt: null,
      lastOptions: [],
      lastReportKey: null,
      lastReportPage: null,
      ...sessionFields,
    };
  }

  return {
    topic: safeTopic(r.topic),
    lastIntent: safeIntent(r.last_intent),
    lastEntityType: safeEntityType(r.last_entity_type),
    lastEntityName: safeEntityName(r.last_entity_name),
    pendingPrompt: safePendingPrompt(r.pending_prompt),
    lastOptions: safeOptions(r.last_options),
    lastReportKey: safeReportKey(r.last_report_key),
    lastReportPage: safeReportPage(r.last_report_page),
    ...sessionFields,
  };
}

export async function loadWhatsAppConversationState(params: {
  db: any;
  tenantId: string;
  actorId: string;
}): Promise<WhatsAppConversationState | null> {
  const { db, tenantId, actorId } = params;
  const { data, error } = await db
    .from('whatsapp_conversation_state' as any)
    .select(
      'topic, last_intent, last_entity_type, last_entity_name, pending_prompt, last_options, last_report_key, last_report_page, last_user_message, last_bot_summary, last_contact_field, turn_count, session_started_at, expires_at',
    )
    .eq('tenant_id', tenantId)
    .eq('actor_id', actorId)
    .maybeSingle();

  if (error) {
    console.error('[wa-conversation-memory] load error', {
      tenantId,
      actorId,
      error: error.message,
    });
    return null;
  }

  return parseConversationStateRow(data);
}

export async function saveWhatsAppConversationState(params: {
  db: any;
  tenantId: string;
  actorId: string;
  fromWaId: string;
  patch: {
    topic?: ConversationTopic;
    lastIntent?: string | null;
    lastEntityType?: ConversationEntityType;
    lastEntityName?: string | null;
    pendingPrompt?: ConversationPendingPrompt;
    lastOptions?: string[];
    lastReportKey?: ConversationReportKey;
    lastReportPage?: number | null;
    lastUserMessage?: string | null;
    lastBotSummary?: string | null;
    lastContactField?: ConversationContactField;
    incrementTurn?: boolean;
  };
}): Promise<void> {
  const { db, tenantId, actorId, fromWaId, patch } = params;

  const current = await loadWhatsAppConversationState({ db, tenantId, actorId });
  const newSession = !current;
  const sessionStartedAt = newSession ? nowIso() : current?.sessionStartedAt ?? nowIso();
  const turnCount = patch.incrementTurn
    ? (current?.turnCount ?? 0) + 1
    : current?.turnCount ?? 0;

  const next = {
    topic: patch.topic !== undefined ? patch.topic : current?.topic ?? null,
    last_intent:
      patch.lastIntent !== undefined ? safeIntent(patch.lastIntent) : current?.lastIntent ?? null,
    last_entity_type:
      patch.lastEntityType !== undefined
        ? patch.lastEntityType
        : current?.lastEntityType ?? null,
    last_entity_name:
      patch.lastEntityName !== undefined
        ? safeEntityName(patch.lastEntityName)
        : current?.lastEntityName ?? null,
    pending_prompt:
      patch.pendingPrompt !== undefined
        ? patch.pendingPrompt
        : current?.pendingPrompt ?? null,
    last_options: patch.lastOptions !== undefined ? safeOptions(patch.lastOptions) : current?.lastOptions ?? [],
    last_report_key:
      patch.lastReportKey !== undefined ? safeReportKey(patch.lastReportKey) : current?.lastReportKey ?? null,
    last_report_page:
      patch.lastReportPage !== undefined ? safeReportPage(patch.lastReportPage) : current?.lastReportPage ?? null,
    last_user_message:
      patch.lastUserMessage !== undefined
        ? safeTurnMessage(patch.lastUserMessage, 500)
        : current?.lastUserMessage ?? null,
    last_bot_summary:
      patch.lastBotSummary !== undefined
        ? safeTurnMessage(patch.lastBotSummary, 280)
        : current?.lastBotSummary ?? null,
    last_contact_field:
      patch.lastContactField !== undefined
        ? patch.lastContactField
        : current?.lastContactField ?? null,
    turn_count: turnCount,
    session_started_at: sessionStartedAt,
  };

  const { error } = await db.from('whatsapp_conversation_state' as any).upsert(
    {
      actor_id: actorId,
      tenant_id: tenantId,
      from_wa_id: fromWaId,
      topic: next.topic,
      last_intent: next.last_intent,
      last_entity_type: next.last_entity_type,
      last_entity_name: next.last_entity_name,
      pending_prompt: next.pending_prompt,
      last_options: next.last_options,
      last_report_key: next.last_report_key,
      last_report_page: next.last_report_page,
      last_user_message: next.last_user_message,
      last_bot_summary: next.last_bot_summary,
      last_contact_field: next.last_contact_field,
      turn_count: next.turn_count,
      session_started_at: next.session_started_at,
      expires_at: expiresAtIso(),
      updated_at: nowIso(),
    },
    { onConflict: 'actor_id' },
  );

  if (error) {
    console.error('[wa-conversation-memory] save error', {
      tenantId,
      actorId,
      error: error.message,
    });
  }
}
