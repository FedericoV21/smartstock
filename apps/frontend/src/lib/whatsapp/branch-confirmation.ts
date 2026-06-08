import type { WhatsAppInboundMessage } from '@/lib/whatsapp/inbound';
import { processWhatsAppOutboundQueue } from '@/lib/whatsapp/outbound-worker';
import {
  type BranchResolutionResult,
  resolveBranchByRules,
  resolveBranchFromTextReply,
} from '@/lib/whatsapp/branch-resolution';

export const BRANCH_REPLY_LOOKBACK_MINUTES = 15;

export type BranchCandidate = { id: string; nombre: string; codigo: string | null };

const MEDIA_FIRST_TYPES = new Set(['image', 'document', 'audio', 'voice']);

function shouldAutoFlushBranchOutbound(): boolean {
  const raw = (process.env.WHATSAPP_AUTO_FLUSH_OUTBOUND ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return true;
}

async function flushOutboundIds(db: any, tenantId: string, outboundIds: string[]) {
  if (!shouldAutoFlushBranchOutbound() || outboundIds.length === 0) return;
  try {
    await processWhatsAppOutboundQueue({ db, tenantId, limit: 20, messageIds: outboundIds });
  } catch (e) {
    console.error('[wa-branch-confirmation] outbound auto flush error', {
      tenantId,
      error: (e as Error).message,
    });
  }
}

function pickOutboundIds(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => (row && typeof row === 'object' ? String((row as { id?: string }).id ?? '') : ''))
    .filter((id) => id.length > 0);
}

export async function enqueueWhatsAppBranchOutbound(params: {
  db: any;
  tenantId: string;
  toWaId: string;
  phoneNumberId: string | null;
  body: string;
  relatedJobId?: string | null;
}): Promise<void> {
  const { db, tenantId, toWaId, phoneNumberId, body, relatedJobId } = params;
  const payload: Record<string, unknown> = {
    tenant_id: tenantId,
    to_wa_id: toWaId,
    phone_number_id: phoneNumberId,
    body,
    status: 'queued',
  };
  if (relatedJobId) payload.related_job_id = relatedJobId;

  const insert = await db.from('whatsapp_outbound_message' as any).insert(payload).select('id');
  if (insert?.error) throw new Error(String(insert.error.message ?? 'No se pudo encolar mensaje outbound.'));
  await flushOutboundIds(db, tenantId, pickOutboundIds(insert.data));
}

export function sortInboundMessagesForBranchHandling(
  messages: WhatsAppInboundMessage[],
): WhatsAppInboundMessage[] {
  return [...messages].sort((a, b) => {
    const aMedia = MEDIA_FIRST_TYPES.has(a.messageType) || Boolean(a.attachment);
    const bMedia = MEDIA_FIRST_TYPES.has(b.messageType) || Boolean(b.attachment);
    if (aMedia === bMedia) return 0;
    return aMedia ? -1 : 1;
  });
}

export function branchSelectionReplyMatches(
  text: string,
  candidates: BranchCandidate[],
): string | null {
  if (candidates.length < 2) return null;
  return resolveBranchFromTextReply(text, candidates);
}

async function loadBranchOptionsForJob(db: any, jobId: string): Promise<BranchCandidate[]> {
  const { data: event } = await db
    .from('whatsapp_job_event' as any)
    .select('event_payload')
    .eq('job_id', jobId)
    .eq('event_type', 'branch_options')
    .order('created_at', { ascending: false })
    .maybeSingle();

  const options = (event?.event_payload?.options ?? []) as BranchCandidate[];
  return Array.isArray(options) ? options : [];
}

async function listPendingBranchJobs(db: any, tenantId: string, fromWaId: string) {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from('whatsapp_processing_job' as any)
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('from_wa_id', fromWaId)
    .eq('status', 'awaiting_branch_confirmation')
    .gt('branch_prompt_deadline_at', nowIso)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string }>;
}

