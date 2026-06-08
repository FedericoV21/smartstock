import { Injectable } from '@nestjs/common';

import { createMpQrClient } from './mp-qr-api.client';
import type { MpQrClient } from './types/mp-qr.types';

@Injectable()
export class MpQrClientFactory {
  create(accessToken: string, userId: string): MpQrClient {
    return createMpQrClient(accessToken, userId);
  }
}
