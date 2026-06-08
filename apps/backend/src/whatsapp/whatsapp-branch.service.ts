import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';

import { Sucursal } from '../branches/entities/sucursal.entity';
import { WhatsappBranchRule } from './entities/whatsapp-branch-rule.entity';
import { WhatsappInboundMessage } from './entities/whatsapp-inbound-message.entity';
import { WhatsappJobEvent } from './entities/whatsapp-job-event.entity';
import { WhatsappProcessingJob } from './entities/whatsapp-processing-job.entity';
import { WhatsappBranchResolutionStatus } from './enums/whatsapp-branch-resolution-status.enum';
import { WhatsappJobStatus } from './enums/whatsapp-job-status.enum';
import {
  type BranchCandidate,
  type BranchResolutionResult,
  BRANCH_REPLY_LOOKBACK_MINUTES,
  branchSelectionReplyMatches,
  buildBranchPromptMessage,
  getBranchReplyDeadlineIso,
} from './utils/branch-resolution.util';
import { WhatsappOutboundService } from './whatsapp-outbound.service';
import { WhatsappProcessQueuedService } from './whatsapp-process-queued.service';

@Injectable()
export class WhatsappBranchService {
  constructor(
    @InjectRepository(Sucursal)
    private readonly sucursalRepo: Repository<Sucursal>,
    @InjectRepository(WhatsappBranchRule)
    private readonly ruleRepo: Repository<WhatsappBranchRule>,
    @InjectRepository(WhatsappProcessingJob)
    private readonly jobRepo: Repository<WhatsappProcessingJob>,
    @InjectRepository(WhatsappJobEvent)
    private readonly eventRepo: Repository<WhatsappJobEvent>,
    @InjectRepository(WhatsappInboundMessage)
    private readonly inboundRepo: Repository<WhatsappInboundMessage>,
    private readonly outbound: WhatsappOutboundService,
    @Inject(forwardRef(() => WhatsappProcessQueuedService))
    private readonly processQueued: WhatsappProcessQueuedService,
  ) {}

  async resolveBranchByRules(input: {
    tenantId: string;
    fromWaId: string;
    phoneNumberId: string | null;
    providerId?: string | null;
  }): Promise<BranchResolutionResult> {
    const branches = await this.sucursalRepo.find({
      where: { tenantId: input.tenantId, activa: true },
      order: { esPrincipal: 'DESC', nombre: 'ASC' },
    });

    if (branches.length === 0) {
      return { type: 'not_found', branchId: null, reason: 'no_active_branch', candidates: [] };
    }

    const branchIds = new Set(branches.map((b) => b.id));
    const rules = await this.ruleRepo.find({
      where: { tenantId: input.tenantId, activa: true },
      order: { prioridad: 'DESC' },
    });

    const ranked = new Map<string, number>();
    for (const regla of rules) {
      if (!branchIds.has(regla.sucursalId)) continue;
      const waMatch = !regla.fromWaId || regla.fromWaId === input.fromWaId;
      const phoneMatch =
        !regla.phoneNumberId ||
        (input.phoneNumberId && regla.phoneNumberId === input.phoneNumberId);
      if (!waMatch || !phoneMatch) continue;
      const prev = ranked.get(regla.sucursalId) ?? -9999;
      ranked.set(regla.sucursalId, Math.max(prev, regla.prioridad ?? 0));
    }

    const toCandidates = (rows: Sucursal[]): BranchCandidate[] =>
      rows.map((b) => ({ id: b.id, nombre: b.nombre, codigo: b.codigo }));

    const ruleCandidates = branches
      .filter((b) => ranked.has(b.id))
      .sort((a, b) => (ranked.get(b.id) ?? 0) - (ranked.get(a.id) ?? 0));

    if (ruleCandidates.length === 1) {
      return {
        type: 'resolved_auto',
        branchId: ruleCandidates[0].id,
        reason: 'matched_branch_rule',
        candidates: toCandidates(ruleCandidates),
      };
    }
    if (ruleCandidates.length > 1) {
      return {
        type: 'ambiguous',
        branchId: null,
        reason: 'multiple_branch_rules',
        candidates: toCandidates(ruleCandidates.slice(0, 5)),
      };
    }

    if (branches.length === 1) {
      return {
        type: 'resolved_auto',
        branchId: branches[0].id,
        reason: 'single_active_branch',
        candidates: toCandidates(branches),
      };
    }

    const principalBranches = branches.filter((b) => b.esPrincipal === true);
    if (principalBranches.length === 1) {
      return {
        type: 'resolved_auto',
        branchId: principalBranches[0].id,
        reason: 'principal_branch_default',
        candidates: toCandidates(principalBranches),
      };
    }

    return {
      type: 'ambiguous',
      branchId: null,
      reason: 'multiple_active_branches_without_rule',
      candidates: toCandidates(branches.slice(0, 5)),
    };
  }

