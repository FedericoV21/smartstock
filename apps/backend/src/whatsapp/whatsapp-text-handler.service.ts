import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { WhatsappAgentFeatureFlag } from './entities/whatsapp-agent-feature-flag.entity';
import { WhatsappActor } from './entities/whatsapp-actor.entity';
import { WhatsappActorTrustLevel } from './enums/whatsapp-actor-trust-level.enum';
import { waIdLookupVariants } from './utils/otp.util';
import { WhatsappBranchService } from './whatsapp-branch.service';
import { WhatsappOutboundService } from './whatsapp-outbound.service';
import { WhatsappReadOnlyAgentService } from './whatsapp-read-only-agent.service';

@Injectable()
export class WhatsappTextHandlerService {
  constructor(
    @Inject(forwardRef(() => WhatsappBranchService))
    private readonly branchService: WhatsappBranchService,
    private readonly outbound: WhatsappOutboundService,
    private readonly readOnlyAgent: WhatsappReadOnlyAgentService,
    @InjectRepository(WhatsappAgentFeatureFlag)
    private readonly flagRepo: Repository<WhatsappAgentFeatureFlag>,
    @InjectRepository(WhatsappActor)
    private readonly actorRepo: Repository<WhatsappActor>,
  ) {}

  private async loadFeatureFlag(tenantId: string) {
    const row = await this.flagRepo.findOne({ where: { tenantId } });
    if (!row) {
      return { enabled: false, rolloutStage: 'disabled' };
    }
    return { enabled: row.enabled, rolloutStage: row.rolloutStage };
  }

  async handleTextMessage(params: {
    tenantId: string;
    fromWaId: string;
    phoneNumberId: string | null;
    inboundMessageId: string;
    textBody: string;
    source: 'webhook_text' | 'audio_stt';
    resolvedActorId?: string | null;
  }): Promise<void> {
    const text = params.textBody.trim();
    if (!text) return;

    if (params.source === 'webhook_text') {
      const branchResult = await this.branchService.handleBranchConfirmationReply({
        tenantId: params.tenantId,
        fromWaId: params.fromWaId,
        phoneNumberId: params.phoneNumberId,
        textBody: text,
      });
      if (branchResult.handled) return;

      const earlyBranch = await this.branchService.tryAcknowledgeBranchReplyBeforeAttachment({
        tenantId: params.tenantId,
        fromWaId: params.fromWaId,
        phoneNumberId: params.phoneNumberId,
        textBody: text,
      });
      if (earlyBranch.handled) return;
    }

    const featureFlag = await this.loadFeatureFlag(params.tenantId);
    if (!featureFlag.enabled) {
      if (params.source === 'webhook_text') {
        await this.outbound.enqueue({
          tenantId: params.tenantId,
          toWaId: params.fromWaId,
          phoneNumberId: params.phoneNumberId,
          body: 'El canal de consultas por WhatsApp todavía no está habilitado para este negocio.',
        });
      }
      return;
    }

    let actor: WhatsappActor | null = null;
    if (params.resolvedActorId) {
      actor = await this.actorRepo.findOne({
        where: { id: params.resolvedActorId, tenantId: params.tenantId, activo: true },
      });
    }
    if (!actor) {
      const variants = waIdLookupVariants(params.fromWaId);
      if (variants.length > 0) {
        actor = await this.actorRepo.findOne({
          where: { tenantId: params.tenantId, activo: true, fromWaId: In(variants) },
          order: { createdAt: 'DESC' },
        });
      }
    }

    const trustLevel = actor?.trustLevel ?? WhatsappActorTrustLevel.unverified;
    if (!actor || trustLevel === WhatsappActorTrustLevel.unverified) {
      await this.outbound.enqueue({
        tenantId: params.tenantId,
        toWaId: params.fromWaId,
        phoneNumberId: params.phoneNumberId,
        body: 'Tu número todavía no está vinculado/verificado en SmartStock. Pedile a un administrador que complete la vinculación por OTP.',
      });
      return;
    }

    if (trustLevel === WhatsappActorTrustLevel.blocked) {
      await this.outbound.enqueue({
        tenantId: params.tenantId,
        toWaId: params.fromWaId,
        phoneNumberId: params.phoneNumberId,
        body: 'Tu número de WhatsApp está temporalmente bloqueado. Pedile a un administrador que vuelva a verificar la vinculación.',
      });
      return;
    }

    const agentResult = await this.readOnlyAgent.run({
      tenantId: params.tenantId,
      textBody: text,
      channel: 'live',
      source: params.source,
      actorId: actor.id,
      fromWaId: params.fromWaId,
      inboundMessageId: params.inboundMessageId,
    });

    await this.outbound.enqueue({
      tenantId: params.tenantId,
      toWaId: params.fromWaId,
      phoneNumberId: params.phoneNumberId,
      body: agentResult.reply,
    });
  }
}
