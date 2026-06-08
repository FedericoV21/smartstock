import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Tenant } from '../config/entities/tenant.entity';
import { WhatsappActor } from './entities/whatsapp-actor.entity';
import { WhatsappChannel } from './entities/whatsapp-channel.entity';
import { WhatsappPlatformChannel } from './entities/whatsapp-platform-channel.entity';
import { WhatsappPlatformRoutingState } from './entities/whatsapp-platform-routing-state.entity';
import { WhatsappActorTrustLevel } from './enums/whatsapp-actor-trust-level.enum';
import { canonicalWaId, waIdLookupVariants, waIdsMatch } from './utils/otp.util';
import {
  getWhatsAppPlatformPhoneNumberIdFromEnv,
  normalizeWhatsAppPhoneNumberId,
} from './utils/whatsapp-phone.util';
import { WhatsappMetaService } from './whatsapp-meta.service';

export type WhatsAppTenantChoice = {
  tenantId: string;
  tenantName: string;
  actorId: string;
  trustLevel: string;
};

export type WhatsAppInboundTenantResolution =
  | {
      mode: 'platform';
      tenantId: string;
      actorId: string | null;
      trustLevel: string | null;
    }
  | { mode: 'legacy_channel'; tenantId: string }
  | {
      mode: 'unroutable';
      reason: 'platform_inactive' | 'unknown_phone_number_id' | 'no_actor' | 'pending_tenant_selection';
      handled: boolean;
    };

const SELECTED_TENANT_TTL_DAYS = 30;
const PENDING_SELECTION_TTL_MINUTES = 30;

@Injectable()
export class WhatsappInboundRoutingService {
  constructor(
    @InjectRepository(WhatsappActor)
    private readonly actorRepo: Repository<WhatsappActor>,
    @InjectRepository(WhatsappPlatformRoutingState)
    private readonly routingRepo: Repository<WhatsappPlatformRoutingState>,
    @InjectRepository(WhatsappChannel)
    private readonly channelRepo: Repository<WhatsappChannel>,
    @InjectRepository(WhatsappPlatformChannel)
    private readonly platformChannelRepo: Repository<WhatsappPlatformChannel>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly meta: WhatsappMetaService,
  ) {}

  async getPlatformPhoneNumberId(): Promise<string | null> {
    const envId = getWhatsAppPlatformPhoneNumberIdFromEnv();
    if (envId) return envId;

    const row = await this.platformChannelRepo.findOne({
      where: { activa: true },
      order: { updatedAt: 'DESC' },
    });
    return row ? normalizeWhatsAppPhoneNumberId(row.phoneNumberId) : null;
  }

  isPlatformPhoneNumberId(phoneNumberId: string, platformPhoneNumberId: string | null): boolean {
    if (!platformPhoneNumberId) return false;
    return normalizeWhatsAppPhoneNumberId(phoneNumberId) === platformPhoneNumberId;
  }

  private trustRank(value: string): number {
    if (value === 'verified') return 0;
    if (value === 'unverified') return 1;
    if (value === 'blocked') return 2;
    return 3;
  }