  async enqueueBranchOutbound(params: {
    tenantId: string;
    toWaId: string;
    phoneNumberId: string | null;
    body: string;
    relatedJobId?: string | null;
  }): Promise<void> {
    await this.outbound.enqueue({
      tenantId: params.tenantId,
      toWaId: params.toWaId,
      phoneNumberId: params.phoneNumberId,
      body: params.body,
      relatedJobId: params.relatedJobId ?? null,
    });
  }

  private async listPendingBranchJobs(tenantId: string, fromWaId: string) {
    const now = new Date();
    return this.jobRepo.find({
      where: {
        tenantId,
        fromWaId,
        status: WhatsappJobStatus.awaiting_branch_confirmation,
        branchPromptDeadlineAt: MoreThan(now),
      },
      order: { createdAt: 'ASC' },
      select: ['id'],
    });
  }

  private async loadBranchOptionsForJob(jobId: string): Promise<BranchCandidate[]> {
    const event = await this.eventRepo.findOne({
      where: { jobId, eventType: 'branch_options' },
      order: { createdAt: 'DESC' },
    });
    const options = (event?.eventPayload as { options?: BranchCandidate[] } | null)?.options;
    return Array.isArray(options) ? options : [];
  }

  private async confirmPendingJobsWithBranch(params: {
    tenantId: string;
    fromWaId: string;
    phoneNumberId: string | null;
    branchId: string;
    textBody: string;
    jobIds: string[];
  }): Promise<string[]> {
    if (params.jobIds.length === 0) return [];

    await this.jobRepo.update(
      { id: In(params.jobIds), tenantId: params.tenantId },
      {
        status: WhatsappJobStatus.queued,
        branchId: params.branchId,
        branchResolutionStatus: WhatsappBranchResolutionStatus.resolved_manual,
        branchResolutionReason: 'confirmed_from_whatsapp_reply',
        branchPromptDeadlineAt: null,
        branchPromptRequestedAt: null,
      },
    );

    await this.eventRepo.save(
      params.jobIds.map((jobId) => ({
        tenantId: params.tenantId,
        jobId,
        eventType: 'branch_confirmed_from_reply',
        eventPayload: {
          branch_id: params.branchId,
          text: params.textBody,
          bulk: params.jobIds.length > 1,
        },
      })),
    );

    const ack =
      params.jobIds.length === 1
        ? 'Sucursal confirmada. Gracias, continuamos con el procesamiento.'
        : `Sucursal confirmada para ${params.jobIds.length} archivos. Continuamos con el procesamiento.`;

    await this.enqueueBranchOutbound({
      tenantId: params.tenantId,
      toWaId: params.fromWaId,
      phoneNumberId: params.phoneNumberId,
      body: ack,
      relatedJobId: params.jobIds[params.jobIds.length - 1] ?? null,
    });

    return params.jobIds;
  }

  async handleBranchConfirmationReply(params: {
    tenantId: string;
    fromWaId: string;
    phoneNumberId: string | null;
    textBody: string;
  }): Promise<{ handled: boolean; confirmedJobIds: string[] }> {
    const pendingJobs = await this.listPendingBranchJobs(params.tenantId, params.fromWaId);
    if (pendingJobs.length === 0) return { handled: false, confirmedJobIds: [] };

    const firstJobId = pendingJobs[0]!.id;
    let options = await this.loadBranchOptionsForJob(firstJobId);
    if (options.length === 0) {
      const resolution = await this.resolveBranchByRules({
        tenantId: params.tenantId,
        fromWaId: params.fromWaId,
        phoneNumberId: params.phoneNumberId,
      });
      options = resolution.candidates;
    }

    const branchId = branchSelectionReplyMatches(params.textBody, options);
    if (!branchId) return { handled: false, confirmedJobIds: [] };

    const jobIds = pendingJobs.map((j) => j.id);
    const confirmedJobIds = await this.confirmPendingJobsWithBranch({
      tenantId: params.tenantId,
      fromWaId: params.fromWaId,
      phoneNumberId: params.phoneNumberId,
      branchId,
      textBody: params.textBody,
      jobIds,
    });

    if (confirmedJobIds.length > 0) {
      await this.processQueued.run({ tenantId: params.tenantId, jobIds: confirmedJobIds, limit: confirmedJobIds.length });
    }

    return { handled: true, confirmedJobIds };
  }

