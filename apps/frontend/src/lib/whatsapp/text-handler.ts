import { handleWhatsAppActionMessage } from '@/lib/whatsapp/action-handler';
import {
  loadWhatsAppConversationState,
  saveWhatsAppConversationState,
  summarizeBotReplyForMemory,
  type ConversationEntityType,
  type ConversationTopic,
  type WhatsAppConversationState,
} from '@/lib/whatsapp/conversation-memory';
import {
  extractDebtFollowupTarget,
  resolveFollowupFromConversationMemory,
} from '@/lib/whatsapp/conversation-followup-memory';
import { loadWhatsAppCapabilitiesCatalog } from '@/lib/whatsapp/capabilities-catalog';
import {
  buildMemoryPatchFromAction,
  buildMemoryPatchFromInvoiceChat,
} from '@/lib/whatsapp/conversation-persistence';
import { resolveConversationMessage } from '@/lib/whatsapp/conversation-resolver';
import { appendSuggestNextStep } from '@/lib/whatsapp/suggest-next-step';

export { extractDebtFollowupTarget, resolveFollowupFromConversationMemory };
import {
  findPreferredWhatsAppActor,
  findWhatsAppActorById,
  reconcileWhatsAppActorWaId,
} from '@/lib/whatsapp/actor-lookup';
import {
  handleWhatsAppBranchConfirmationReply,
  tryAcknowledgeBranchReplyBeforeAttachment,
} from '@/lib/whatsapp/branch-confirmation';
import { getWhatsAppAgentFeatureFlag, isWhatsAppV2EnabledForActor } from '@/lib/whatsapp/feature-flag';
import { handleWhatsAppInvoiceTicketChatCommand } from '@/lib/whatsapp/sandbox';
import { processWhatsAppOutboundQueue } from '@/lib/whatsapp/outbound-worker';
import { runWhatsAppReadOnlyAgent } from '@/lib/whatsapp/read-only-agent';
import { recordWhatsAppAgentTurnLog, type WhatsAppToolTrace } from '@/lib/whatsapp/agent-logs';

type EntityContactField = 'telefono' | 'email' | 'direccion' | 'contacto';

type DisambiguationKind =
  | 'proveedor'
  | 'cliente'
  | 'cliente_contacto'
  | 'cliente_contacto_telefono'
  | 'cliente_contacto_email'
  | 'cliente_contacto_direccion'
  | 'proveedor_contacto'
  | 'proveedor_contacto_telefono'
  | 'proveedor_contacto_email'
  | 'proveedor_contacto_direccion'
  | 'producto';

type DisambiguationPrompt = {
  kind: DisambiguationKind;
  options: string[];
};

type OutboundEnqueueOptions = {
  messageType?: 'text' | 'document';
  documentLink?: string | null;
  documentFilename?: string | null;
  documentCaption?: string | null;
};

export type WhatsAppTextHandlerMode = 'live' | 'sandbox';

export type WhatsAppTextHandlerReply = {
  body: string;
  messageType: 'text' | 'document';
  documentLink: string | null;
  documentFilename: string | null;
  documentCaption: string | null;
};

export type WhatsAppTextHandlerResult = {
  replies: WhatsAppTextHandlerReply[];
};

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseDisambiguationPrompt(body: string): DisambiguationPrompt | null {
  const normalized = normalizeText(body);
  if (!normalized.includes('encontre varios')) return null;
  if (!normalized.includes('parecidos')) return null;

  let kind: DisambiguationKind | null = null;
  if (normalized.includes('proveedores')) kind = 'proveedor';
  if (kind === 'proveedor' && /\b(telefono|numero|celular|whatsapp)\b/.test(normalized)) {
    kind = 'proveedor_contacto_telefono';
  } else if (kind === 'proveedor' && /\b(mail|email|correo)\b/.test(normalized)) {
    kind = 'proveedor_contacto_email';
  } else if (kind === 'proveedor' && /\b(direccion|domicilio)\b/.test(normalized)) {
    kind = 'proveedor_contacto_direccion';
  } else if (kind === 'proveedor' && /\b(contacto|contactos)\b/.test(normalized)) {
    kind = 'proveedor_contacto';
  }
  if (normalized.includes('clientes')) kind = 'cliente';
  if (kind === 'cliente' && /\b(telefono|numero|celular|whatsapp)\b/.test(normalized)) {
    kind = 'cliente_contacto_telefono';
  } else if (kind === 'cliente' && /\b(mail|email|correo)\b/.test(normalized)) {
    kind = 'cliente_contacto_email';
  } else if (kind === 'cliente' && /\b(direccion|domicilio)\b/.test(normalized)) {
    kind = 'cliente_contacto_direccion';
  } else if (kind === 'cliente' && /\b(contacto|contactos)\b/.test(normalized)) {
    kind = 'cliente_contacto';
  }
  if (normalized.includes('productos')) kind = 'producto';
  if (!kind) return null;

  const options = body
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*\d+\)\s+(.+)\s*$/)?.[1]?.trim() ?? null)
    .filter((item): item is string => Boolean(item));

  if (options.length === 0) return null;
  return { kind, options };
}

