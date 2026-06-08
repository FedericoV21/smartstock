import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { Usuario } from '../users/entities/usuario.entity';
import { WhatsappActor } from './entities/whatsapp-actor.entity';
import { WhatsappAuthChallenge } from './entities/whatsapp-auth-challenge.entity';
import { WhatsappAuthChallengeStatus } from './enums/whatsapp-auth-challenge-status.enum';
import { WhatsappActorTrustLevel } from './enums/whatsapp-actor-trust-level.enum';
import {
  canonicalWaId,
  generateOtpCode,
  generateOtpSalt,
  hashOtp,
  maskWaId,
  normalizeWaId,
  OTP_BLOCK_MINUTES,
  OTP_EXPIRES_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_RESEND_WINDOW,
  OTP_RESEND_WINDOW_MINUTES,
  verifyOtpHash,
  waIdLookupVariants,
} from './utils/otp.util';
import { WhatsappBaseService } from './whatsapp-base.service';
import { WhatsappInboundRoutingService } from './whatsapp-inbound-routing.service';
import { WhatsappOutboundService } from './whatsapp-outbound.service';

export type RemoveWhatsAppActorMode = 'unlink' | 'delete';

@Injectable()
export class WhatsappActorsService {
  constructor(
    private readonly base: WhatsappBaseService,
    private readonly routing: WhatsappInboundRoutingService,
    private readonly outbound: WhatsappOutboundService,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(WhatsappActor)
    private readonly actorRepo: Repository<WhatsappActor>,
    @InjectRepository(WhatsappAuthChallenge)
    private readonly challengeRepo: Repository<WhatsappAuthChallenge>,
  ) {}

  async listActors(user: AccessTokenPayload) {
    await this.base.assertModuloWhatsApp();
    this.base.assertAdminOrSuper(user);
    const tenantId = this.base.getTenantId();

    const users = await this.usuarioRepo.find({
      where: { tenantId, activo: true },
      order: { nombre: 'ASC' },
      select: ['id', 'nombre', 'apellido', 'email', 'rol', 'activo'],
    });

    const actorRows = await this.actorRepo.find({
      where: { tenantId },
      relations: ['usuario'],
      order: { createdAt: 'DESC' },
      take: 200,
    });

    const visibleActorRows = actorRows.filter((row) => !row.fromWaId.startsWith('sandbox:'));
    const actorIds = visibleActorRows.map((row) => row.id);

    const challengesByActor = new Map<string, WhatsappAuthChallenge>();
    if (actorIds.length > 0) {
      const challenges = await this.challengeRepo.find({
        where: { actorId: In(actorIds) },
        order: { createdAt: 'DESC' },
      });
      for (const row of challenges) {
        if (!challengesByActor.has(row.actorId)) {
          challengesByActor.set(row.actorId, row);
        }
      }
    }

    const actors = visibleActorRows.map((row) => ({
      id: row.id,
      usuario_id: row.usuarioId,
      from_wa_id: row.fromWaId,
      from_wa_id_masked: maskWaId(row.fromWaId),
      rol_whatsapp: row.rolWhatsapp,
      trust_level: row.trustLevel,
      activo: row.activo,
      verified_at: row.verifiedAt,
      created_at: row.createdAt,
      replaced_by_actor_id: row.replacedByActorId,
      usuario: row.usuario
        ? {
            nombre: row.usuario.nombre,
            apellido: row.usuario.apellido,
            email: row.usuario.email,
            rol: row.usuario.rol,
            activo: row.usuario.activo,
          }
        : null,
      latest_challenge: challengesByActor.get(row.id) ?? null,
    }));

    return { users, actors };
  }

