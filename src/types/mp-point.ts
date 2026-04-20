/**
 * Tipos de la API Mercado Pago Point (integration-api) y webhooks.
 * No provienen del esquema Supabase; mantener alineado con la documentación oficial de MP.
 */

export interface MpPointDevice {
  id: string;
  operating_mode: 'PDV' | 'STANDALONE';
  pos_id: number;
  /** MP puede devolver string o número según endpoint; normalizar en el cliente. */
  store_id: string;
  external_pos_id: string;
  name?: string;
}

/** Estado del pago devuelto dentro del payment intent (API MP). */
export type MpPointPaymentState = 'approved' | 'rejected' | 'cancelled' | 'error';

export interface MpPointPaymentIntent {
  id: string;
  state: 'OPEN' | 'ON_TERMINAL' | 'PROCESSING' | 'FINISHED' | 'CANCELED' | 'ERROR';
  amount: number;
  payment?: {
    id: number;
    state: MpPointPaymentState;
    type: string;
  };
  additional_info: {
    external_reference: string;
    print_on_terminal: boolean;
  };
}

export interface MpPointWebhookPayload {
  type: 'point_integration_wh';
  action: string;
  data: {
    id: string;
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
