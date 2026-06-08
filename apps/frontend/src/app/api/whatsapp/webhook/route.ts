import { after, NextResponse } from 'next/server';

import { parseWhatsAppInboundPayload } from '@/lib/whatsapp/inbound';
import { getSupabaseServiceRoleKey } from '@/lib/supabase/env-keys';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { whatsappInboundAllowed } from '@/lib/whatsapp/rate-limit';
import {
  applyRecentBranchReplyToNewJob,
  enqueueWhatsAppBranchOutbound,
  handleWhatsAppBranchConfirmationReply,
  sortInboundMessagesForBranchHandling,
} from '@/lib/whatsapp/branch-confirmation';
import {
  buildBranchPromptMessage,
  getBranchReplyDeadlineIso,
  resolveBranchByRules,
} from '@/lib/whatsapp/branch-resolution';
import { resolveWhatsAppJobRoute } from '@/lib/whatsapp/job-routing';
import { resolveInboundWhatsAppTenant } from '@/lib/whatsapp/inbound-routing';
import { handleWhatsAppTextMessage } from '@/lib/whatsapp/text-handler';
import { verifyWhatsAppWebhookSignature } from '@/lib/whatsapp/webhook-signature';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function getWebhookVerifyToken(): string {
  return (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '').trim();
}

function getChallengeVerification(url: URL) {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  return { mode, token, challenge };
}

function isDuplicateError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string };
  return e.code === '23505' || e.message?.includes('duplicate key') === true;
}

