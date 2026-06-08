import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { Usuario } from '../users/entities/usuario.entity';
import { AuthRefreshToken } from './entities/auth-refresh-token.entity';
import { AuthTokenService } from './auth-token.service';
import { generateOpaqueToken, hashOpaqueToken } from './utils/opaque-token.util';

const REFRESH_TOKEN_TTL_DAYS = 30;

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(AuthRefreshToken)
    private readonly refreshRepo: Repository<AuthRefreshToken>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    private readonly authTokenService: AuthTokenService,
  ) {}

  async issue(usuarioId: string): Promise<string> {
    const raw = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.refreshRepo.save(
      this.refreshRepo.create({
        usuarioId,
        tokenHash: hashOpaqueToken(raw),
        expiresAt,
        revokedAt: null,
      }),
    );

    return raw;
  }

  async refresh(rawToken: string) {
    const row = await this.refreshRepo.findOne({
      where: { tokenHash: hashOpaqueToken(rawToken), revokedAt: IsNull() },
    });

    if (!row || row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token inválido o expirado.');
    }

    const usuario = await this.usuarioRepo.findOne({
      where: { id: row.usuarioId, deletedAt: IsNull(), activo: true },
    });

    if (!usuario) {
      throw new UnauthorizedException('Refresh token inválido o expirado.');
    }

    row.revokedAt = new Date();
    await this.refreshRepo.save(row);

    const access = this.authTokenService.issueForUsuario(usuario);
    const refresh_token = await this.issue(usuario.id);
    return { ...access, refresh_token };
  }
}
