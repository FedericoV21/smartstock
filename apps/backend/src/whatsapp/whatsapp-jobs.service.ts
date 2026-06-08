import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { WhatsappJobEvent } from './entities/whatsapp-job-event.entity';
import { WhatsappProcessingJob } from './entities/whatsapp-processing-job.entity';
import { WhatsappBranchResolutionStatus } from './enums/whatsapp-branch-resolution-status.enum';
import { WhatsappJobStatus } from './enums/whatsapp-job-status.enum';
import { serializeJob } from './utils/whatsapp-serialize.util';
import { WhatsappBaseService } from './whatsapp-base.service';

@Injectable()
export class WhatsappJobsService {
  constructor(
    private readonly base: WhatsappBaseService,
    @InjectRepository(WhatsappProcessingJob)
    private readonly jobRepo: Repository<WhatsappProcessingJob>,
    @InjectRepository(WhatsappJobEvent)
    private readonly eventRepo: Repository<WhatsappJobEvent>,
  ) {}

  async listJobs(limitRaw?: number) {
    await this.base.assertModuloWhatsApp();
    const tenantId = this.base.getTenantId();
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(200, Number(limitRaw)))
      : 50;

    const jobs = await this.jobRepo.find({
      where: { tenantId },
      relations: ['inboundMessage', 'inboundAttachment'],
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return { jobs: jobs.map(serializeJob) };
  }

  async reprocess(user: AccessTokenPayload, body: Record<string, unknown>) {
    await this.base.assertModuloWhatsApp();
    this.base.assertNotVisor(user);

    const tenantId = this.base.getTenantId();
    const action = String(body.action ?? '').trim();
    const jobId = String(body.job_id ?? '').trim();

    if (action !== 'reprocess' || !jobId) {
      throw new BadRequestException('Parámetros inválidos');
    }

    const job = await this.jobRepo.findOne({
      where: { id: jobId, tenantId },
    });
    if (!job) {
      throw new NotFoundException('Job no encontrado');
    }

    const docType = String(job.documentType ?? '').toLowerCase();
    const isVoice = docType === 'voice_note' || docType === 'voice' || docType === 'audio';
    const needsBranch = !isVoice && docType !== 'unsupported';

    if (
      needsBranch &&
      !job.branchId &&
      (job.status === WhatsappJobStatus.awaiting_branch_confirmation ||
        job.branchResolutionStatus === WhatsappBranchResolutionStatus.ambiguous)
    ) {
      throw new BadRequestException(
        'Este archivo necesita sucursal confirmada. Respondé por WhatsApp con el número de sucursal o configurá una regla en el panel.',
      );
    }

    const previousStatus = job.status;
    const update = {
      status: WhatsappJobStatus.queued,
      errorCode: null as string | null,
      errorDetail: null as string | null,
      startedAt: null as Date | null,
      finishedAt: null as Date | null,
      branchResolutionStatus: job.branchResolutionStatus,
      branchResolutionReason: job.branchResolutionReason,
      branchPromptDeadlineAt: job.branchPromptDeadlineAt,
      branchPromptRequestedAt: job.branchPromptRequestedAt,
    };

    if (isVoice && job.status === WhatsappJobStatus.awaiting_branch_confirmation) {
      update.branchResolutionStatus = null;
      update.branchResolutionReason = 'not_required_audio_stt';
      update.branchPromptDeadlineAt = null;
      update.branchPromptRequestedAt = null;
    }

    await this.jobRepo.update({ id: job.id, tenantId }, update);

    await this.eventRepo.save({
      tenantId,
      jobId: job.id,
      eventType: 'manual_reprocess_requested_ui',
      eventPayload: { previous_status: previousStatus, requested_by: user.sub },
    });

    return { ok: true, job_id: job.id, status: 'queued' };
  }

  async reprocessInternal(jobId: string) {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Job no encontrado');
    }

    const previousStatus = job.status;
    await this.jobRepo.update(
      { id: job.id },
      {
        status: WhatsappJobStatus.queued,
        errorCode: null,
        errorDetail: null,
        startedAt: null,
        finishedAt: null,
      },
    );

    await this.eventRepo.save({
      tenantId: job.tenantId,
      jobId: job.id,
      eventType: 'manual_reprocess_requested_cron',
      eventPayload: { previous_status: previousStatus, source: 'cron_internal' },
    });

    return { ok: true, job_id: job.id, status: 'queued' };
  }
}
