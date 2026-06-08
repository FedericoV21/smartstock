export type PasarelaCanal = 'qr' | 'terminal';

export type PasarelaEstado = 'activa' | 'inactiva' | 'incompleta';

export type PasarelaTransaccionEstado =
  | 'creada'
  | 'iniciada'
  | 'pendiente'
  | 'aprobada'
  | 'rechazada'
  | 'cancelada'
  | 'expirada'
  | 'error'
  | 'fiscalizando'
  | 'fiscal_pendiente'
  | 'fiscal_error'
  | 'completa';

export type JsonRecord = Record<string, unknown>;

export type PasarelaIntegracionRow = {
  id: string;
  tenant_id: string;
  sucursal_id: string;
  proveedor: string;
  canal: PasarelaCanal;
  tipo: string;
  nombre: string;
  estado: PasarelaEstado;
  config_publica: JsonRecord;
  secretos_cifrados: JsonRecord;
  webhook_public_id: string;
  origen_legacy?: string | null;
  legacy_config_id?: string | null;
};

export type PasarelaComprobantePago = {
  id: string;
  tenant_id: string;
  sucursal_id: string;
  estado: string;
  total: number | string;
  numero_orden?: number | null;
  mp_point_intent_id?: string | null;
  mp_qr_order_id?: string | null;
  caja_id?: string | null;
};

export type PasarelaCreatePaymentResult =
  | {
      ok: true;
      estadoComprobante: string;
      updateComprobante: Record<string, unknown>;
      transaccion: {
        estado: PasarelaTransaccionEstado;
        external_intent_id?: string | null;
        external_order_id?: string | null;
        external_reference?: string | null;
        request_payload?: JsonRecord | null;
        response_payload?: JsonRecord | null;
      };
      response: JsonRecord;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code?: string | null;
      request_payload?: JsonRecord | null;
      response_payload?: JsonRecord | null;
    };

export type PasarelaVerificacionCheck = {
  ok: boolean;
  mensaje: string;
  sugerencia?: string;
  user_detectado?: unknown;
  endpoint_usado?: unknown;
  caja_info?: unknown;
  device_id?: unknown;
  pos_id?: unknown;
  external_pos_id?: unknown;
  external_store_id?: unknown;
};

export type PasarelaVerificacionResult = {
  ok: boolean;
  mensaje?: string;
  checks?: Record<string, PasarelaVerificacionCheck>;
  detalles?: JsonRecord;
};

export type PasarelaAdapter = {
  proveedor: string;
  tipo: string;
  canal: PasarelaCanal;
  validateConfig(integracion: PasarelaIntegracionRow): { ok: true } | { ok: false; error: string };
  createPayment(params: {
    db: any;
    tenantId: string;
    integracion: PasarelaIntegracionRow;
    comprobante: PasarelaComprobantePago;
    monto: number;
  }): Promise<PasarelaCreatePaymentResult>;
  cancelPayment?(params: {
    db: any;
    tenantId: string;
    integracion: PasarelaIntegracionRow;
    comprobante: PasarelaComprobantePago;
  }): Promise<{ ok: true } | { ok: false; status: number; error: string }>;
  syncPayment?(params: {
    db: any;
    tenantId: string;
    integracion: PasarelaIntegracionRow;
    comprobante: PasarelaComprobantePago;
  }): Promise<{ ok: true; response?: JsonRecord } | { ok: false; status: number; error: string }>;
  parseWebhook?(params: { url: URL; rawBody: string; bodyJson: unknown }): JsonRecord | null;
  verifyWebhook?(params: {
    integracion: PasarelaIntegracionRow;
    rawBody: string;
    bodyJson: unknown;
    headers: Headers;
    url: URL;
  }): Promise<boolean> | boolean;
  verifyConfig?(params: {
    db: any;
    tenantId: string;
    integracion: PasarelaIntegracionRow;
  }): Promise<PasarelaVerificacionResult>;
  listDevices?(params: {
    db: any;
    tenantId: string;
    integracion: PasarelaIntegracionRow;
  }): Promise<{ ok: true; devices: JsonRecord[] } | { ok: false; status: number; error: string }>;
};
