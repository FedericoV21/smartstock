import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { WhatsappAgentFeatureFlag } from './entities/whatsapp-agent-feature-flag.entity';
import { WhatsappBaseService } from './whatsapp-base.service';

@Injectable()
export class WhatsappFeatureFlagService {
  constructor(
    private readonly base: WhatsappBaseService,
    @InjectRepository(WhatsappAgentFeatureFlag)
    private readonly flagRepo: Repository<WhatsappAgentFeatureFlag>,
  ) {}

  private async loadFlag(tenantId: string) {
    const row = await this.flagRepo.findOne({ where: { tenantId } });
    if (!row) {
      return { enabled: false, rolloutStage: 'disabled', notes: null as string | null };
    }
    return {
      enabled: row.enabled,
      rolloutStage: row.rolloutStage,
      notes: row.notes,
    };
  }

  async getFeatureFlag(user: AccessTokenPayload) {
    await this.base.assertModuloWhatsApp();
    const tenantId = this.base.getTenantId();
    const feature = await this.loadFlag(tenantId);

    return {
      enabled: feature.enabled,
      rollout_stage: feature.rolloutStage,
      notes: feature.notes,
      can_manage: this.base.isAdminOrSuper(user),
    };
  }

  async patchFeatureFlag(user: AccessTokenPayload, body: Record<string, unknown>) {
    await this.base.assertModuloWhatsApp();
    this.base.assertAdminOrSuper(user);

    const tenantId = this.base.getTenantId();
    const enabled = Boolean(body.enabled);
    const stageRaw = String(body.rollout_stage ?? '').trim().toLowerCase();
    const rolloutStage = stageRaw || (enabled ? 'pilot' : 'disabled');
    const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;

    await this.flagRepo.save({
      tenantId,
      enabled,
      rolloutStage,
      notes,
    });

    return { ok: true, enabled, rollout_stage: rolloutStage, notes };
  }
}