  async tryAcknowledgeBranchReplyBeforeAttachment(params: {
    tenantId: string;
    fromWaId: string;
    phoneNumberId: string | null;
    textBody: string;
  }): Promise<{ handled: boolean }> {
    const pendingJobs = await this.listPendingBranchJobs(params.tenantId, params.fromWaId);
    if (pendingJobs.length > 0) return { handled: false };

    const resolution = await this.resolveBranchByRules({
      tenantId: params.tenantId,
      fromWaId: params.fromWaId,
      phoneNumberId: params.phoneNumberId,
    });
    if (resolution.type !== 'ambiguous' || resolution.candidates.length < 2) {
      return { handled: false };
    }

    const branchId = branchSelectionReplyMatches(params.textBody, resolution.candidates);
    if (!branchId) return { handled: false };

    await this.enqueueBranchOutbound({
      tenantId: params.tenantId,
      toWaId: params.fromWaId,
      phoneNumberId: params.phoneNumberId,
      body: 'Recibí tu elección de sucursal. Cuando envíes la factura o archivo, la procesamos en esa sucursal.',
    });

    return { handled: true };
  }

  private async findRecentBranchReplyText(params: {
    tenantId: string;
    fromWaId: string;
    candidates: BranchCandidate[];
  }): Promise<{ branchId: string; textBody: string } | null> {
    if (params.candidates.length < 2) return null;

    const since = new Date(Date.now() - BRANCH_REPLY_LOOKBACK_MINUTES * 60_000);
    const messages = await this.inboundRepo.find({
      where: {
        tenantId: params.tenantId,
        fromWaId: params.fromWaId,
        messageType: 'text',
        createdAt: MoreThan(since),
      },
      order: { createdAt: 'DESC' },
      take: 12,
      select: ['textBody'],
    });

    for (const row of messages) {
      const textBody = String(row.textBody ?? '').trim();
      if (!textBody) continue;
      const branchId = branchSelectionReplyMatches(textBody, params.candidates);
      if (branchId) return { branchId, textBody };
    }

    return null;
  }

  async applyRecentBranchReplyToNewJob(params: {
    tenantId: string;
    fromWaId: string;
    phoneNumberId: string | null;
    jobId: string;
    resolution: BranchResolutionResult;
  }): Promise<{ handled: boolean }> {
    if (params.resolution.candidates.length < 2) return { handled: false };

    const recent = await this.findRecentBranchReplyText({
      tenantId: params.tenantId,
      fromWaId: params.fromWaId,
      candidates: params.resolution.candidates,
    });
    if (!recent) return { handled: false };

    const pendingJobs = await this.listPendingBranchJobs(params.tenantId, params.fromWaId);
    const jobIdSet = new Set<string>([...pendingJobs.map((j) => j.id), params.jobId]);
    const jobIds = Array.from(jobIdSet);
    if (jobIds.length === 0) return { handled: false };

    const confirmedJobIds = await this.confirmPendingJobsWithBranch({
      tenantId: params.tenantId,
      fromWaId: params.fromWaId,
      phoneNumberId: params.phoneNumberId,
      branchId: recent.branchId,
      textBody: recent.textBody,
      jobIds,
    });

    if (confirmedJobIds.length > 0) {
      await this.processQueued.run({ tenantId: params.tenantId, jobIds: confirmedJobIds, limit: confirmedJobIds.length });
    }

    return { handled: true };
  }

  buildBranchPrompt(candidates: BranchCandidate[]): string {
    return buildBranchPromptMessage(candidates);
  }

  getReplyDeadline(): Date {
    return new Date(getBranchReplyDeadlineIso());
  }
}