  async handlePost(user: AccessTokenPayload, body: Record<string, unknown>) {
    await this.base.assertModuloWhatsApp();
    this.base.assertAdminOrSuper(user);

    const action = String(body.action ?? '').trim();
    const tenantId = this.base.getTenantId();

    if (action === 'request_otp') {
      const userId = String(body.usuario_id ?? '').trim();
      const fromWaIdRaw = String(body.from_wa_id ?? '').trim();
      const actorRole = this.normalizeActorRole(body.rol_whatsapp);
      if (!userId || !fromWaIdRaw) {
        throw new BadRequestException('usuario_id y from_wa_id son obligatorios.');
      }
      return this.requestOtp({ tenantId, userId, fromWaIdRaw, actorRole });
    }

    if (action === 'verify_otp') {
      const actorId = String(body.actor_id ?? '').trim();
      const code = String(body.code ?? '').trim();
      if (!actorId || !code) {
        throw new BadRequestException('actor_id y code son obligatorios.');
      }
      return this.verifyOtp({ tenantId, actorId, code });
    }

    if (action === 'remove_actor') {
      const actorId = String(body.actor_id ?? '').trim();
      const modeRaw = String(body.mode ?? 'delete').trim().toLowerCase();
      const mode: RemoveWhatsAppActorMode = modeRaw === 'unlink' ? 'unlink' : 'delete';
      if (!actorId) {
        throw new BadRequestException('actor_id es obligatorio.');
      }
      return this.removeActor({ tenantId, actorId, mode });
    }

    throw new BadRequestException('Acción inválida.');
  }

  private normalizeActorRole(input: unknown): string {
    const value = String(input ?? '').trim().toLowerCase();
    if (value === 'owner' || value === 'admin' || value === 'operador' || value === 'readonly') {
      return value;
    }
    return 'operador';
  }

