import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, LessThanOrEqual, Repository } from 'typeorm';

import { WhatsappAgentTurnLog } from '../whatsapp/entities/whatsapp-agent-turn-log.entity';
import { WhatsappAuthChallenge } from '../whatsapp/entities/whatsapp-auth-challenge.entity';
import { WhatsappJobEvent } from '../whatsapp/entities/whatsapp-job-event.entity';
import { WhatsappProcessingJob } from '../whatsapp/entities/whatsapp-processing-job.entity';
import { WhatsappAuthChallengeStatus } from '../whatsapp/enums/whatsapp-auth-challenge-status.enum';
import { WhatsappJobStatus } from '../whatsapp/enums/whatsapp-job-status.enum';
import { WhatsappOutboundService } from '../whatsapp/whatsapp-outbound.service';
import { WhatsappProcessQueuedService } from '../whatsapp/whatsapp-process-queued.service';

@Injectable()
export class CronWhatsappService {
  constructor(
    @InjectRepository(WhatsappAuthChallenge)
    private readonly challengeRepo: Repository<WhatsappAuthChallenge>,
    @InjectRepository(WhatsappAgentTurnLog)
    private readonly turnLogRepo: Repository<WhatsappAgentTurnLog>,
    @InjectRepository(WhatsappProcessingJob)
    private readonly jobRepo: Repository<WhatsappProcessingJob>,
    @InjectRepository(WhatsappJobEvent)
    private readonly eventRepo: Repository<WhatsappJobEvent>,
    private readonly outbound: WhatsappOutboundService,
    private readonly waProcessQueued: WhatsappProcessQueuedService,
  ) {}

  async expireOtp(limitRaw?: number) {
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(2000, Number(limitRaw)))
      : 500;
    const now = new Date();

    const expiredRows = await this.challengeRepo.find({
      where: {
        status: WhatsappAuthChallengeStatus.pending,
        expiresAt: LessThan(now),
      },
      select: ['id'],
      order: { expiresAt: 'ASC' },
      take: limit,
    });

    const ids = expiredRows.map((r) => r.id);
    if (ids.length === 0) {
      return { ok: true, scanned_limit: limit, expired: 0 };
    }

    await this.challengeRepo.update(
      { id: In(ids), status: WhatsappAuthChallengeStatus.pending },
      { status: WhatsappAuthChallengeStatus.expired },
    );

    return { ok: true, scanned_limit: limit, expired: ids.length };
  }

  async purgeAgentLogs() {
    const now = new Date();
    const result = await this.turnLogRepo.delete({
      expiresAt: LessThan(now),
    });

    return { ok: true, deleted: result.affected ?? 0 };
  }

  async branchTimeout() {
    const now = new Date();
    const jobs = await this.jobRepo.find({
      where: {
        status: WhatsappJobStatus.awaiting_branch_confirmation,
        branchPromptDeadlineAt: LessThanOrEqual(now),
      },
      select: ['id', 'tenantId'],
      take: 200,
    });

    if (jobs.length === 0) {
      return { ok: true, updated: 0 };
    }

    const ids = jobs.map((j) => j.id);
    await this.jobRepo.update(
      { id: In(ids) },
      {
        status: WhatsappJobStatus.review_required,
        branchResolutionReason: 'branch_confirmation_timeout',
      },
    );

    await this.eventRepo.save(
      jobs.map((j) => ({
        tenantId: j.tenantId,
        jobId: j.id,
        eventType: 'branch_confirmation_timeout',
        eventPayload: { timeout_at: now.toISOString() },
      })),
    );

    return { ok: true, updated: ids.length };
  }

  async sendOutbound(limitRaw?: number) {
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(200, Number(limitRaw)))
      : 100;
    const stats = await this.outbound.processQueue({ limit });
    return { ok: true, ...stats };
  }

  async processQueuedJobs(limitRaw?: number) {
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(50, Number(limitRaw)))
      : 50;
    const result = await this.waProcessQueued.run({ limit });
    return { ok: true, ...result };
  }
}
