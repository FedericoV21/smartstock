import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MpQrEventBroadcastService {
  private readonly logger = new Logger(MpQrEventBroadcastService.name);

  async broadcast(comprobanteId: string, payload: Record<string, unknown>): Promise<void> {
    this.logger.log(`mp_qr_event comprobante=${comprobanteId} ${JSON.stringify(payload)}`);
  }
}
