export type LectorFacturaBorradorTipoOperacion = 'compra' | 'venta';

export type LectorFacturaBorradorPagoModo =
  | 'ya_pagada'
  | 'pendiente_condicion'
  | 'pendiente_fecha_custom';

export type LectorFacturaPreviewPayload = {
  log_id: string;
  iva_default: number;
  direccion: 'recibida' | 'emitida' | 'desconocida';
  cabecera: {
    tipo_comprobante: string;
    letra: string | null;
    punto_venta: number | null;
    numero: number | null;
    fecha_emision: string | null;
    fecha_vencimiento: string | null;
    cae: string | null;
    cae_vencimiento: string | null;
  };
  emisor: {
    razon_social: string;
    cuit: string;
    domicilio: string;
    condicion_iva: string;
    ingresos_brutos: string;
    inicio_actividades: string;
  };
  receptor: {
    razon_social: string;
    cuit_dni: string;
    domicilio: string;
    condicion_iva: string;
  };
  proveedor: { id: string; nombre: string } | null;
  cliente: { id: string; nombre: string } | null;
  crear_proveedor: { razon_social: string; cuit: string } | null;
  crear_cliente: { razon_social: string; cuit_dni: string } | null;
  items: Array<Record<string, unknown>>;
  totales: {
    subtotal: number | null;
    iva_21: number | null;
    iva_10_5: number | null;
    iva_27: number | null;
    percepcion_iibb: number | null;
    percepcion_iva: number | null;
    impuesto_interno: number | null;
    otros_impuestos: number | null;
    total: number | null;
  };
  condicion_pago: string | null;
  observaciones: string | null;
  validacion: Record<string, unknown>;
  multipagina: Record<string, unknown>;
  archivo_nombre: string;
  extracciones_restantes: number | null;
};

export type LectorFacturaBorradorItem = LectorFacturaPreviewPayload['items'][number];

export type LectorFacturaBorradorExtraccion = Omit<LectorFacturaPreviewPayload, 'items'> & {
  items: LectorFacturaBorradorItem[];
};

export type LectorFacturaBorradorDraft = {
  cabecera: LectorFacturaPreviewPayload['cabecera'];
  emisor: LectorFacturaPreviewPayload['emisor'];
  receptor: LectorFacturaPreviewPayload['receptor'];
  items: LectorFacturaBorradorItem[];
  tipoOperacion: LectorFacturaBorradorTipoOperacion;
  proveedorElegidoId: string | null;
  clienteElegidoId: string | null;
  incluirCrearProveedor: boolean;
  incluirCrearCliente: boolean;
  actualizarCostos: boolean;
  afectaStock: boolean;
  inferirPresentacionCompra: boolean;
  preciosItemsConIvaIncluido: boolean;
  ivaMontoFactura?: string;
  percepcionIibb: string;
  percepcionIva: string;
  impuestoInterno?: string;
  afectaCuentaCorriente: boolean;
  pagoModo: LectorFacturaBorradorPagoModo;
  fechaPagoYa: string;
  tipoPagoYa: 'efectivo' | 'transferencia' | 'cheque';
  vencCustom: string;
};

export type LectorFacturaBorradorPayloadV1 = {
  version: 1;
  paso: 'preview';
  archivoNombre: string;
  previewPaso: 1 | 2;
  extraccion: LectorFacturaBorradorExtraccion;
  draft: LectorFacturaBorradorDraft;
};

export type LectorFacturaBorradorListItem = {
  id: string;
  archivo_nombre: string;
  archivo_mime: string | null;
  archivo_tamano: number | null;
  total_items: number;
  tipo_comprobante: string | null;
  tipo_operacion: LectorFacturaBorradorTipoOperacion;
  direccion: 'recibida' | 'emitida' | 'desconocida';
  proveedor_id: string | null;
  cliente_id: string | null;
  usuario_id: string | null;
  created_at: string;
  updated_at: string;
  guardado: boolean;
  proveedor?: { nombre: string } | null;
  cliente?: { nombre: string | null; razon_social?: string | null } | null;
  usuario?: { nombre: string | null; email: string | null } | null;
};

export type LectorFacturaBorradorDetalle = LectorFacturaBorradorListItem & {
  payload: LectorFacturaBorradorPayloadV1;
};
