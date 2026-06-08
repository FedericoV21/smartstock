import { Injectable } from '@nestjs/common';

import { Usuario } from '../users/entities/usuario.entity';
import { AuthTokenService } from './auth-token.service';
import { RefreshTokenService } from './refresh-token.service';

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly authTokenService: AuthTokenService,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  async issueSession(
    usuario: Usuario,
    extra?: { pin_temporal?: boolean; username_local?: string },
  ) {
    const access = this.authTokenService.issueForUsuario(usuario, extra);
    const refresh_token = await this.refreshTokenService.issue(usuario.id);
    return { ...access, refresh_token };
  }
}