function selectionIndexFromReply(reply: string, optionCount: number): number | null {
  const text = normalizeText(reply);
  const direct = text.match(/^(?:opcion\s*)?(\d{1,2})$/);
  if (direct) {
    const idx = Number(direct[1]) - 1;
    if (idx >= 0 && idx < optionCount) return idx;
  }

  if (/^(?:el|la)?\s*primer[oa]$/.test(text) && optionCount >= 1) return 0;
  if (/^(?:el|la)?\s*segund[oa]$/.test(text) && optionCount >= 2) return 1;
  if (/^(?:el|la)?\s*tercer[oa]$/.test(text) && optionCount >= 3) return 2;
  if (/^(?:el|la)?\s*cuart[oa]$/.test(text) && optionCount >= 4) return 3;
  if (/^(?:el|la)?\s*quint[oa]$/.test(text) && optionCount >= 5) return 4;

  return null;
}

function resolveOptionByName(reply: string, options: string[]): string | null {
  const text = normalizeText(reply);
  if (text.length < 3) return null;
  const exact = options.find((opt) => normalizeText(opt) === text);
  if (exact) return exact;
  const partial = options.find((opt) => normalizeText(opt).includes(text));
  if (partial) return partial;
  return null;
}

function extractReportPdfFromReply(reply: string): { cleanedReply: string; pdfLink: string | null } {
  const lines = reply.split(/\r?\n/);
  let pdfLink: string | null = null;
  const kept: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*pdf\s+completo:\s*(https?:\/\/\S+)\s*$/i);
    if (match?.[1]) {
      pdfLink = match[1].trim();
      continue;
    }
    kept.push(line);
  }
  const cleanedReply = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { cleanedReply, pdfLink };
}

function filenameFromPdfLink(link: string): string {
  try {
    const u = new URL(link);
    const segments = u.pathname.split('/').filter(Boolean);
    const last = decodeURIComponent(segments[segments.length - 1] ?? '').trim();
    if (last.toLowerCase().endsWith('.pdf')) return last;
  } catch {
    /* ignore */
  }
  return `reporte-smartstock-${new Date().toISOString().slice(0, 10)}.pdf`;
}

function buildClarifiedQuery(kind: DisambiguationKind, option: string): string {
  if (kind === 'proveedor') return `cuanto le debo a ${option}`;
  if (kind === 'cliente') return `cuanto me debe ${option}`;
  if (kind === 'cliente_contacto_telefono') return `telefono de cliente ${option}`;
  if (kind === 'cliente_contacto_email') return `email de cliente ${option}`;
  if (kind === 'cliente_contacto_direccion') return `direccion de cliente ${option}`;
  if (kind === 'cliente_contacto') return `datos de contacto de cliente ${option}`;
  if (kind === 'proveedor_contacto_telefono') return `telefono de proveedor ${option}`;
  if (kind === 'proveedor_contacto_email') return `email de proveedor ${option}`;
  if (kind === 'proveedor_contacto_direccion') return `direccion de proveedor ${option}`;
  if (kind === 'proveedor_contacto') return `datos de contacto de proveedor ${option}`;
  const cleaned = option.replace(/\s+\([^)]*\)\s*$/, '').trim();
  return `stock de ${cleaned || option}`;
}

function stripTrailingContext(value: string): string {
  return value
    .replace(/[,;]\s*(?:que|porque|para|necesito|quiero)\b.*$/gi, '')
    .replace(/\s+(?:que\s+)?(?:necesito|quiero)\b.*$/gi, '')
    .replace(/\s+(?:porque|ya\s+que)\b.*$/gi, '')
    .replace(/\s+para\s+(?:llamar|contactar|avisar|escribir)\w*\b.*$/gi, '')
    .replace(/\b(hoy|ahora|por favor|gracias)\b/gi, '')
    .replace(/[?.!,:;]+$/g, '')
    .trim();
}


function topicFromIntent(intent: string, fallbackTopic: ConversationTopic): ConversationTopic {
  if (intent === 'proveedor_deuda' || intent === 'reporte_deuda_proveedores') return 'deuda_proveedores';
  if (
    intent === 'cliente_deuda' ||
    intent === 'cliente_extracto_cc' ||
    intent === 'cliente_contacto' ||
    intent === 'reporte_deuda_clientes'
  )
    return 'deuda_clientes';
  if (intent === 'proveedor_contacto') return 'deuda_proveedores';
  if (
    intent === 'stock_producto' ||
    intent === 'stock_mas_bajo' ||
    intent === 'reporte_stock_general' ||
    intent === 'reporte_stock_bajo'
  )
    return 'stock';
  if (
    intent === 'reporte_ventas' ||
    intent === 'reporte_ventas_productos' ||
    intent === 'reporte_ventas_articulo' ||
    intent === 'reporte_ventas_clientes' ||
    intent === 'reporte_ganancias' ||
    intent === 'reporte_medios_pago' ||
    intent === 'reporte_comparativo_ventas'
  )
    return 'ventas';
  return fallbackTopic;
}

