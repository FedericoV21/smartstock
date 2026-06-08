import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { WhatsappActor } from './entities/whatsapp-actor.entity';
import { WhatsappPlatformChannel } from './entities/whatsapp-platform-channel.entity';
import { WhatsappActorTrustLevel } from './enums/whatsapp-actor-trust-level.enum';
import {
  getWhatsAppPlatformPhoneNumberIdFromEnv,
  normalizeWhatsAppPhoneNumberId,
} from './utils/whatsapp-phone.util';
import { WhatsappBaseService } from './whatsapp-base.service';

@Injectable()
export class WhatsappPlatformChannelService {
  constructor(
    private readonly base: WhatsappBaseService,
    @InjectRepository(WhatsappPlatformChannel)
    private readonly platformChannelRepo: Repository<WhatsappPlatformChannel>,
    @InjectRepository(WhatsappActor)
    private readonly actorRepo: Repository<WhatsappActor>,
  ) {}

  async getChannel(user: AccessTokenPayload) {
    await this.base.assertModuloWhatsApp();
    const tenantId = this.base.getTenantId();

    const envPhoneNumberId = getWhatsAppPlatformPhoneNumberIdFromEnv();
    let platformChannel: WhatsappPlatformChannel | null = null;

    if (envPhoneNumberId) {
      platformChannel = {
        id: 'env',
        phoneNumberId: envPhoneNumberId,
        activa: true,
      } as WhatsappPlatformChannel;
    } else {
      platformChannel = await this.platformChannelRepo.findOne({
        where: { activa: true },
        order: { updatedAt: 'DESC' },
      });
    }

    const linkedVerifiedActors = await this.actorRepo.count({
      where: {
        tenantId,
        activo: true,
        trustLevel: WhatsappActorTrustLevel.verified,
      },
    });

    const phoneNumberId = platformChannel
      ? normalizeWhatsAppPhoneNumberId(platformChannel.phoneNumberId)
      : null;

    return {
      mode: 'platform',
      channel_id: platformChannel?.id ?? null,
      phone_number_id: phoneNumberId || null,
      activa: Boolean(platformChannel?.activa),
      has_channel: Boolean(phoneNumberId),
      configured_via_env: Boolean(envPhoneNumberId),
      can_manage_platform: this.base.isSuperAdmin(user),
      linked_verified_actors: linkedVerifiedActors,
    };
  }

  async patchChannel(user: AccessTokenPayload, body: Record<string, unknown>) {
    await this.base.assertModuloWhatsApp();
    this.base.assertSuperAdmin(user);

    if (getWhatsAppPlatformPhoneNumberIdFromEnv()) {
      throw new ConflictException(
        'El canal central esta fijado por WHATSAPP_PLATFORM_PHONE_NUMBER_ID en el entorno. Quita esa variable para editarlo desde la UI.',
      );
    }

    const phoneNumberId = normalizeWhatsAppPhoneNumberId(body.phone_number_id);
    const activa = body.activa === undefined ? true : Boolean(body.activa);

    if (activa && !phoneNumberId) {
      throw new BadRequestException(
        'Para activar el canal central, indicá un Phone Number ID válido.',
      );
    }

    if (!activa) {
      if (phoneNumberId) {
        await this.platformChannelRepo.update({ phoneNumberId }, { activa: false });
      } else {
        await this.platformChannelRepo.update({ activa: true }, { activa: false });
      }

      return {
        ok: true,
        mode: 'platform',
        channel_id: null,
        phone_number_id: phoneNumberId || null,
        activa: false,
      };
    }

    const upserted = await this.platformChannelRepo.save({
      phoneNumberId,
      activa: true,
    });

    await this.platformChannelRepo.update(
      { phoneNumberId: Not(phoneNumberId) },
      { activa: false },
    );

    return {
      ok: true,
      mode: 'platform',
      channel_id: upserted.id,
      phone_number_id: upserted.phoneNumberId,
      activa: Boolean(upserted.activa),
    };
  }
}
