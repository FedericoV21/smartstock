import {
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { UsuarioCredencialPassword } from '../rbac/entities/usuario-credencial-password.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { AuthSessionService } from './auth-session.service';
import { normalizeEmail, verifyPassword } from './utils/local-credentials.util';
import type { EmailLoginDto } from './dto/email-login.dto';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class EmailAuthService {
  constructor(
    @InjectRepository(UsuarioCredencialPassword)
    private readonly credencialRepo: Repository<UsuarioCredencialPassword>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    private readonly authSessionService: AuthSessionService,
  ) {}

  async login(dto: EmailLoginDto) {
    const email = normalizeEmail(dto.email);
    const password = dto.password;

    const cred = await this.credencialRepo
      .createQueryBuilder('c')
      .where('LOWER(c.email) = :email', { email })
      .getOne();

    if (!cred) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const usuario = await this.usuarioRepo.findOne({
      where: { id: cred.usuarioId, deletedAt: IsNull() },
    });

    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    if (cred.bloqueadoHasta && cred.bloqueadoHasta.getTime() > Date.now()) {
      throw new HttpException('Usuario temporalmente bloqueado.', 423);
    }

    const ok = await verifyPassword(password, cred.passwordHash);
    if (!ok) {
      await this.registerFailedAttempt(cred);
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    await this.credencialRepo.update(
      { usuarioId: cred.usuarioId },
      {
        intentosFallidos: 0,
        bloqueadoHasta: null,
        ultimoLoginAt: new Date(),
      },
    );

    return this.authSessionService.issueSession(usuario);
  }

  private async registerFailedAttempt(cred: UsuarioCredencialPassword) {
    const nextAttempts = (cred.intentosFallidos ?? 0) + 1;
    const shouldLock = nextAttempts >= MAX_FAILED_ATTEMPTS;

    await this.credencialRepo.update(
      { usuarioId: cred.usuarioId },
      {
        intentosFallidos: shouldLock ? 0 : nextAttempts,
        bloqueadoHasta: shouldLock
          ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
          : null,
      },
    );
  }
}