function extractEntityFromResolvedMessage(params: {
  intent: string;
  message: string;
}): { type: ConversationEntityType; name: string | null } {
  const { intent, message } = params;
  const text = message.trim();
  if (!text) return { type: null, name: null };

  const capture = (rx: RegExp): string | null => {
    const match = text.match(rx);
    const target = stripTrailingContext(match?.[1] ?? '');
    return target || null;
  };

  if (intent === 'proveedor_deuda') {
    return {
      type: 'proveedor',
      name:
        capture(/(?:cuanto|cuánto)\s+le\s+debo\s+a\s+(?:proveedor\s+)?(.+)/i) ??
        capture(/deuda\s+del?\s+proveedor\s+(.+)/i),
    };
  }

  if (intent === 'cliente_deuda') {
    return {
      type: 'cliente',
      name:
        capture(/(?:cuanto|cuánto)\s+me\s+debe\s+(?:el\s+cliente\s+)?(.+)/i) ??
        capture(/deuda\s+del?\s+cliente\s+(.+)/i),
    };
  }

  if (intent === 'cliente_extracto_cc') {
    return {
      type: 'cliente',
      name:
        capture(/\bextracto\s+(?:de\s+)?(?:la\s+)?cuenta\s+corriente\s+(?:del?\s+)?(?:cliente\s+)?(.+)/i) ??
        capture(/\bmovimientos?\s+(?:de\s+)?(?:la\s+)?cuenta\s+corriente\s+(?:del?\s+)?(?:cliente\s+)?(.+)/i) ??
        capture(/\bcuenta\s+corriente\s+de\s+(?!cliente\b)(.+)/i),
    };
  }

  if (intent === 'cliente_contacto') {
    return {
      type: 'cliente',
      name:
        capture(/(?:telefono|tel|celular|whatsapp|numero|nro)\s+(?:del?\s+cliente\s+|de\s+cliente\s+|de\s+)?(.+)/i) ??
        capture(/(?:mail|email|e-mail|correo)\s+(?:del?\s+cliente\s+|de\s+cliente\s+|de\s+)?(.+)/i) ??
        capture(/(?:direccion|domicilio)\s+(?:del?\s+cliente\s+|de\s+cliente\s+|de\s+)?(.+)/i) ??
        capture(/(?:datos?\s+de\s+contacto|contacto)\s+(?:del?\s+cliente\s+|de\s+cliente\s+|de\s+)?(.+)/i),
    };
  }

  if (intent === 'proveedor_contacto') {
    return {
      type: 'proveedor',
      name:
        capture(/(?:telefono|tel|celular|whatsapp|numero|nro)\s+(?:del?\s+proveedor\s+|de\s+proveedor\s+|proveedor\s+)(.+)/i) ??
        capture(/(?:mail|email|e-mail|correo)\s+(?:del?\s+proveedor\s+|de\s+proveedor\s+|proveedor\s+)(.+)/i) ??
        capture(/(?:direccion|domicilio)\s+(?:del?\s+proveedor\s+|de\s+proveedor\s+|proveedor\s+)(.+)/i) ??
        capture(/(?:datos?\s+de\s+contacto|contacto)\s+(?:del?\s+proveedor\s+|de\s+proveedor\s+)(.+)/i),
    };
  }

  if (intent === 'stock_producto') {
    return {
      type: 'producto',
      name:
        capture(/(?:cuanto|cuánto)\s+(?:stock\s+)?tengo(?:\s+de)?\s+(.+)/i) ??
        capture(/stock(?:\s+de)?\s+(.+)/i),
    };
  }

  return { type: null, name: null };
}

