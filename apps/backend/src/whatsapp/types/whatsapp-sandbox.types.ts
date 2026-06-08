export type WhatsappSandboxRole = 'admin' | 'operador' | 'readonly';

export type WhatsappSandboxMessageDto = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type SandboxInvoiceTicketStatus = 'needs_review' | 'ready' | 'closed' | 'applied' | 'error';

export type SandboxInvoicePendingItem = {
  indice: number;
  descripcion: string;
  codigo: string | null;
  cantidad: number | null;
  precio_unitario: number | null;
  subtotal: number | null;
  producto_id: string | null;
  producto_nombre: string | null;
  confidence: number | null;
  motivo: 'sin_producto' | 'requires_review';
};

export type SandboxInvoiceTicketSummary = {
  proveedor_nombre: string | null;
  proveedor_cuit: string | null;
  tipo_comprobante: string | null;
  letra: string | null;
  punto_venta: number | null;
  numero: number | null;
  fecha: string | null;
  subtotal: number | null;
  iva_21: number | null;
  iva_10_5: number | null;
  iva_27: number | null;
  percepcion_iibb: number | null;
  percepcion_iva: number | null;
  impuesto_interno: number | null;
  otros_impuestos: number | null;
  total: number | null;
  items_count: number;
  productos_vinculados: number;
  productos_pendientes: number;
  productos_nuevos: number;
  productos_para_revisar: number;
  afecta_stock: boolean;
  afecta_cuenta_corriente: boolean;
  actualizar_costos: boolean;
  cambios_costos: unknown[];
  advertencias: string[];
  conflictos: string[];
  bloqueantes: string[];
  impact_hash: string | null;
  can_apply: boolean;
};

export type SandboxInvoiceTicketDto = {
  id: string;
  tenant_id: string;
  usuario_id: string;
  actor_id: string;
  from_wa_id: string;
  lector_factura_job_id: string;
  action_log_id: string | null;
  status: SandboxInvoiceTicketStatus;
  summary: SandboxInvoiceTicketSummary;
  pending_items: SandboxInvoicePendingItem[];
  chat_state: Record<string, unknown>;
  impact_hash: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  applied_at: string | null;
};

export type WhatsappTextHandlerReply = {
  body: string;
  messageType: 'text';
  documentLink: string | null;
  documentFilename: string | null;
  documentCaption: string | null;
};
