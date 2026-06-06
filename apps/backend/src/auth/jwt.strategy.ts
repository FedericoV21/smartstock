import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { getJwtSigningSecret } from '../config/jwt-secret.util';
import type { AccessTokenPayload } from './interfaces/access-token-payload.interface';
import { normalizeAccessTokenPayload } from './utils/normalize-access-token-payload';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSigningSecret(config),
    });
  }

  validate(payload: AccessTokenPayload): AccessTokenPayload {
    return normalizeAccessTokenPayload(payload as unknown as Record<string, unknown>);
  }
}
