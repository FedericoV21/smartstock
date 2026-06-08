import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { WhatsappInboundAttachment } from './entities/whatsapp-inbound-attachment.entity';
import { WhatsappInboundMessage } from './entities/whatsapp-inbound-message.entity';
import { WhatsappJobEvent } from './entities/whatsapp-job-event.entity';
import { WhatsappProcessingJob } from './entities/whatsapp-processing-job.entity';
import { WhatsappBranchResolutionStatus } from './enums/whatsapp-branch-resolution-status.enum';
import { WhatsappJobStatus } from './enums/whatsapp-job-status.enum';
import {
  parseWhatsAppInboundPayload,
  sortInboundMessagesForBranchHandling,
  type WhatsAppInboundMessage,
} from './utils/inbound.util';
import { resolveWhatsAppJobRoute } from './utils/job-routing.util';
import { whatsappInboundAllowed } from './utils/rate-limit.util';
import { WhatsappBranchService } from './whatsapp-branch.service';
import { WhatsappInboundRoutingService } from './whatsapp-inbound-routing.service';
import { WhatsappProcessQueuedService } from './whatsapp-process-queued.service';
import { WhatsappTextHandlerService } from './whatsapp-text-handler.service';

@Injectable()
export class WhatsappWebhookIngestService {
  constructor(
    @InjectRepository(WhatsappInboundMessage)
    private readonly inboundRepo: Repository<WhatsappInboundMessage>,
    @InjectRepository(WhatsappInboundAttachment)
    private readonly attachmentRepo: Repository<WhatsappInboundAttachment>,
    @InjectRepository(WhatsappProcessingJob)
    private readonly jobRepo: Repository<WhatsappProcessingJob>,
    @InjectRepository(WhatsappJobEvent)
    private readonly eventRepo: Repository<WhatsappJobEvent>,
    private readonly routing: WhatsappInboundRoutingService,
    private readonly branchService: WhatsappBranchService,
    private readonly textHandler: WhatsappTextHandlerService,
    @Inject(forwardRef(() => WhatsappProcessQueuedService))
    private readonly processQueued: WhatsappProcessQueuedService,
  ) {}

  private isDuplicateError(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as { code?: string };
    return driverError?.code === '23505';
  }

