import { BadRequestException, Injectable } from '@nestjs/common';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { calcular4Estrategias } from './utils/motor';
import { parseCalcularInput } from './utils/despiece-api.util';
import { DespieceBaseService } from './despiece-base.service';

@Injectable()
export class DespieceCalculoService {
  constructor(private readonly base: DespieceBaseService) {}

  async calcular(body: unknown, user: AccessTokenPayload) {
    await this.base.assertModuloDespiece();
    await this.base.assertPermisoVer(user);

    try {
      const input = parseCalcularInput(body);
      return { resultado: calcular4Estrategias(input) };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'No se pudo calcular.',
      );
    }
  }
}
