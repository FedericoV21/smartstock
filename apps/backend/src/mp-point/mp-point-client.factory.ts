import { Injectable } from '@nestjs/common';

import { createMpPointClient, type GetMpPointClientOptions } from './mp-point-api.client';
import type { MpPointClient } from './types/mp-point.types';

@Injectable()
export class MpPointClientFactory {
  create(accessToken: string, options?: GetMpPointClientOptions): MpPointClient {
    return createMpPointClient(accessToken, options);
  }
}
