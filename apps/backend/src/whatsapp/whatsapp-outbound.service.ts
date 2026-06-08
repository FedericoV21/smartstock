import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WhatsappJobEvent } from './entities/whatsapp-job-event.entity';
import { WhatsappOutboundMessage } from './entities/whatsapp-outbound-message.entity';
import { WhatsappMetaService } from './whatsapp-meta.service';

@Injectable()
export class WhatsappOutboundService {
  constructor(
    private readonly config: ConfigService,
    private readonly meta: WhatsappMetaService,
    @InjectRepository(WhatsappOutboundMessage)
    private readonly outboundRepo: Repository<WhatsappOutboundMessage>,
    @InjectRepository(WhatsappJobEvent)
    private readonly eventRepo: Repository<WhatsappJobEvent>,
  ) {}

  shouldAutoFlushOtpOutbound(): boolean {
    const raw = (this.config.get<string>('WHATSAPP_OTP_AUTO_FLUSH_OUTBOUND') ?? '').trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes') return true;
    if (raw === '0' || raw === 'false' || raw === 'no') return false;
    return true;
  }

  shouldAutoFlushBranchOutbound(): boolean {
    const raw = (this.config.get<string>('WHATSAPP_AUTO_FLUSH_OUTBOUND') ?? '').trim().toLowerCase();
    if (raw === '1' || raw === 'true' || raw === 'yes') return true;
    if (raw === '0' || raw === 'false' || raw === 'no') return false;
    return true;
  }

  async enqueue(params: {
    tenantId: string;
    toWaId: string;
    phoneNumberId: string | null;
    body: string;
    relatedJobId?: string | null;
    autoFlush?: boolean;
  }): Promise<string[]> {
    const row = await this.outboundRepo.save({
      tenantId: params.tenantId,
      toWaId: params.toWaId,
      phoneNumberId: params.phoneNumberId,
      body: params.body,
      status: 'queued',
      relatedJobId: params.relatedJobId ?? null,
    });

    const ids = [row.id];
    if (params.autoFlush !== false && this.shouldAutoFlushBranchOutbound()) {
      await this.processQueue({ tenantId: params.tenantId, messageIds: ids, limit: 20 });
    }
    return ids;
  }

  async processQueue(params?: {
    limit?: number;
    tenantId?: string;
    messageIds?: string[];
  }): Promise<{ processed: number; sent: number; failed: number }> {
    const messageIds = Array.from(
      new Set((params?.messageIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean)),
    );
    if (params?.messageIds && messageIds.length === 0) {
      return { processed: 0, sent: 0, failed: 0 };
    }

    const requestedLimit = Math.max(1, Math.min(200, Number(params?.limit ?? 100)));
    const limit = messageIds.length > 0 ? Math.min(requestedLimit, messageIds.length) : requestedLimit;

    const qb = this.outboundRepo
      .createQueryBuilder('o')
      .where('o.status = :status', { status: 'queued' })
      .orderBy('o.createdAt', 'ASC')
      .take(limit);

    if (params?.tenantId) qb.andWhere('o.tenantId = :tenantId', { tenantId: params.tenantId });
    if (messageIds.length > 0) qb.andWhere('o.id IN (:...ids)', { ids: messageIds });

    const rows = await qb.getMany();

    let processed = 0;
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const lock = await this.outboundRepo.update(
        { id: row.id, status: 'queued' },
        { status: 'sending' },
      );
      if (!lock.affected) continue;

      processed += 1;

      try {
        const phoneNumberId = row.phoneNumberId;
        if (!phoneNumberId) {
          throw new Error('phone_number_id faltante para envío outbound');
        }

        const sentResp = await this.meta.sendText({
          phoneNumberId,
          toWaId: row.toWaId,
          body: row.body,
        });

        await this.outboundRepo.update(row.id, {
          toWaId: sentResp.resolvedToWaId ?? row.toWaId,
          status: 'sent',
          sentAt: new Date(),
          externalMessageId: sentResp.externalMessageId,
          lastError: null,
          lastErrorAt: null,
        });

        if (row.relatedJobId) {
          await this.eventRepo.save({
            tenantId: row.tenantId,
            jobId: row.relatedJobId,
            eventType: 'outbound_sent',
            eventPayload: {
              outbound_message_id: row.id,
              external_message_id: sentResp.externalMessageId,
            },
          });
        }

        sent += 1;
      } catch (e) {
        const errorMessage = (e as Error).message;
        await this.outboundRepo.update(row.id, {
          status: 'error',
          retryCount: (row.retryCount ?? 0) + 1,
          lastError: errorMessage,
          lastErrorAt: new Date(),
        });

        if (row.relatedJobId) {
          await this.eventRepo.save({
            tenantId: row.tenantId,
            jobId: row.relatedJobId,
            eventType: 'outbound_error',
            eventPayload: { outbound_message_id: row.id, error: errorMessage },
          });
        }

        failed += 1;
      }
    }

    return { processed, sent, failed };
  }

  async flushMessageIds(tenantId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await this.processQueue({ tenantId, messageIds: ids, limit: 20 });
    } catch {
      /* best effort */
    }
  }
}
