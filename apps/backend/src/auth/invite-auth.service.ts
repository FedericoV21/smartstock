import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { UsuarioCredencialPassword } from '../rbac/entities/usuario-credencial-password.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { AuthSessionService } from './auth-session.service';
import { UsuarioInviteToken } from './entities/usuario-invite-token.entity';
import { hashPassword, normalizeEmail } from './utils/local-credentials.util';
import { hashOpaqueToken } from './utils/opaque-token.util';
import type { AcceptInviteDto } from './dto/accept-invite.dto';

@Injectable()
export class InviteAuthService {
  constructor(
    @InjectRepository(UsuarioInviteToken)
    private readonly inviteRepo: Repository<UsuarioInviteToken>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(UsuarioCredencialPassword)
    private readonly credencialRepo: Repository<UsuarioCredencialPassword>,
    private readonly authSessionService: AuthSessionService,
  ) {}

  async acceptInvite(dto: AcceptInviteDto) {
    const token = dto.token.trim();
    const password = dto.password;

    if (!token || password.length < 6) {
      throw new BadRequestException('Token y contraseña (mín. 6 caracteres) son obligatorios.');
    }

    const invite = await this.inviteRepo.findOne({
      where: { tokenHash: hashOpaqueToken(token), usedAt: IsNull() },
    });

    if (!invite || invite.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invitación inválida o expirada.');
    }

    const usuario = await this.usuarioRepo.findOne({
      where: { id: invite.usuarioId, tenantId: invite.tenantId, deletedAt: IsNull() },
    });

    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException('Invitación inválida o expirada.');
    }

    const existingCred = await this.credencialRepo.findOne({
      where: { usuarioId: usuario.id },
    });
    if (existingCred) {
      throw new BadRequestException('Esta invitación ya fue completada.');
    }

    const email = normalizeEmail(usuario.email);
    const passwordHash = await hashPassword(password);

    await this.credencialRepo.save(
      this.credencialRepo.create({
        usuarioId: usuario.id,
        email,
        passwordHash,
        intentosFallidos: 0,
        bloqueadoHasta: null,
        mustChangePassword: false,
      }),
    );

    invite.usedAt = new Date();
    await this.inviteRepo.save(invite);

    return this.authSessionService.issueSession(usuario);
  }
}