async function confirmPendingJobsWithBranch(params: {
  db: any;
  tenantId: string;
  fromWaId: string;
  phoneNumberId: string | null;
  branchId: string;
  textBody: string;
  jobIds: string[];
}): Promise<string[]> {
  const { db, tenantId, fromWaId, phoneNumberId, branchId, textBody, jobIds } = params;
  if (jobIds.length === 0) return [];

  const { error: upErr } = await db
    .from('whatsapp_processing_job' as any)
    .update({
      status: 'queued',
      branch_id: branchId,
      branch_resolution_status: 'resolved_manual',
      branch_resolution_reason: 'confirmed_from_whatsapp_reply',
      branch_prompt_deadline_at: null,
      branch_prompt_requested_at: null,
    })
    .in('id', jobIds);

  if (upErr) throw new Error(upErr.message);

  const events = jobIds.map((jobId) => ({
    tenant_id: tenantId,
    job_id: jobId,
    event_type: 'branch_confirmed_from_reply',
    event_payload: { branch_id: branchId, text: textBody, bulk: jobIds.length > 1 },
  }));
  await db.from('whatsapp_job_event' as any).insert(events);

  const ack =
    jobIds.length === 1
      ? 'Sucursal confirmada. Gracias, continuamos con el procesamiento.'
      : `Sucursal confirmada para ${jobIds.length} archivos. Continuamos con el procesamiento.`;

  await enqueueWhatsAppBranchOutbound({
    db,
    tenantId,
    toWaId: fromWaId,
    phoneNumberId,
    body: ack,
    relatedJobId: jobIds[jobIds.length - 1] ?? null,
  });

  return jobIds;
}

export type BranchConfirmationHandleResult = {
  handled: boolean;
  confirmedJobIds: string[];
  branchId: string | null;
  ackMessage: string | null;
};

export async function handleWhatsAppBranchConfirmationReply(params: {
  db: any;
  tenantId: string;
  fromWaId: string;
  phoneNumberId: string | null;
  textBody: string;
}): Promise<BranchConfirmationHandleResult> {
  const { db, tenantId, fromWaId, phoneNumberId, textBody } = params;
  const pendingJobs = await listPendingBranchJobs(db, tenantId, fromWaId);
  if (pendingJobs.length === 0) {
    return { handled: false, confirmedJobIds: [], branchId: null, ackMessage: null };
  }

  const firstJobId = pendingJobs[0]!.id;
  let options = await loadBranchOptionsForJob(db, firstJobId);
  if (options.length === 0) {
    const resolution = await resolveBranchByRules(db, {
      tenantId,
      fromWaId,
      phoneNumberId,
      providerId: null,
    });
    options = resolution.candidates;
  }

  const branchId = branchSelectionReplyMatches(textBody, options);
  if (!branchId) {
    return { handled: false, confirmedJobIds: [], branchId: null, ackMessage: null };
  }

  const jobIds = pendingJobs.map((j) => j.id);
  const confirmedJobIds = await confirmPendingJobsWithBranch({
    db,
    tenantId,
    fromWaId,
    phoneNumberId,
    branchId,
    textBody,
    jobIds,
  });

  if (confirmedJobIds.length > 0) {
    try {
      const { runWhatsAppProcessQueuedJobs } = await import('@/lib/whatsapp/process-queued-runner');
      await runWhatsAppProcessQueuedJobs(db, {
        tenantId,
        jobIds: confirmedJobIds,
        limit: confirmedJobIds.length,
      });
    } catch (e) {
      console.error('[wa-branch-confirmation] process queued after confirm', {
        tenantId,
        jobIds: confirmedJobIds,
        error: (e as Error).message,
      });
    }
  }

  return {
    handled: true,
    confirmedJobIds,
    branchId,
    ackMessage:
      confirmedJobIds.length === 1
        ? 'Sucursal confirmada. Gracias, continuamos con el procesamiento.'
        : `Sucursal confirmada para ${confirmedJobIds.length} archivos. Continuamos con el procesamiento.`,
  };
}

export async function tryAcknowledgeBranchReplyBeforeAttachment(params: {
  db: any;
  tenantId: string;
  fromWaId: string;
  phoneNumberId: string | null;
  textBody: string;
}): Promise<BranchConfirmationHandleResult> {
  const { db, tenantId, fromWaId, phoneNumberId, textBody } = params;
  const pendingJobs = await listPendingBranchJobs(db, tenantId, fromWaId);
  if (pendingJobs.length > 0) {
    return { handled: false, confirmedJobIds: [], branchId: null, ackMessage: null };
  }

  const resolution = await resolveBranchByRules(db, {
    tenantId,
    fromWaId,
    phoneNumberId,
    providerId: null,
  });
  if (resolution.type !== 'ambiguous' || resolution.candidates.length < 2) {
    return { handled: false, confirmedJobIds: [], branchId: null, ackMessage: null };
  }

  const branchId = branchSelectionReplyMatches(textBody, resolution.candidates);
  if (!branchId) {
    return { handled: false, confirmedJobIds: [], branchId: null, ackMessage: null };
  }

  const ackMessage =
    'Recibí tu elección de sucursal. Cuando envíes la factura o archivo, la procesamos en esa sucursal.';
  await enqueueWhatsAppBranchOutbound({
    db,
    tenantId,
    toWaId: fromWaId,
    phoneNumberId,
    body: ackMessage,
  });

  return {
    handled: true,
    confirmedJobIds: [],
    branchId,
    ackMessage,
  };
}

