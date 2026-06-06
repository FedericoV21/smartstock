/** Tipos API Mercado Pago Point (integration-api). Paridad `apps/frontend/src/types/mp-point.ts`. */

export interface MpPointDevice {
  id: string;
  operating_mode: 'PDV' | 'STANDALONE';
  pos_id: number;
  store_id: string;
  external_pos_id: string;
  name?: string;
}

export type MpPointPaymentState = 'approved' | 'rejected' | 'cancelled' | 'error';

export interface MpPointPaymentIntent {
  id: string;
  state: 'OPEN' | 'ON_TERMINAL' | 'PROCESSING' | 'FINISHED' | 'CANCELED' | 'ERROR';
  amount: number;
  payment?: {
    id: number;
    state?: MpPointPaymentState;
    type: string;
  };
  additional_info: {
    external_reference: string;
    print_on_terminal: boolean;
  };
}

export interface CreateIntentPayload {
  amount: number;
  additional_info: {
    external_reference: string;
    print_on_terminal: boolean;
    tip_amount?: number;
  };
}

export interface MpPointClient {
  listDevices(): Promise<MpPointDevice[]>;
  setDeviceMode(deviceId: string, mode: 'PDV' | 'STANDALONE'): Promise<void>;
  createPaymentIntent(deviceId: string, payload: CreateIntentPayload): Promise<MpPointPaymentIntent>;
  getPaymentIntent(deviceId: string, intentId: string): Promise<MpPointPaymentIntent>;
  cancelPaymentIntent(deviceId: string, intentId: string): Promise<void>;
}