  async ingest(rawBody: string, body: unknown): Promise<{ ok: true; processed: number }> {
    const inboundMessages = sortInboundMessagesForBranchHandling(parseWhatsAppInboundPayload(body));
    if (inboundMessages.length === 0) {
      return { ok: true, processed: 0 };
    }

    let processed = 0;

    for (const item of inboundMessages) {
      const phoneNumberId = item.phoneNumberId;
      if (!phoneNumberId) continue;

      const tenantResolution = await this.routing.resolveInboundTenant({
        phoneNumberId,
        fromWaId: item.fromWaId,
        textBody: item.textBody,
      });

      if (tenantResolution.mode === 'unroutable') continue;

      const tenantId = tenantResolution.tenantId;
      if (!whatsappInboundAllowed(tenantId)) continue;

      const inboundMessageId = await this.persistInboundMessage(tenantId, item, body);
      if (!inboundMessageId) continue;
      processed += 1;

      let branchReplyHandled = false;
      if (item.messageType === 'text' && item.textBody) {
        const branchResult = await this.branchService.handleBranchConfirmationReply({
          tenantId,
          fromWaId: item.fromWaId,
          phoneNumberId,
          textBody: item.textBody,
        });
        branchReplyHandled = branchResult.handled;
      }

      if (item.messageType === 'text' && item.textBody && !branchReplyHandled) {
        await this.textHandler.handleTextMessage({
          tenantId,
          fromWaId: item.fromWaId,
          phoneNumberId,
          inboundMessageId,
          textBody: item.textBody,
          source: 'webhook_text',
          resolvedActorId:
            tenantResolution.mode === 'platform' ? tenantResolution.actorId : null,
        });
      }

      if (!item.attachment) continue;

      const attachmentId = await this.persistAttachment(tenantId, inboundMessageId, item);
      if (!attachmentId) continue;

      const job = await this.jobRepo.save({
        tenantId,
        inboundMessageId,
        inboundAttachmentId: attachmentId,
        status: WhatsappJobStatus.queued,
        documentType: item.messageType,
        fromWaId: item.fromWaId,
        toPhoneNumberId: phoneNumberId,
      });

      await this.eventRepo.save({
        tenantId,
        jobId: job.id,
        eventType: 'queued',
        eventPayload: { source: 'whatsapp_webhook', wamid: item.messageId },
      });

      const attachmentRoute = resolveWhatsAppJobRoute(item.attachment.mimeType);
      if (attachmentRoute.flow === 'audio_transcription') {
        await this.jobRepo.update(job.id, {
          documentType: attachmentRoute.documentType,
          branchResolutionStatus: null,
          branchResolutionReason: 'not_required_audio_stt',
        });
        await this.eventRepo.save({
          tenantId,
          jobId: job.id,
          eventType: 'audio_stt_queued',
          eventPayload: {
            mime_type: item.attachment.mimeType,
            inbound_attachment_id: attachmentId,
          },
        });
        void this.processQueued.run({ tenantId, jobIds: [job.id], limit: 1 });
        continue;
      }

      const resolution = await this.branchService.resolveBranchByRules({
        tenantId,
        fromWaId: item.fromWaId,
        phoneNumberId,
      });

      if (resolution.type === 'resolved_auto' && resolution.branchId) {
        await this.jobRepo.update(job.id, {
          branchId: resolution.branchId,
          branchResolutionStatus: WhatsappBranchResolutionStatus.resolved_auto,
          branchResolutionReason: resolution.reason,
        });
        await this.eventRepo.save({
          tenantId,
          jobId: job.id,
          eventType: 'branch_resolved_auto',
          eventPayload: { branch_id: resolution.branchId, reason: resolution.reason },
        });

        try {
          await this.processQueued.run({ tenantId, jobIds: [job.id], limit: 1 });
        } catch {
          await this.branchService.enqueueBranchOutbound({
            tenantId,
            toWaId: item.fromWaId,
            phoneNumberId,
            body: 'Recibí tu factura pero hubo un error al iniciar el procesamiento. Intentá reenviarla en unos minutos.',
            relatedJobId: job.id,
          });
        }
        continue;
      }

      const deadline = this.branchService.getReplyDeadline();
      await this.jobRepo.update(job.id, {
        status: WhatsappJobStatus.awaiting_branch_confirmation,
        branchResolutionStatus:
          resolution.type === 'not_found'
            ? WhatsappBranchResolutionStatus.not_found
            : WhatsappBranchResolutionStatus.ambiguous,
        branchResolutionReason: resolution.reason,
        branchPromptRequestedAt: new Date(),
        branchPromptDeadlineAt: deadline,
      });

      await this.eventRepo.save([
        {
          tenantId,
          jobId: job.id,
          eventType: 'branch_resolution_pending',
          eventPayload: { reason: resolution.reason, resolution_type: resolution.type },
        },
        {
          tenantId,
          jobId: job.id,
          eventType: 'branch_options',
          eventPayload: { options: resolution.candidates, deadline_at: deadline.toISOString() },
        },
      ]);

      const appliedRecent = await this.branchService.applyRecentBranchReplyToNewJob({
        tenantId,
        fromWaId: item.fromWaId,
        phoneNumberId,
        jobId: job.id,
        resolution,
      });

      if (!appliedRecent.handled && resolution.candidates.length > 0) {
        await this.branchService.enqueueBranchOutbound({
          tenantId,
          toWaId: item.fromWaId,
          phoneNumberId,
          body: this.branchService.buildBranchPrompt(resolution.candidates),
          relatedJobId: job.id,
        });
      } else if (!appliedRecent.handled && resolution.candidates.length === 0) {
        await this.branchService.enqueueBranchOutbound({
          tenantId,
          toWaId: item.fromWaId,
          phoneNumberId,
          body: 'Recibí tu archivo, pero no hay ninguna sucursal activa configurada en SmartStock. Pedile al administrador que active una sucursal o configure la regla de WhatsApp.',
          relatedJobId: job.id,
        });
      }
    }

    return { ok: true, processed };
  }

  private async persistInboundMessage(
    tenantId: string,
    item: WhatsAppInboundMessage,
    body: unknown,
  ): Promise<string | null> {
    try {
      const row = await this.inboundRepo.save({
        tenantId,
        wamid: item.messageId,
        fromWaId: item.fromWaId,
        toPhoneNumberId: item.phoneNumberId,
        messageType: item.messageType,
        textBody: item.textBody,
        metadata: item.metadata,
        rawPayload: (body && typeof body === 'object' ? body : {}) as Record<string, unknown>,
        receivedAt: new Date(),
      });
      return row.id;
    } catch (error) {
      if (!this.isDuplicateError(error)) return null;
      const existing = await this.inboundRepo.findOne({ where: { wamid: item.messageId } });
      return existing?.id ?? null;
    }
  }

  private async persistAttachment(
    tenantId: string,
    inboundMessageId: string,
    item: WhatsAppInboundMessage,
  ): Promise<string | null> {
    if (!item.attachment) return null;

    try {
      const row = await this.attachmentRepo.save({
        tenantId,
        inboundMessageId,
        waMediaId: item.attachment.mediaId,
        mimeType: item.attachment.mimeType,
        filename: item.attachment.filename,
        sha256: item.attachment.sha256,
        rawPayload: item.attachment.raw,
      });
      return row.id;
    } catch (error) {
      if (!this.isDuplicateError(error)) return null;
      const existing = await this.attachmentRepo.findOne({
        where: { inboundMessageId, sha256: item.attachment.sha256 },
      });
      return existing?.id ?? null;
    }
  }
}