export async function findRecentBranchReplyText(params: {
  db: any;
  tenantId: string;
  fromWaId: string;
  candidates: BranchCandidate[];
}): Promise<{ branchId: string; textBody: string } | null> {
  const { db, tenantId, fromWaId, candidates } = params;
  if (candidates.length < 2) return null;

  const sinceIso = new Date(Date.now() - BRANCH_REPLY_LOOKBACK_MINUTES * 60_000).toISOString();
  const { data: messages, error } = await db
    .from('whatsapp_inbound_message' as any)
    .select('text_body, created_at')
    .eq('tenant_id', tenantId)
    .eq('from_wa_id', fromWaId)
    .eq('message_type', 'text')
    .gt('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(12);

  if (error) throw new Error(error.message);

  for (const row of messages ?? []) {
    const textBody = String((row as { text_body?: string }).text_body ?? '').trim();
    if (!textBody) continue;
    const branchId = branchSelectionReplyMatches(textBody, candidates);
    if (branchId) return { branchId, textBody };
  }

  return null;
}

export async function applyRecentBranchReplyToPendingJobs(params: {
  db: any;
  tenantId: string;
  fromWaId: string;
  phoneNumberId: string | null;
  candidates: BranchCandidate[];
  includeJobIds?: string[];
}): Promise<BranchConfirmationHandleResult> {
  const { db, tenantId, fromWaId, phoneNumberId, candidates, includeJobIds } = params;
  const recent = await findRecentBranchReplyText({ db, tenantId, fromWaId, candidates });
  if (!recent) {
    return { handled: false, confirmedJobIds: [], branchId: null, ackMessage: null };
  }

  const pendingJobs = await listPendingBranchJobs(db, tenantId, fromWaId);
  const pendingIds = new Set(pendingJobs.map((j) => j.id));
  const jobIdSet = new Set<string>([...pendingIds]);
  for (const id of includeJobIds ?? []) {
    if (id) jobIdSet.add(id);
  }

  const jobIds = Array.from(jobIdSet);
  if (jobIds.length === 0) {
    return { handled: false, confirmedJobIds: [], branchId: null, ackMessage: null };
  }

  const confirmedJobIds = await confirmPendingJobsWithBranch({
    db,
    tenantId,
    fromWaId,
    phoneNumberId,
    branchId: recent.branchId,
    textBody: recent.textBody,
    jobIds,
  });

  if (confirmedJobIds.length > 0) {
    try {
      const { runWhatsAppProcessQueuedJobs } = await import('@/lib/whatsapp/process-queued-runner');
      await runWhatsAppProcessQueuedJobs(db, {
        tenantId,
        jobIds: confirmedJobIds,
        limit: confirmedJobIds.length,
      });
    } catch (e) {
      console.error('[wa-branch-confirmation] process queued after recent reply', {
        tenantId,
        jobIds: confirmedJobIds,
        error: (e as Error).message,
      });
    }
  }

  return {
    handled: true,
    confirmedJobIds,
    branchId: recent.branchId,
    ackMessage:
      confirmedJobIds.length === 1
        ? 'Sucursal confirmada. Gracias, continuamos con el procesamiento.'
        : `Sucursal confirmada para ${confirmedJobIds.length} archivos. Continuamos con el procesamiento.`,
  };
}

export async function applyRecentBranchReplyToNewJob(params: {
  db: any;
  tenantId: string;
  fromWaId: string;
  phoneNumberId: string | null;
  jobId: string;
  resolution: BranchResolutionResult;
}): Promise<BranchConfirmationHandleResult> {
  if (params.resolution.candidates.length < 2) {
    return { handled: false, confirmedJobIds: [], branchId: null, ackMessage: null };
  }

  return applyRecentBranchReplyToPendingJobs({
    db: params.db,
    tenantId: params.tenantId,
    fromWaId: params.fromWaId,
    phoneNumberId: params.phoneNumberId,
    candidates: params.resolution.candidates,
    includeJobIds: [params.jobId],
  });
}
