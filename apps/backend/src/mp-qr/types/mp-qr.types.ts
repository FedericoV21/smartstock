export type MpQrCreateOrderPayload = {
  external_reference: string;
  title: string;
  description: string;
  notification_url?: string;
  total_amount: number;
  items: Array<{
    title: string;
    description: string;
    unit_price: number;
    quantity: number;
    unit_measure: string;
    total_amount: number;
  }>;
};

export type MpQrCreateOrderResponse = Record<string, unknown>;

export type MpQrMerchantOrderPayment = {
  id: number;
  status: 'approved' | 'pending' | 'rejected' | 'cancelled' | 'refunded';
  status_detail: string;
  transaction_amount: number;
  payment_method_id: string;
  payment_type_id: string;
  date_approved?: string;
};

export type MpQrMerchantOrder = {
  id: number;
  status: 'opened' | 'closed' | 'expired';
  external_reference: string;
  preference_id?: string;
  payments: MpQrMerchantOrderPayment[];
  shipments: unknown[];
  total_amount: number;
  paid_amount: number;
  refunded_amount: number;
};

export type MpQrClient = {
  createOrder(
    externalPosId: string,
    payload: MpQrCreateOrderPayload,
    options?: { externalStoreId?: string | null },
  ): Promise<MpQrCreateOrderResponse>;
  getOrder(
    externalPosId: string,
    options?: { externalStoreId?: string | null },
  ): Promise<MpQrCreateOrderResponse>;
  cancelOrder(
    externalPosId: string,
    options?: { externalStoreId?: string | null; orderId?: string | null },
  ): Promise<void>;
  getMerchantOrder(merchantOrderId: number | string): Promise<MpQrMerchantOrder>;
};