function pickString(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export async function GET(request: Request) {
  const verifyToken = getWebhookVerifyToken();
  if (!verifyToken) {
    return NextResponse.json(
      { error: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN no configurado' },
      { status: 503 },
    );
  }

  const { mode, token, challenge } = getChallengeVerification(new URL(request.url));
  if (mode !== 'subscribe' || token !== verifyToken || !challenge) {
    return NextResponse.json({ error: 'Webhook verification failed' }, { status: 403 });
  }

  return new NextResponse(challenge, { status: 200 });
}

export async function POST(request: Request) {
  if (!getSupabaseServiceRoleKey()) {
    return NextResponse.json(
      { error: 'Service role key no configurada (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY)' },
      { status: 503 },
    );
  }

  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const signatureOk = verifyWhatsAppWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get('x-hub-signature-256'),
  });
  if (!signatureOk) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = rawBody ? (JSON.parse(rawBody) as unknown) : {};
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const inboundMessages = sortInboundMessagesForBranchHandling(parseWhatsAppInboundPayload(body));
  if (inboundMessages.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const admin = createServiceRoleClient();
  let processed = 0;

  for (const item of inboundMessages) {
    const phoneNumberId = item.phoneNumberId;
    if (!phoneNumberId) {
      continue;
    }

    const tenantResolution = await resolveInboundWhatsAppTenant({
      db: admin,
      phoneNumberId,
      fromWaId: item.fromWaId,
      textBody: item.textBody,
    });

    if (tenantResolution.mode === 'unroutable') {
      continue;
    }

    const tenantId = tenantResolution.tenantId;

    if (!whatsappInboundAllowed(tenantId)) {
      continue;
    }

    const inboundInsert = await admin
      .from('whatsapp_inbound_message' as any)
      .insert({
        tenant_id: tenantId,
        wamid: item.messageId,
        from_wa_id: item.fromWaId,
        to_phone_number_id: item.phoneNumberId,
        message_type: item.messageType,
        text_body: item.textBody,
        metadata: item.metadata,
        raw_payload: body,
      })
      .select('id')
      .single();

    let inboundMessageId: string | null = pickString(inboundInsert.data, 'id');

    if (inboundInsert.error && isDuplicateError(inboundInsert.error)) {
      const { data: existing } = await admin
        .from('whatsapp_inbound_message' as any)
        .select('id')
        .eq('wamid', item.messageId)
        .maybeSingle();
      inboundMessageId = pickString(existing, 'id');
    } else if (inboundInsert.error) {
      continue;
    }

    if (!inboundMessageId) continue;
    processed += 1;

    let branchReplyHandled = false;
    if (item.messageType === 'text' && item.textBody) {
      const branchResult = await handleWhatsAppBranchConfirmationReply({
        db: admin,
        tenantId,
        fromWaId: item.fromWaId,
        phoneNumberId,
        textBody: item.textBody,
      });
      branchReplyHandled = branchResult.handled;
    }

    if (item.messageType === 'text' && item.textBody && !branchReplyHandled) {
      await handleWhatsAppTextMessage({
        db: admin,
        tenantId,
        fromWaId: item.fromWaId,
        phoneNumberId,
        inboundMessageId,
        wamid: item.messageId,
        textBody: item.textBody,
        source: 'webhook_text',
        resolvedActorId:
          tenantResolution.mode === 'platform' ? tenantResolution.actorId : null,
      });
    }

    if (!item.attachment) continue;

    const attachmentInsert = await admin
      .from('whatsapp_inbound_attachment' as any)
      .insert({
        tenant_id: tenantId,
        inbound_message_id: inboundMessageId,
        wa_media_id: item.attachment.mediaId,
        mime_type: item.attachment.mimeType,
        filename: item.attachment.filename,
        sha256: item.attachment.sha256,
        raw_payload: item.attachment.raw,
      })
      .select('id')
      .single();

    let attachmentId: string | null = pickString(attachmentInsert.data, 'id');
    if (attachmentInsert.error && isDuplicateError(attachmentInsert.error)) {
      const { data: existingAttachment } = await admin
        .from('whatsapp_inbound_attachment' as any)
        .select('id')
        .eq('inbound_message_id', inboundMessageId)
        .eq('sha256', item.attachment.sha256)
        .maybeSingle();
      attachmentId = pickString(existingAttachment, 'id');
    } else if (attachmentInsert.error) {
      continue;
    }

    if (!attachmentId) continue;

    const jobInsert = await admin
      .from('whatsapp_processing_job' as any)
      .insert({
        tenant_id: tenantId,
        inbound_message_id: inboundMessageId,
        inbound_attachment_id: attachmentId,
        status: 'queued',
        document_type: item.messageType,
        from_wa_id: item.fromWaId,
        to_phone_number_id: phoneNumberId,
      })
      .select('id')
      .single();

    const jobId = pickString(jobInsert.data, 'id');
    if (!jobId || jobInsert.error) continue;

    await admin.from('whatsapp_job_event' as any).insert({
      tenant_id: tenantId,
      job_id: jobId,
      event_type: 'queued',
      event_payload: {
        source: 'whatsapp_webhook',
        wamid: item.messageId,
      },
    });

    const attachmentRoute = resolveWhatsAppJobRoute(item.attachment.mimeType);
    if (attachmentRoute.flow === 'audio_transcription') {
      await admin
        .from('whatsapp_processing_job' as any)
        .update({
          document_type: attachmentRoute.documentType,
          branch_resolution_status: null,
          branch_resolution_reason: 'not_required_audio_stt',
        })
        .eq('id', jobId);

      await admin.from('whatsapp_job_event' as any).insert({
        tenant_id: tenantId,
        job_id: jobId,
        event_type: 'audio_stt_queued',
        event_payload: {
          mime_type: item.attachment.mimeType,
          inbound_attachment_id: attachmentId,
        },
      });

      after(async () => {
        try {
          const { runWhatsAppProcessQueuedJobs } = await import('@/lib/whatsapp/process-queued-runner');
          await runWhatsAppProcessQueuedJobs(admin, { tenantId, jobIds: [jobId], limit: 1 });
        } catch (e) {
          console.error('[wa-webhook] process queued after audio', {
            tenantId,
            jobId,
            error: (e as Error).message,
          });
        }
      });
      continue;
    }

    const resolution = await resolveBranchByRules(admin, {
      tenantId,
      fromWaId: item.fromWaId,
      phoneNumberId,
      providerId: null,
    });

    if (resolution.type === 'resolved_auto' && resolution.branchId) {
      await admin
        .from('whatsapp_processing_job' as any)
        .update({
          branch_id: resolution.branchId,
          branch_resolution_status: 'resolved_auto',
          branch_resolution_reason: resolution.reason,
        })
        .eq('id', jobId);

      await admin.from('whatsapp_job_event' as any).insert({
        tenant_id: tenantId,
        job_id: jobId,
        event_type: 'branch_resolved_auto',
        event_payload: {
          branch_id: resolution.branchId,
          reason: resolution.reason,
        },
      });

      try {
        const { runWhatsAppProcessQueuedJobs } = await import('@/lib/whatsapp/process-queued-runner');
        await runWhatsAppProcessQueuedJobs(admin, { tenantId, jobIds: [jobId], limit: 1 });
      } catch (e) {
        console.error('[wa-webhook] process queued after auto branch', {
          tenantId,
          jobId,
          error: (e as Error).message,
        });
        try {
          await enqueueWhatsAppBranchOutbound({
            db: admin,
            tenantId,
            toWaId: item.fromWaId,
            phoneNumberId,
            body: 'Recibí tu factura pero hubo un error al iniciar el procesamiento. Intentá reenviarla en unos minutos.',
            relatedJobId: jobId,
          });
        } catch (outErr) {
          console.error('[wa-webhook] outbound after process error', {
            tenantId,
            jobId,
            error: (outErr as Error).message,
          });
        }
      }
      continue;
    }

    const deadline = getBranchReplyDeadlineIso();
    await admin
      .from('whatsapp_processing_job' as any)
      .update({
        status: 'awaiting_branch_confirmation',
        branch_resolution_status: resolution.type === 'not_found' ? 'not_found' : 'ambiguous',
        branch_resolution_reason: resolution.reason,
        branch_prompt_requested_at: new Date().toISOString(),
        branch_prompt_deadline_at: deadline,
      })
      .eq('id', jobId);

    await admin.from('whatsapp_job_event' as any).insert([
      {
        tenant_id: tenantId,
        job_id: jobId,
        event_type: 'branch_resolution_pending',
        event_payload: {
          reason: resolution.reason,
          resolution_type: resolution.type,
        },
      },
      {
        tenant_id: tenantId,
        job_id: jobId,
        event_type: 'branch_options',
        event_payload: {
          options: resolution.candidates,
          deadline_at: deadline,
        },
      },
    ]);

    const appliedRecent = await applyRecentBranchReplyToNewJob({
      db: admin,
      tenantId,
      fromWaId: item.fromWaId,
      phoneNumberId,
      jobId,
      resolution,
    });

    if (!appliedRecent.handled && resolution.candidates.length > 0) {
      await enqueueWhatsAppBranchOutbound({
        db: admin,
        tenantId,
        toWaId: item.fromWaId,
        phoneNumberId,
        body: buildBranchPromptMessage(resolution.candidates),
        relatedJobId: jobId,
      });
    } else if (!appliedRecent.handled && resolution.candidates.length === 0) {
      await enqueueWhatsAppBranchOutbound({
        db: admin,
        tenantId,
        toWaId: item.fromWaId,
        phoneNumberId,
        body:
          'Recibí tu archivo, pero no hay ninguna sucursal activa configurada en SmartStock. Pedile al administrador que active una sucursal o configure la regla de WhatsApp.',
        relatedJobId: jobId,
      });
    }
  }

  return NextResponse.json({ ok: true, processed });
}