  private async requestOtp(params: {
    tenantId: string;
    userId: string;
    fromWaIdRaw: string;
    actorRole: string;
  }) {
    const fromWaId = canonicalWaId(params.fromWaIdRaw) ?? normalizeWaId(params.fromWaIdRaw);
    if (!fromWaId) {
      throw new BadRequestException(
        'Número de WhatsApp inválido. Usá formato internacional (solo dígitos).',
      );
    }

    const userRow = await this.usuarioRepo.findOne({
      where: { id: params.userId, tenantId: params.tenantId },
    });
    if (!userRow) throw new NotFoundException('Usuario no encontrado en este negocio.');
    if (!userRow.activo) throw new BadRequestException('El usuario está inactivo.');

    const phoneNumberId = await this.routing.getPlatformPhoneNumberId();
    if (!phoneNumberId) {
      throw new ConflictException(
        'No hay canal WhatsApp central activo. Un super admin debe configurarlo en la bandeja de WhatsApp o via WHATSAPP_PLATFORM_PHONE_NUMBER_ID.',
      );
    }

    const variants = waIdLookupVariants(fromWaId);
    const activeLookupValues = variants.length > 0 ? variants : [fromWaId];
    const activeRows = await this.actorRepo.find({
      where: { tenantId: params.tenantId, activo: true, fromWaId: In(activeLookupValues) },
      take: 5,
    });

    const conflicting = activeRows.find((row) => row.usuarioId !== params.userId);
    if (conflicting) {
      throw new ConflictException(
        'Ese número ya está vinculado a otro usuario activo del negocio. Eliminalo o desvinculalo desde la tabla de vinculaciones.',
      );
    }

    let actor =
      activeRows.find((row) => row.fromWaId === fromWaId) ?? activeRows[0] ?? null;

    if (!actor) {
      const inactive = await this.actorRepo.findOne({
        where: {
          tenantId: params.tenantId,
          usuarioId: params.userId,
          activo: false,
          fromWaId: In(activeLookupValues),
        },
        order: { createdAt: 'DESC' },
      });
      if (inactive) {
        await this.actorRepo.update(inactive.id, {
          activo: true,
          rolWhatsapp: params.actorRole,
          trustLevel: WhatsappActorTrustLevel.unverified,
          verifiedAt: null,
        });
        actor = { ...inactive, activo: true } as WhatsappActor;
      }
    }

    if (!actor) {
      actor = await this.actorRepo.save({
        tenantId: params.tenantId,
        usuarioId: params.userId,
        fromWaId,
        rolWhatsapp: params.actorRole,
        trustLevel: WhatsappActorTrustLevel.unverified,
        activo: true,
        verifiedAt: null,
        replacedByActorId: null,
      });
    } else {
      await this.actorRepo.update(actor.id, { rolWhatsapp: params.actorRole });
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - OTP_RESEND_WINDOW_MINUTES * 60_000);
    const resendCount = await this.challengeRepo.count({
      where: {
        tenantId: params.tenantId,
        actorId: actor.id,
        createdAt: MoreThan(windowStart),
      },
    });

    if (resendCount >= OTP_MAX_RESEND_WINDOW) {
      throw new HttpException(
        `Demasiados reenvíos. Probá nuevamente en ${OTP_RESEND_WINDOW_MINUTES} minutos.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const lastChallenge = await this.challengeRepo.findOne({
      where: { tenantId: params.tenantId, actorId: actor.id },
      order: { createdAt: 'DESC' },
    });

    if (
      lastChallenge?.status === WhatsappAuthChallengeStatus.blocked &&
      lastChallenge.blockedUntil &&
      lastChallenge.blockedUntil.getTime() > now.getTime()
    ) {
      throw new HttpException(
        'Número temporalmente bloqueado por intentos fallidos. Esperá antes de reenviar.',
        423,
      );
    }

    await this.challengeRepo.update(
      { tenantId: params.tenantId, actorId: actor.id, status: WhatsappAuthChallengeStatus.pending },
      { status: WhatsappAuthChallengeStatus.cancelled },
    );

    const otpCode = generateOtpCode();
    const otpSalt = generateOtpSalt();
    const otpHash = hashOtp(otpCode, otpSalt);
    const expiresAt = new Date(now.getTime() + OTP_EXPIRES_MINUTES * 60_000);

    const challenge = await this.challengeRepo.save({
      tenantId: params.tenantId,
      actorId: actor.id,
      channelPhoneNumberId: phoneNumberId,
      otpHash,
      otpSalt,
      expiresAt,
      attemptCount: 0,
      maxAttempts: OTP_MAX_ATTEMPTS,
      resendCount: resendCount + 1,
      status: WhatsappAuthChallengeStatus.pending,
      blockedUntil: null,
      verifiedAt: null,
    });

    const outboundBody = [
      `Codigo de verificacion SmartStock: ${otpCode}`,
      `Vence en ${OTP_EXPIRES_MINUTES} minutos.`,
      'Si no solicitaste este codigo, ignora este mensaje.',
    ].join('\n');

    const outboundIds = await this.outbound.enqueue({
      tenantId: params.tenantId,
      toWaId: fromWaId,
      phoneNumberId,
      body: outboundBody,
      autoFlush: this.outbound.shouldAutoFlushOtpOutbound(),
    });

    const outboundAutoFlush = {
      attempted: this.outbound.shouldAutoFlushOtpOutbound(),
      processed: 0,
      sent: 0,
      failed: 0,
    };

    if (outboundAutoFlush.attempted && outboundIds.length > 0) {
      const stats = await this.outbound.processQueue({
        tenantId: params.tenantId,
        messageIds: outboundIds,
        limit: 20,
      });
      outboundAutoFlush.processed = stats.processed;
      outboundAutoFlush.sent = stats.sent;
      outboundAutoFlush.failed = stats.failed;
    }

    return {
      ok: true,
      actor_id: actor.id,
      challenge_id: challenge.id,
      expires_at: challenge.expiresAt,
      to_wa_id_masked: maskWaId(fromWaId),
      outbound_auto_flush: outboundAutoFlush,
    };
  }

  private async verifyOtp(params: { tenantId: string; actorId: string; code: string }) {
    if (!/^\d{4,8}$/.test(params.code)) {
      throw new BadRequestException('El código OTP debe tener entre 4 y 8 dígitos.');
    }

    const actor = await this.actorRepo.findOne({
      where: { tenantId: params.tenantId, id: params.actorId },
    });
    if (!actor) throw new NotFoundException('Vinculación no encontrada.');

    const challenge = await this.challengeRepo.findOne({
      where: { tenantId: params.tenantId, actorId: params.actorId },
      order: { createdAt: 'DESC' },
    });
    if (!challenge) {
      throw new NotFoundException('No hay OTP pendiente para esta vinculación.');
    }

    const now = new Date();
    if (
      challenge.status === WhatsappAuthChallengeStatus.blocked &&
      challenge.blockedUntil &&
      challenge.blockedUntil.getTime() > now.getTime()
    ) {
      throw new HttpException('Vinculación bloqueada temporalmente por intentos fallidos.', 423);
    }

    if (challenge.status !== WhatsappAuthChallengeStatus.pending) {
      throw new ConflictException(
        `El challenge actual está en estado "${challenge.status}". Solicitá un nuevo código.`,
      );
    }

    if (challenge.expiresAt.getTime() < now.getTime()) {
      await this.challengeRepo.update(challenge.id, { status: WhatsappAuthChallengeStatus.expired });
      throw new GoneException('El código expiró. Solicitá uno nuevo.');
    }

    const ok = verifyOtpHash(params.code, challenge.otpSalt, challenge.otpHash);
    if (!ok) {
      const nextAttempts = challenge.attemptCount + 1;
      const shouldBlock = nextAttempts >= challenge.maxAttempts;

      if (shouldBlock) {
        await this.challengeRepo.update(challenge.id, {
          status: WhatsappAuthChallengeStatus.blocked,
          attemptCount: nextAttempts,
          blockedUntil: new Date(now.getTime() + OTP_BLOCK_MINUTES * 60_000),
        });
        await this.actorRepo.update(actor.id, { trustLevel: WhatsappActorTrustLevel.blocked });
        throw new HttpException(
          `Demasiados intentos fallidos. Bloqueado por ${OTP_BLOCK_MINUTES} minutos.`,
          423,
        );
      }

      await this.challengeRepo.update(challenge.id, { attemptCount: nextAttempts });
      throw new BadRequestException({
        error: 'Código incorrecto.',
        attempts_left: Math.max(0, challenge.maxAttempts - nextAttempts),
      });
    }

    const nowIso = now;
    await this.challengeRepo.update(challenge.id, {
      status: WhatsappAuthChallengeStatus.verified,
      verifiedAt: nowIso,
      blockedUntil: null,
    });

    await this.actorRepo.update(actor.id, {
      trustLevel: WhatsappActorTrustLevel.verified,
      verifiedAt: nowIso,
      activo: true,
    });

    await this.actorRepo
      .createQueryBuilder()
      .update()
      .set({ activo: false, replacedByActorId: actor.id })
      .where('tenant_id = :tenantId', { tenantId: params.tenantId })
      .andWhere('usuario_id = :usuarioId', { usuarioId: actor.usuarioId })
      .andWhere('activo = true')
      .andWhere('id != :actorId', { actorId: actor.id })
      .execute();

    const verifiedActor = await this.actorRepo.findOne({ where: { id: actor.id } });
    if (verifiedActor?.fromWaId) {
      await this.routing.syncPlatformRoutingForVerifiedActor(
        params.tenantId,
        verifiedActor.fromWaId,
      );
    }

    return {
      ok: true,
      actor_id: actor.id,
      trust_level: 'verified',
      verified_at: nowIso,
    };
  }

  private async removeActor(params: {
    tenantId: string;
    actorId: string;
    mode: RemoveWhatsAppActorMode;
  }) {
    const actor = await this.actorRepo.findOne({
      where: { tenantId: params.tenantId, id: params.actorId },
    });
    if (!actor) throw new NotFoundException('Vinculación no encontrada.');

    await this.challengeRepo.update(
      {
        tenantId: params.tenantId,
        actorId: params.actorId,
        status: In([WhatsappAuthChallengeStatus.pending, WhatsappAuthChallengeStatus.blocked]),
      },
      { status: WhatsappAuthChallengeStatus.cancelled },
    );

    if (params.mode === 'delete') {
      if (actor.trustLevel === WhatsappActorTrustLevel.verified && actor.activo) {
        throw new BadRequestException(
          'No se puede eliminar una vinculación verificada activa. Desvinculala primero.',
        );
      }
      await this.actorRepo.delete({ id: actor.id, tenantId: params.tenantId });
    } else {
      await this.actorRepo.update(actor.id, {
        activo: false,
        trustLevel: WhatsappActorTrustLevel.unverified,
        verifiedAt: null,
      });
    }

    return { ok: true, mode: params.mode, actor_id: params.actorId };
  }
}
