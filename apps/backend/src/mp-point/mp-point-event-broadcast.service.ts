import { Injectable, Logger } from '@nestjs/common';

export type MpPointBroadcastPayload = {
  estado: 'aprobado' | 'rechazado' | 'cancelado' | 'error';
  motivo?: string;
  codigo?: string | null;
  payment_id?: number;
  payment_type?: string;
};

/**
 * Stub de broadcast Realtime (paridad front `broadcastMpPointEvent`).
 * Loguea el evento; la UI puede reconsultar estado v├¡a GET /pagos/mp-point/estado.
 */
@Injectable()
export class MpPointEventBroadcastService {
  private readonly logger = new Logger(MpPointEventBroadcastService.name);

  async broadcast(comprobanteId: string, payload: MpPointBroadcastPayload): Promise<void> {
    this.logger.log(`mp_point_event comprobante=${comprobanteId} ${JSON.stringify(payload)}`);
  }
}