async function resolveDisambiguationReply(params: {
  db: any;
  tenantId: string;
  fromWaId: string;
  text: string;
}): Promise<{ message: string; interpreted: boolean }> {
  const { db, tenantId, fromWaId, text } = params;
  const compact = normalizeText(text);
  if (!compact) return { message: text, interpreted: false };

  const { data: recentOutbound } = await db
    .from('whatsapp_outbound_message' as any)
    .select('body, created_at')
    .eq('tenant_id', tenantId)
    .eq('to_wa_id', fromWaId)
    .order('created_at', { ascending: false })
    .limit(6);

  const rows = (recentOutbound ?? []) as Array<{ body: string; created_at: string | null }>;
  const now = Date.now();
  for (const row of rows) {
    if (!row.body) continue;
    const createdAt = row.created_at ? new Date(row.created_at).getTime() : Number.NaN;
    if (Number.isFinite(createdAt) && now - createdAt > 20 * 60 * 1000) continue;

    const prompt = parseDisambiguationPrompt(row.body);
    if (!prompt) continue;

    const idx = selectionIndexFromReply(text, prompt.options.length);
    if (idx != null) {
      const choice = prompt.options[idx];
      return {
        message: buildClarifiedQuery(prompt.kind, choice),
        interpreted: true,
      };
    }

    const byName = resolveOptionByName(text, prompt.options);
    if (byName) {
      return {
        message: buildClarifiedQuery(prompt.kind, byName),
        interpreted: true,
      };
    }

    return { message: text, interpreted: false };
  }

  return { message: text, interpreted: false };
}

function insertedOutboundIds(data: unknown): string[] {
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
  return rows.map((row: any) => String(row?.id ?? '').trim()).filter(Boolean);
}