  private parseTenantChoices(raw: unknown): WhatsAppTenantChoice[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const row = item as Record<string, unknown>;
        const tenantId = String(row.tenantId ?? row.tenant_id ?? '').trim();
        const tenantName = String(row.tenantName ?? row.tenant_name ?? '').trim();
        const actorId = String(row.actorId ?? row.actor_id ?? '').trim();
        const trustLevel = String(row.trustLevel ?? row.trust_level ?? 'unverified').trim();
        if (!tenantId || !tenantName || !actorId) return null;
        return { tenantId, tenantName, actorId, trustLevel };
      })
      .filter((item): item is WhatsAppTenantChoice => item != null);
  }

  private buildTenantSelectionPrompt(choices: WhatsAppTenantChoice[]): string {
    const lines = choices.map((choice, index) => `${index + 1}. ${choice.tenantName}`);
    return [
      'Tu numero esta vinculado a mas de un negocio en SmartStock.',
      'Responde con el numero del negocio con el que queres operar:',
      ...lines,
    ].join('\n');
  }

  private unknownSenderPrompt(): string {
    return [
      'Hola. Este es el canal de consultas de SmartStock.',
      'Tu numero todavia no esta vinculado a ningun negocio.',
      'Pedile al administrador de tu comercio que registre tu WhatsApp en la bandeja de WhatsApp del sistema y complete la verificacion por codigo OTP.',
    ].join('\n');
  }

  private async sendDirectPlatformReply(params: {
    phoneNumberId: string;
    toWaId: string;
    body: string;
  }): Promise<boolean> {
    try {
      await this.meta.sendText({
        phoneNumberId: params.phoneNumberId,
        toWaId: params.toWaId,
        body: params.body,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async loadRoutingState(fromWaId: string): Promise<WhatsappPlatformRoutingState | null> {
    const keys = waIdLookupVariants(fromWaId);
    const lookupKeys = keys.length > 0 ? keys : [fromWaId];

    for (const key of lookupKeys) {
      const row = await this.routingRepo.findOne({ where: { fromWaId: key } });
      if (!row) continue;
      if (row.expiresAt.getTime() < Date.now()) {
        await this.routingRepo.delete({ fromWaId: key });
        continue;
      }
      return row;
    }
    return null;
  }

  private async saveSelectedTenant(fromWaId: string, tenantId: string) {
    const expiresAt = new Date(Date.now() + SELECTED_TENANT_TTL_DAYS * 24 * 60 * 60_000);
    await this.routingRepo.save({
      fromWaId,
      selectedTenantId: tenantId,
      pendingChoices: [],
      expiresAt,
    });
  }

  private async savePendingTenantChoices(fromWaId: string, choices: WhatsAppTenantChoice[]) {
    const expiresAt = new Date(Date.now() + PENDING_SELECTION_TTL_MINUTES * 60_000);
    await this.routingRepo.save({
      fromWaId,
      selectedTenantId: null,
      pendingChoices: choices,
      expiresAt,
    });
  }

  private async clearPendingTenantChoices(fromWaId: string) {
    const row = await this.routingRepo.findOne({ where: { fromWaId } });
    if (!row) return;
    await this.routingRepo.update({ fromWaId }, { pendingChoices: [] });
  }

  private async loadActorsForSender(fromWaId: string): Promise<WhatsappActor[]> {
    const variants = waIdLookupVariants(fromWaId);
    let rows: WhatsappActor[] = [];

    if (variants.length > 0) {
      rows = await this.actorRepo.find({
        where: { activo: true, fromWaId: In(variants) },
        take: 20,
      });
    }

    if (rows.length === 0) {
      const all = await this.actorRepo.find({ where: { activo: true }, take: 50 });
      rows = all.filter((row) => waIdsMatch(row.fromWaId, fromWaId));
    }

    const byTenant = new Map<string, WhatsappActor>();
    for (const row of rows) {
      if (row.trustLevel === WhatsappActorTrustLevel.blocked) continue;
      const existing = byTenant.get(row.tenantId);
      if (!existing || this.trustRank(row.trustLevel) < this.trustRank(existing.trustLevel)) {
        byTenant.set(row.tenantId, row);
      }
    }

    return Array.from(byTenant.values()).sort(
      (a, b) => this.trustRank(a.trustLevel) - this.trustRank(b.trustLevel),
    );
  }

  private async actorChoices(rows: WhatsappActor[]): Promise<WhatsAppTenantChoice[]> {
    const out: WhatsAppTenantChoice[] = [];
    for (const row of rows) {
      const tenant = await this.tenantRepo.findOne({ where: { id: row.tenantId }, select: ['nombre'] });
      out.push({
        tenantId: row.tenantId,
        tenantName: tenant?.nombre?.trim() || 'Negocio sin nombre',
        actorId: row.id,
        trustLevel: row.trustLevel,
      });
    }
    return out;
  }

  private async resolveLegacyDedicatedChannelTenant(
    phoneNumberId: string,
    platformPhoneNumberId: string | null,
  ): Promise<string | null> {
    if (this.isPlatformPhoneNumberId(phoneNumberId, platformPhoneNumberId)) return null;

    const channel = await this.channelRepo.findOne({
      where: { phoneNumberId, activa: true },
      order: { updatedAt: 'DESC' },
    });
    return channel?.tenantId ?? null;
  }

  private async resolvePlatformTenant(params: {
    fromWaId: string;
    phoneNumberId: string;
    textBody?: string | null;
  }): Promise<WhatsAppInboundTenantResolution> {
    const actors = await this.loadActorsForSender(params.fromWaId);
    const routingState = await this.loadRoutingState(params.fromWaId);
    const pendingChoices = this.parseTenantChoices(routingState?.pendingChoices);

    if (pendingChoices.length > 0 && params.textBody) {
      const selected = parseTenantSelectionReply(params.textBody, pendingChoices);
      if (selected) {
        await this.saveSelectedTenant(params.fromWaId, selected.tenantId);
        return {
          mode: 'platform',
          tenantId: selected.tenantId,
          actorId: selected.actorId,
          trustLevel: selected.trustLevel,
        };
      }

      await this.sendDirectPlatformReply({
        phoneNumberId: params.phoneNumberId,
        toWaId: params.fromWaId,
        body: this.buildTenantSelectionPrompt(pendingChoices),
      });
      return { mode: 'unroutable', reason: 'pending_tenant_selection', handled: true };
    }

    const verifiedActors = actors.filter((row) => row.trustLevel === WhatsappActorTrustLevel.verified);
    if (verifiedActors.length === 1) {
      const only = verifiedActors[0];
      await this.saveSelectedTenant(params.fromWaId, only.tenantId);
      return {
        mode: 'platform',
        tenantId: only.tenantId,
        actorId: only.id,
        trustLevel: only.trustLevel,
      };
    }

    if (verifiedActors.length > 1) {
      const choices = await this.actorChoices(verifiedActors);
      await this.savePendingTenantChoices(params.fromWaId, choices);
      await this.sendDirectPlatformReply({
        phoneNumberId: params.phoneNumberId,
        toWaId: params.fromWaId,
        body: this.buildTenantSelectionPrompt(choices),
      });
      return { mode: 'unroutable', reason: 'pending_tenant_selection', handled: true };
    }

    if (routingState?.selectedTenantId) {
      const selectedActor = actors.find((row) => row.tenantId === routingState.selectedTenantId);
      if (selectedActor && selectedActor.trustLevel === WhatsappActorTrustLevel.verified) {
        await this.clearPendingTenantChoices(params.fromWaId);
        return {
          mode: 'platform',
          tenantId: selectedActor.tenantId,
          actorId: selectedActor.id,
          trustLevel: selectedActor.trustLevel,
        };
      }
    }

    if (actors.length === 0) {
      await this.sendDirectPlatformReply({
        phoneNumberId: params.phoneNumberId,
        toWaId: params.fromWaId,
        body: this.unknownSenderPrompt(),
      });
      return { mode: 'unroutable', reason: 'no_actor', handled: true };
    }

    const choices = await this.actorChoices(actors);
    if (choices.length === 1) {
      const only = choices[0];
      await this.saveSelectedTenant(params.fromWaId, only.tenantId);
      return {
        mode: 'platform',
        tenantId: only.tenantId,
        actorId: only.actorId,
        trustLevel: only.trustLevel,
      };
    }

    await this.savePendingTenantChoices(params.fromWaId, choices);
    await this.sendDirectPlatformReply({
      phoneNumberId: params.phoneNumberId,
      toWaId: params.fromWaId,
      body: this.buildTenantSelectionPrompt(choices),
    });
    return { mode: 'unroutable', reason: 'pending_tenant_selection', handled: true };
  }

  private async resolveSingleVerifiedActorTenant(fromWaId: string): Promise<WhatsAppInboundTenantResolution | null> {
    const actors = (await this.loadActorsForSender(fromWaId)).filter(
      (row) => row.trustLevel === WhatsappActorTrustLevel.verified,
    );
    if (actors.length !== 1) return null;

    const actor = actors[0];
    return {
      mode: 'platform',
      tenantId: actor.tenantId,
      actorId: actor.id,
      trustLevel: actor.trustLevel,
    };
  }

  async resolveInboundTenant(params: {
    phoneNumberId: string;
    fromWaId: string;
    textBody?: string | null;
  }): Promise<WhatsAppInboundTenantResolution> {
    const platformPhoneNumberId = await this.getPlatformPhoneNumberId();

    const verifiedTenant = await this.resolveSingleVerifiedActorTenant(params.fromWaId);
    if (verifiedTenant) return verifiedTenant;

    if (this.isPlatformPhoneNumberId(params.phoneNumberId, platformPhoneNumberId)) {
      return this.resolvePlatformTenant({
        fromWaId: params.fromWaId,
        phoneNumberId: params.phoneNumberId,
        textBody: params.textBody,
      });
    }

    const legacyTenantId = await this.resolveLegacyDedicatedChannelTenant(
      params.phoneNumberId,
      platformPhoneNumberId,
    );
    if (legacyTenantId) {
      return { mode: 'legacy_channel', tenantId: legacyTenantId };
    }

    if (!platformPhoneNumberId) {
      return { mode: 'unroutable', reason: 'platform_inactive', handled: false };
    }

    return { mode: 'unroutable', reason: 'unknown_phone_number_id', handled: false };
  }

  async syncPlatformRoutingForVerifiedActor(tenantId: string, fromWaId: string): Promise<void> {
    const lookupKeys = waIdLookupVariants(fromWaId);
    const keys = lookupKeys.length > 0 ? lookupKeys : [fromWaId];
    const canonical = canonicalWaId(fromWaId) ?? fromWaId;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);

    if (keys.length > 0) {
      await this.routingRepo.delete({ fromWaId: In(keys) });
    }

    await this.routingRepo.save({
      fromWaId: canonical,
      selectedTenantId: tenantId,
      pendingChoices: [],
      expiresAt,
    });
  }
}

function parseTenantSelectionReply(text: string, choices: WhatsAppTenantChoice[]): WhatsAppTenantChoice | null {
  const trimmed = text.trim();
  if (!trimmed || choices.length === 0) return null;

  const numeric = Number(trimmed.replace(/[^\d]/g, ''));
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= choices.length) {
    return choices[numeric - 1] ?? null;
  }

  const lower = trimmed.toLowerCase();
  const exact = choices.find((choice) => choice.tenantName.toLowerCase() === lower);
  if (exact) return exact;

  const partialMatches = choices.filter((choice) => {
    const name = choice.tenantName.toLowerCase();
    return name.includes(lower) || lower.includes(name);
  });
  if (partialMatches.length === 1) return partialMatches[0] ?? null;

  return null;
}
