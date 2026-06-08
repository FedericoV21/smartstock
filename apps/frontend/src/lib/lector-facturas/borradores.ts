import type { LectorFacturaPreviewPayload } from '@/lib/lector-facturas/procesar-factura-ia';

export type LectorFacturaBorradorTipoOperacion = 'compra' | 'venta';
export type LectorFacturaBorradorPagoModo =
  | 'ya_pagada'
  | 'pendiente_condicion'
  | 'pendiente_fecha_custom';

export type LectorFacturaBorradorItem = Omit<
  LectorFacturaPreviewPayload['items'][number],
  'match'
> & {
  unidad_original?: string | null;
  presentacion_modo?: 'auto' | 'unidad_base' | 'presentacion_compra';
  bonificacion_cantidad?: number | null;
  match: Omit<LectorFacturaPreviewPayload['items'][number]['match'], 'requires_review'> & {
    requires_review?: boolean;
  };
};

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

async function jsonOrError<T>(res: Response): Promise<T> {
  const raw = await res.text();
  let json: T & { error?: string };
  try {
    json = raw ? (JSON.parse(raw) as T & { error?: string }) : ({} as T & { error?: string });
  } catch {
    throw new Error(`Respuesta invalida del servidor (${res.status})`);
  }
  if (!res.ok) throw new Error(json.error ?? `Error HTTP ${res.status}`);
  return json as T;
}

export async function listarLectorFacturaBorradores(): Promise<LectorFacturaBorradorListItem[]> {
  const res = await fetch('/api/lector-facturas/borradores', { cache: 'no-store' });
  const json = await jsonOrError<{ borradores?: LectorFacturaBorradorListItem[] }>(res);
  return json.borradores ?? [];
}

export async function leerLectorFacturaBorrador(
  id: string,
): Promise<LectorFacturaBorradorDetalle> {
  const res = await fetch(`/api/lector-facturas/borradores/${id}`, { cache: 'no-store' });
  const json = await jsonOrError<{ borrador: LectorFacturaBorradorDetalle }>(res);
  return json.borrador;
}

export async function guardarLectorFacturaBorrador(
  id: string,
  payload: LectorFacturaBorradorPayloadV1,
): Promise<LectorFacturaBorradorListItem> {
  const res = await fetch(`/api/lector-facturas/borradores/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload }),
  });
  const json = await jsonOrError<{ borrador: LectorFacturaBorradorListItem }>(res);
  return json.borrador;
}

export async function descartarLectorFacturaBorrador(id: string): Promise<void> {
  const res = await fetch(`/api/lector-facturas/borradores/${id}`, { method: 'DELETE' });
  await jsonOrError<Record<string, never>>(res);
}
