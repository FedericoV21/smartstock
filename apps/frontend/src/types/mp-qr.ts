/** Payload que se envía a MP para activar el QR con un monto */
export interface MpQrCreateOrderPayload {
  external_reference: string;
  title: string;
  description?: string;
  notification_url?: string;
  total_amount: number;
  items: Array<{
    sku_number?: string;
    category?: string;
    title: string;
    description?: string;
    unit_price: number;
    quantity: number;
    unit_measure: 'unit';
    total_amount: number;
  }>;
}

/** Respuesta de MP al crear/consultar la orden. MP puede responder 201/204 sin body. */
export interface MpQrCreateOrderResponse {
  id?: string;
  in_store_order_id?: string;
  qr?: string;
}

export interface MpQrMerchantOrderPayment {
  id: number;
  status: 'approved' | 'pending' | 'rejected' | 'cancelled' | 'refunded';
  status_detail: string;
  transaction_amount: number;
  payment_method_id: string;
  payment_type_id: string;
  date_approved?: string;
}

/** Estructura de merchant_order consultada vía API */
export interface MpQrMerchantOrder {
  id: number;
  status: 'opened' | 'closed' | 'expired';
  external_reference: string;
  preference_id?: string;
  payments: MpQrMerchantOrderPayment[];
  shipments: unknown[];
  total_amount: number;
  paid_amount: number;
  refunded_amount: number;
}

export interface MpQrVerificacionCheck {
  ok: boolean;
  mensaje: string;
  sugerencia?: string;
  user_detectado?: string;
  endpoint_usado?: string;
  external_store_id?: string | null;
  caja_info?: {
    id: number;
    name: string;
    external_id: string | null;
    store_id?: string | null;
    external_store_id?: string | null;
    fixed_amount: boolean;
  };
}

export interface MpQrVerificacionResult {
  ok: boolean;
  checks: {
    token_valido: MpQrVerificacionCheck;
    user_id_coincide: MpQrVerificacionCheck;
    caja_existe: MpQrVerificacionCheck;
    cobro_de_prueba: MpQrVerificacionCheck;
  };
}

/** Payload del webhook de MP (topic merchant_order / payment) */
export interface MpQrWebhookPayload {
  resource?: string;
  topic?: 'merchant_order' | 'payment' | string;
  id?: number | string;
  [key: string]: unknown;
}