export async function handleWhatsAppTextMessage(params: {
  db: any;
  tenantId: string;
  fromWaId: string;
  phoneNumberId: string | null;
  inboundMessageId: string;
  wamid?: string | null;
  textBody: string;
  source: 'webhook_text' | 'audio_stt' | 'sandbox_text';
  mode?: WhatsAppTextHandlerMode;
  actionMode?: 'execute' | 'simulate';
  sandboxUserId?: string | null;
  resolvedActorId?: string | null;
}): Promise<WhatsAppTextHandlerResult> {
  const { db, tenantId, fromWaId, phoneNumberId, inboundMessageId, wamid, textBody, source } = params;
  const resolvedActorId = String(params.resolvedActorId ?? '').trim() || null;
  const mode = params.mode ?? 'live';
  const actionMode = params.actionMode ?? (mode === 'sandbox' ? 'simulate' : 'execute');
  const sandboxUserId = params.sandboxUserId ?? null;
  const capturedReplies: WhatsAppTextHandlerReply[] = [];
  const enqueuedOutboundIds: string[] = [];
  const turnStartedAt = Date.now();
  const finish = () => ({ replies: capturedReplies });

  const shouldAutoFlushOutbound = () => {
    const raw = (process.env.WHATSAPP_AUTO_FLUSH_OUTBOUND ?? '').trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes') return true;
    if (raw === '0' || raw === 'false' || raw === 'no') return false;
    return mode === 'live';
  };

  const enqueueOutbound = async (body: string, options?: OutboundEnqueueOptions) => {
    const messageType = options?.messageType ?? 'text';
    capturedReplies.push({
      body,
      messageType,
      documentLink: messageType === 'document' ? String(options?.documentLink ?? '').trim() || null : null,
      documentFilename:
        messageType === 'document' ? String(options?.documentFilename ?? '').trim() || null : null,
      documentCaption:
        messageType === 'document' ? String(options?.documentCaption ?? '').trim() || null : null,
    });

    if (mode === 'sandbox') {
      return;
    }

    const fullPayload = {
      tenant_id: tenantId,
      to_wa_id: fromWaId,
      phone_number_id: phoneNumberId,
      body,
      message_type: messageType,
      document_link: messageType === 'document' ? String(options?.documentLink ?? '').trim() || null : null,
      document_filename:
        messageType === 'document' ? String(options?.documentFilename ?? '').trim() || null : null,
      document_caption:
        messageType === 'document' ? String(options?.documentCaption ?? '').trim() || null : null,
      status: 'queued',
    };

    const outboundIds: string[] = [];
    const fullInsert = await db.from('whatsapp_outbound_message' as any).insert(fullPayload).select('id');
    if (fullInsert?.error) {
      const errorMessage = String(fullInsert.error.message ?? '');
      const missingColumn =
        /message_type|document_link|document_filename|document_caption/i.test(errorMessage);

      if (!missingColumn) {
        throw new Error(errorMessage);
      }

      const fallbackBody =
        messageType === 'document' && String(options?.documentLink ?? '').trim()
          ? `${String(options?.documentCaption ?? 'Reporte PDF')}\n${String(options?.documentLink ?? '').trim()}`
          : body;

      const fallbackInsert = await db
        .from('whatsapp_outbound_message' as any)
        .insert({
          tenant_id: tenantId,
          to_wa_id: fromWaId,
          phone_number_id: phoneNumberId,
          body: fallbackBody,
          status: 'queued',
        })
        .select('id');
      if (fallbackInsert?.error) {
        throw new Error(String(fallbackInsert.error.message ?? 'No se pudo encolar mensaje outbound.'));
      }
      outboundIds.push(...insertedOutboundIds(fallbackInsert.data));
    } else {
      outboundIds.push(...insertedOutboundIds(fullInsert.data));
    }

    if (shouldAutoFlushOutbound() && outboundIds.length > 0) {
      try {
        await processWhatsAppOutboundQueue({ db, tenantId, limit: 20, messageIds: outboundIds });
      } catch (e) {
        console.error('[wa-readonly-agent] outbound auto flush error', {
          tenantId,
          inboundMessageId,
          fromWaId,
          error: (e as Error).message,
        });
      }
    }
    enqueuedOutboundIds.push(...outboundIds);
  };

  const text = textBody.trim();
  if (!text) return finish();

  const logTurn = async (patch: {
    actorId?: string | null;
    usuarioId?: string | null;
    actionLogId?: string | null;
    resolvedMessage?: string | null;
    intent?: string | null;
    confidence?: number | null;
    fallbackReason?: string | null;
    status: 'success' | 'fallback' | 'error' | 'blocked';
    toolName?: string | null;
    toolArgs?: unknown;
    toolResult?: unknown;
    toolTrace?: WhatsAppToolTrace | null;
    processingTrace?: unknown;
    errorDetail?: string | null;
  }) => {
    await recordWhatsAppAgentTurnLog({
      db,
      log: {
        tenantId,
        actorId: patch.actorId,
        usuarioId: patch.usuarioId,
        inboundMessageId,
        actionLogId: patch.actionLogId,
        fromWaId,
        channel: mode === 'sandbox' ? 'sandbox' : 'live',
        source,
        inputBody: text,
        resolvedMessage: patch.resolvedMessage,
        replies: capturedReplies,
        intent: patch.intent,
        confidence: patch.confidence,
        fallbackReason: patch.fallbackReason,
        status: patch.status,
        toolName: patch.toolName,
        toolArgs: patch.toolArgs,
        toolResult: patch.toolResult,
        toolTrace: patch.toolTrace,
        processingTrace: {
          outbound_message_ids: enqueuedOutboundIds,
          ...((patch.processingTrace && typeof patch.processingTrace === 'object' && !Array.isArray(patch.processingTrace))
            ? (patch.processingTrace as Record<string, unknown>)
            : { detail: patch.processingTrace ?? null }),
        },
        durationMs: Date.now() - turnStartedAt,
        errorDetail: patch.errorDetail,
      },
    });
  };

  if (mode === 'live' && source === 'webhook_text') {
    const branchResult = await handleWhatsAppBranchConfirmationReply({
      db,
      tenantId,
      fromWaId,
      phoneNumberId,
      textBody: text,
    });
    if (branchResult.handled && branchResult.ackMessage) {
      await enqueueOutbound(branchResult.ackMessage);
      await logTurn({
        intent: 'branch_confirmation',
        confidence: 1,
        status: 'success',
        resolvedMessage: text,
        processingTrace: { confirmed_job_ids: branchResult.confirmedJobIds },
      });
      return finish();
    }

    const earlyBranch = await tryAcknowledgeBranchReplyBeforeAttachment({
      db,
      tenantId,
      fromWaId,
      phoneNumberId,
      textBody: text,
    });
    if (earlyBranch.handled && earlyBranch.ackMessage) {
      await enqueueOutbound(earlyBranch.ackMessage);
      await logTurn({
        intent: 'branch_reply_buffered',
        confidence: 1,
        status: 'success',
        resolvedMessage: text,
        processingTrace: { branch_id: earlyBranch.branchId },
      });
      return finish();
    }
  }

  const featureFlag =
    mode === 'sandbox'
      ? { enabled: true, rolloutStage: 'v2', notes: 'sandbox' }
      : await getWhatsAppAgentFeatureFlag(db, tenantId);
  if (!featureFlag.enabled) {
    if (source === 'webhook_text') {
      await enqueueOutbound(
        'El canal de consultas por WhatsApp todavía no está habilitado para este negocio.',
      );
    }
    console.info('[wa-readonly-agent]', {
      tenantId,
      inboundMessageId,
      fromWaId,
      source,
      intent: 'feature_flag_disabled',
      confidence: 1,
      tool: null,
      fallbackReason: 'whatsapp_agent_feature_disabled',
    });
    await logTurn({
      intent: 'feature_flag_disabled',
      confidence: 1,
      fallbackReason: 'whatsapp_agent_feature_disabled',
      status: 'blocked',
      processingTrace: {
        feature_flag: featureFlag,
      },
    });
    return finish();
  }

  let actorRow: Awaited<ReturnType<typeof findPreferredWhatsAppActor>> = null;
  try {
    if (resolvedActorId) {
      actorRow = await findWhatsAppActorById({
        db,
        tenantId,
        actorId: resolvedActorId,
      });
    }
    if (!actorRow) {
      actorRow = await findPreferredWhatsAppActor({
        db,
        tenantId,
        fromWaId,
      });
    }
  } catch (error) {
    console.error('[wa-readonly-agent] actor lookup error', {
      tenantId,
      fromWaId,
      inboundMessageId,
      source,
      error: (error as Error).message,
    });
    await logTurn({
      intent: 'actor_lookup_error',
      confidence: 1,
      status: 'error',
      fallbackReason: 'actor_lookup_error',
      errorDetail: (error as Error).message,
    });
    return finish();
  }

  const actor = actorRow
    ? {
        id: String(actorRow.id),
        usuario_id: String(actorRow.usuario_id ?? ''),
        trust_level: String(actorRow.trust_level ?? ''),
        rol_whatsapp: actorRow.rol_whatsapp ?? null,
        from_wa_id: String(actorRow.from_wa_id ?? ''),
      }
    : null;

  const trustLevel = String(actor?.trust_level ?? '');
  const needsVerification = !actor?.id || trustLevel === 'unverified';
  const isBlocked = trustLevel === 'blocked';

  if (needsVerification || isBlocked) {
    const body = isBlocked
      ? 'Tu numero de WhatsApp esta temporalmente bloqueado para consultas. Pedile a un administrador que vuelva a verificar la vinculacion.'
      : 'Tu numero todavia no esta vinculado/verificado en SmartStock. Pedile a un administrador del negocio que complete la vinculacion por OTP en la bandeja de WhatsApp.';

    await enqueueOutbound(body);

    console.info('[wa-readonly-agent]', {
      tenantId,
      inboundMessageId,
      fromWaId,
      source,
      actorId: actor?.id ?? null,
      trustLevel: trustLevel || null,
      intent: 'verification_required',
      confidence: 1,
      tool: null,
      fallbackReason: isBlocked ? 'blocked_actor' : 'actor_unverified',
    });
    await logTurn({
      actorId: actor?.id ?? null,
      usuarioId: actor?.usuario_id || null,
      intent: 'verification_required',
      confidence: 1,
      fallbackReason: isBlocked ? 'blocked_actor' : 'actor_unverified',
      status: 'blocked',
      processingTrace: {
        trust_level: trustLevel || null,
        actor_found: Boolean(actor?.id),
      },
    });
    return finish();
  }

  const actorId = String(actor.id);
  try {
    await reconcileWhatsAppActorWaId({
      db,
      tenantId,
      actorId,
      inboundFromWaId: fromWaId,
    });
  } catch (error) {
    console.error('[wa-readonly-agent] actor wa_id reconcile error', {
      tenantId,
      actorId,
      fromWaId,
      error: (error as Error).message,
    });
  }

  const v2Enabled = isWhatsAppV2EnabledForActor(featureFlag, `${tenantId}:${fromWaId}:${actorId}`);
  const capabilitiesCatalog = v2Enabled
    ? await loadWhatsAppCapabilitiesCatalog({
        db,
        tenantId,
        rolWhatsapp: String(actor.rol_whatsapp ?? 'operador'),
        channel: mode === 'sandbox' ? 'sandbox' : 'live',
      })
    : null;
  const conversationState = await loadWhatsAppConversationState({
    db,
    tenantId,
    actorId,
  });

  const persistConversationPatch = async (patch: Parameters<typeof saveWhatsAppConversationState>[0]['patch']) => {
    await saveWhatsAppConversationState({
      db,
      tenantId,
      actorId,
      fromWaId,
      patch,
    });
  };

  if (source === 'webhook_text' || source === 'sandbox_text') {
    try {
      const invoiceTicket = await handleWhatsAppInvoiceTicketChatCommand({
        db,
        tenantId,
        userId: String(actor.usuario_id),
        actorId,
        fromWaId,
        actorRole: String(actor.rol_whatsapp ?? 'operador'),
        content: text,
        writeSandboxMessage: false,
      });

      if (invoiceTicket.handled) {
        for (const reply of invoiceTicket.replies) {
          await enqueueOutbound(reply.body, {
            messageType: reply.messageType,
            documentLink: reply.documentLink,
            documentFilename: reply.documentFilename,
            documentCaption: reply.documentCaption,
          });
        }

        console.info('[wa-invoice-ticket-agent]', {
          tenantId,
          inboundMessageId,
          fromWaId,
          source,
          actorId: actor.id,
          intent: 'invoice_ticket_command',
          confidence: 1,
          tool: 'lector_factura_ticket',
          fallbackReason: null,
        });
        const invoiceReplyBody = invoiceTicket.replies.map((r) => r.body).join('\n');
        const invoicePatch = buildMemoryPatchFromInvoiceChat({
          userMessage: text,
          botReply: invoiceReplyBody,
        });
        await persistConversationPatch(invoicePatch);

        await logTurn({
          actorId: actor.id,
          usuarioId: String(actor.usuario_id),
          intent: 'invoice_ticket_command',
          confidence: 1,
          toolName: 'lector_factura_ticket',
          toolArgs: { content: text, actorRole: String(actor.rol_whatsapp ?? 'operador') },
          toolResult: invoiceTicket,
          status: 'success',
          processingTrace: {
            handled_by: 'invoice_ticket_agent',
          },
        });
        return finish();
      }
    } catch (err) {
      console.error('[wa-invoice-ticket-agent] execution error', {
        tenantId,
        inboundMessageId,
        fromWaId,
        source,
        actorId: actor.id,
        error: (err as Error).message,
      });

      await enqueueOutbound('No pude procesar el ticket de factura. Proba de nuevo en unos segundos.');
      await logTurn({
        actorId: actor.id,
        usuarioId: String(actor.usuario_id),
        intent: 'invoice_ticket_command',
        confidence: 1,
        toolName: 'lector_factura_ticket',
        toolArgs: { content: text, actorRole: String(actor.rol_whatsapp ?? 'operador') },
        status: 'error',
        fallbackReason: 'invoice_ticket_error',
        errorDetail: (err as Error).message,
        processingTrace: {
          handled_by: 'invoice_ticket_agent',
        },
      });
      return finish();
    }

    try {
      const action = await handleWhatsAppActionMessage({
        db,
        tenantId,
        actor: {
          id: actorId,
          usuario_id: String(actor.usuario_id),
          rol_whatsapp: String(actor.rol_whatsapp ?? 'operador'),
        },
        fromWaId,
        inboundMessageId,
        wamid: String(wamid ?? inboundMessageId),
        textBody: text,
        actionMode,
        sandboxUserId,
      });

      if (action.handled) {
        const actionPatch = buildMemoryPatchFromAction({
          telemetry: action.telemetry,
          userMessage: text,
          botReply: action.reply,
        });
        if (actionPatch) await persistConversationPatch(actionPatch);

        await enqueueOutbound(action.reply);
        const actionStatus =
          action.telemetry.intent.startsWith('action_pending_confirmation') ||
          action.telemetry.intent.startsWith('action_executed_') ||
          action.telemetry.intent === 'action_duplicate_ignored' ||
          action.telemetry.intent === 'action_cancelled'
            ? 'success'
            : action.telemetry.fallbackReason
              ? 'fallback'
              : 'success';

        console.info('[wa-action-agent]', {
          tenantId,
          inboundMessageId,
          fromWaId,
          source,
          actorId: actor.id,
          intent: action.telemetry.intent,
          confidence: action.telemetry.confidence,
          tool: action.telemetry.tool,
          fallbackReason: action.telemetry.fallbackReason,
        });
        await logTurn({
          actorId: actor.id,
          usuarioId: String(actor.usuario_id),
          actionLogId: action.telemetry.actionLogId ?? null,
          intent: action.telemetry.intent,
          confidence: action.telemetry.confidence,
          toolName: action.telemetry.tool,
          toolArgs: action.telemetry.payload ?? null,
          toolResult: action.telemetry.result ?? null,
          status: actionStatus,
          fallbackReason: action.telemetry.fallbackReason,
          processingTrace: {
            handled_by: 'action_agent',
            action_mode: actionMode,
            action_record_id: action.telemetry.actionRecordId ?? null,
          },
        });
        return finish();
      }
    } catch (err) {
      console.error('[wa-action-agent] execution error', {
        tenantId,
        inboundMessageId,
        fromWaId,
        source,
        actorId: actor.id,
        error: (err as Error).message,
      });

      await enqueueOutbound('No pude procesar la acción solicitada. Probá de nuevo en unos segundos.');
      await logTurn({
        actorId: actor.id,
        usuarioId: String(actor.usuario_id),
        intent: 'action_execution_error',
        confidence: 1,
        status: 'error',
        fallbackReason: 'action_agent_error',
        errorDetail: (err as Error).message,
        processingTrace: {
          handled_by: 'action_agent',
          action_mode: actionMode,
        },
      });
      return finish();
    }
  }

  try {
    const resolvedDisambiguation =
      mode === 'sandbox'
        ? { message: text, interpreted: false }
        : await resolveDisambiguationReply({
            db,
            tenantId,
            fromWaId,
            text,
          });

    const resolvedConversation = resolveConversationMessage({
      text: resolvedDisambiguation.message,
      state: conversationState,
    });

    const resolvedMessage = {
      message: resolvedConversation.message,
      interpretedDisambiguation: resolvedDisambiguation.interpreted,
      interpretedMemory: resolvedConversation.interpreted,
      conversationSource: resolvedConversation.source,
    };

    const result = await runWhatsAppReadOnlyAgent({
      db,
      tenantId,
      message: resolvedMessage.message,
      enableV2: v2Enabled,
      conversationState,
      rolWhatsapp: actor.rol_whatsapp,
      channel: mode === 'sandbox' ? 'sandbox' : 'live',
    });

    const { cleanedReply, pdfLink } = extractReportPdfFromReply(result.reply);
    const replyWithHint = appendSuggestNextStep({
      reply: cleanedReply || result.reply,
      intent: result.intent,
      catalog: capabilitiesCatalog,
      enabled: v2Enabled && !result.fallbackReason,
    });
    if (replyWithHint.trim()) {
      await enqueueOutbound(replyWithHint);
    } else if (pdfLink) {
      await enqueueOutbound('Te comparto el reporte en PDF.', {
        messageType: 'text',
      });
    }
    if (pdfLink) {
      await enqueueOutbound('Reporte PDF', {
        messageType: 'document',
        documentLink: pdfLink,
        documentFilename: filenameFromPdfLink(pdfLink),
        documentCaption: 'Reporte SmartStock',
      });
    }

    const parsedOptions = parseDisambiguationPrompt(cleanedReply || result.reply);
    const entity = result.resolvedEntity ?? extractEntityFromResolvedMessage({
      intent: result.intent,
      message: resolvedMessage.message,
    });
    const nextTopic = topicFromIntent(result.intent, conversationState?.topic ?? null);
    const pendingPrompt =
      result.fallbackReason === 'ambiguous_debt_scope'
        ? 'debt_scope'
        : result.fallbackReason === 'report_requested_without_scope'
          ? 'report_scope'
          : null;
    const debtFollowupTarget =
      result.fallbackReason === 'ambiguous_debt_scope'
        ? extractDebtFollowupTarget(resolvedMessage.message)
        : null;

    await saveWhatsAppConversationState({
      db,
      tenantId,
      actorId,
      fromWaId,
      patch: {
        topic: nextTopic,
        lastIntent: result.intent,
        lastEntityType: entity.type ?? conversationState?.lastEntityType ?? null,
        lastEntityName: debtFollowupTarget ?? entity.name ?? conversationState?.lastEntityName ?? null,
        pendingPrompt,
        lastOptions: parsedOptions?.options ?? result.memoryOptions ?? [],
        lastReportKey: v2Enabled ? result.reportContext?.key ?? null : null,
        lastReportPage: v2Enabled ? result.reportContext?.page ?? null : null,
        lastUserMessage: text.slice(0, 500),
        lastBotSummary: summarizeBotReplyForMemory(replyWithHint || cleanedReply || result.reply),
        incrementTurn: true,
      },
    });

    await logTurn({
      actorId: actor.id,
      usuarioId: String(actor.usuario_id),
      resolvedMessage: resolvedMessage.message,
      intent: result.intent,
      confidence: result.confidence,
      toolName: result.tool,
      toolTrace: result.toolTrace ?? null,
      status: result.fallbackReason ? 'fallback' : 'success',
      fallbackReason: result.fallbackReason,
      processingTrace: {
        handled_by: 'read_only_agent',
        feature_flag: featureFlag,
        v2_enabled: v2Enabled,
        interpreted_disambiguation_reply: resolvedMessage.interpretedDisambiguation,
        interpreted_conversation_memory: resolvedMessage.interpretedMemory,
        parsed_options: parsedOptions?.options ?? [],
        memory_options: result.memoryOptions ?? [],
        report_context: result.reportContext ?? null,
        resolved_entity: entity ?? null,
        pdf_link: pdfLink ?? null,
      },
    });

    console.info('[wa-readonly-agent]', {
      tenantId,
      inboundMessageId,
      fromWaId,
      source,
      actorId: actor.id,
      trustLevel,
      intent: result.intent,
      confidence: result.confidence,
      tool: result.tool,
      fallbackReason: result.fallbackReason,
      interpretedDisambiguationReply: resolvedMessage.interpretedDisambiguation,
      interpretedConversationMemory: resolvedMessage.interpretedMemory,
      v2Enabled,
      rolloutStage: featureFlag.rolloutStage,
    });
  } catch (err) {
    console.error('[wa-readonly-agent] execution error', {
      tenantId,
      inboundMessageId,
      fromWaId,
      source,
      actorId: actor.id,
      error: (err as Error).message,
    });

    await enqueueOutbound('No pude procesar tu consulta ahora. Probá de nuevo en unos segundos.');
    const toolTrace = (err as { toolTrace?: WhatsAppToolTrace }).toolTrace ?? null;
    await logTurn({
      actorId: actor.id,
      usuarioId: String(actor.usuario_id),
      intent: 'readonly_agent_error',
      confidence: 1,
      toolName: toolTrace?.name ?? null,
      toolTrace,
      status: 'error',
      fallbackReason: 'readonly_agent_error',
      errorDetail: (err as Error).message,
      processingTrace: {
        handled_by: 'read_only_agent',
        feature_flag: featureFlag,
        v2_enabled: v2Enabled,
      },
    });
  }

  return finish();
}
