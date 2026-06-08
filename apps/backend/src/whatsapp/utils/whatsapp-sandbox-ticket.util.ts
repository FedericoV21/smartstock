import { createHash } from 'node:crypto';

import type { LectorFacturaImpacto } from '../../lector-facturas/lector-confirmacion-chatbot.service';
import type {
  SandboxInvoicePendingItem,
  SandboxInvoiceTicketDto,
  SandboxInvoiceTicketStatus,
  SandboxInvoiceTicketSummary,
} from '../types/whatsapp-sandbox.types';
import type { WhatsappSandboxInvoiceTicket } from '../entities/whatsapp-sandbox-invoice-ticket.entity';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function defaultTicketSummary(): SandboxInvoiceTicketSummary {
  return {
    proveedor_nombre: null,
    proveedor_cuit: null,
    tipo_comprobante: null,
    letra: null,
    punto_venta: null,
    numero: null,
    fecha: null,
    subtotal: null,
    iva_21: null,
    iva_10_5: null,
    iva_27: null,
    percepcion_iibb: null,
    percepcion_iva: null,
    impuesto_interno: null,
    otros_impuestos: null,
    total: null,
    items_count: 0,
    productos_vinculados: 0,
    productos_pendientes: 0,
    productos_nuevos: 0,
    productos_para_revisar: 0,
    afecta_stock: false,
    afecta_cuenta_corriente: false,
    actualizar_costos: false,
    cambios_costos: [],
    advertencias: [],
    conflictos: [],
    bloqueantes: [],
    impact_hash: null,
    can_apply: false,
  };
}

export function normalizeTicketSummary(value: unknown): SandboxInvoiceTicketSummary {
  const row = asRecord(value);
  const fallback = defaultTicketSummary();
  return {
    proveedor_nombre: stringOrNull(row.proveedor_nombre),
    proveedor_cuit: stringOrNull(row.proveedor_cuit),
    tipo_comprobante: stringOrNull(row.tipo_comprobante),
    letra: stringOrNull(row.letra),
    punto_venta: numberOrNull(row.punto_venta),
    numero: numberOrNull(row.numero),
    fecha: stringOrNull(row.fecha),
    subtotal: numberOrNull(row.subtotal),
    iva_21: numberOrNull(row.iva_21),
    iva_10_5: numberOrNull(row.iva_10_5),
    iva_27: numberOrNull(row.iva_27),
    percepcion_iibb: numberOrNull(row.percepcion_iibb),
    percepcion_iva: numberOrNull(row.percepcion_iva),
    impuesto_interno: numberOrNull(row.impuesto_interno),
    otros_impuestos: numberOrNull(row.otros_impuestos),
    total: numberOrNull(row.total),
    items_count: numberOrNull(row.items_count) ?? fallback.items_count,
    productos_vinculados: numberOrNull(row.productos_vinculados) ?? fallback.productos_vinculados,
    productos_pendientes: numberOrNull(row.productos_pendientes) ?? fallback.productos_pendientes,
    productos_nuevos: numberOrNull(row.productos_nuevos) ?? fallback.productos_nuevos,
    productos_para_revisar: numberOrNull(row.productos_para_revisar) ?? fallback.productos_para_revisar,
    afecta_stock: booleanValue(row.afecta_stock),
    afecta_cuenta_corriente: booleanValue(row.afecta_cuenta_corriente),
    actualizar_costos: booleanValue(row.actualizar_costos),
    cambios_costos: Array.isArray(row.cambios_costos) ? row.cambios_costos : [],
    advertencias: asArray(row.advertencias).map(String),
    conflictos: asArray(row.conflictos).map(String),
    bloqueantes: asArray(row.bloqueantes).map(String),
    impact_hash: stringOrNull(row.impact_hash),
    can_apply: booleanValue(row.can_apply),
  };
}

export function normalizePendingItem(value: unknown, fallbackIndex: number): SandboxInvoicePendingItem {
  const row = asRecord(value);
  const motivo = row.motivo === 'requires_review' ? 'requires_review' : 'sin_producto';
  return {
    indice: numberOrNull(row.indice) ?? fallbackIndex,
    descripcion: stringOrNull(row.descripcion) ?? 'Item factura',
    codigo: stringOrNull(row.codigo),
    cantidad: numberOrNull(row.cantidad),
    precio_unitario: numberOrNull(row.precio_unitario),
    subtotal: numberOrNull(row.subtotal),
    producto_id: stringOrNull(row.producto_id),
    producto_nombre: stringOrNull(row.producto_nombre),
    confidence: numberOrNull(row.confidence),
    motivo,
  };
}

function normalizeTicketStatus(value: unknown): SandboxInvoiceTicketStatus {
  const status = String(value ?? 'needs_review');
  if (
    status === 'needs_review' ||
    status === 'ready' ||
    status === 'closed' ||
    status === 'applied' ||
    status === 'error'
  ) {
    return status;
  }
  return 'needs_review';
}

export function ticketEntityToDto(row: WhatsappSandboxInvoiceTicket): SandboxInvoiceTicketDto {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    usuario_id: row.usuarioId,
    actor_id: row.actorId,
    from_wa_id: row.fromWaId,
    lector_factura_job_id: row.lectorFacturaJobId,
    action_log_id: row.actionLogId,
    status: normalizeTicketStatus(row.status),
    summary: normalizeTicketSummary(row.summary),
    pending_items: asArray(row.pendingItems).map(normalizePendingItem),
    chat_state: asRecord(row.chatState),
    impact_hash: row.impactHash,
    error_detail: row.errorDetail,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    closed_at: row.closedAt?.toISOString() ?? null,
    applied_at: row.appliedAt?.toISOString() ?? null,
  };
}

function extractInvoicePreview(resultado: unknown): Record<string, unknown> | null {
  const preview = asRecord(resultado);
  if (!preview.log_id || !Array.isArray(preview.items)) return null;
  return preview;
}

function previewHeader(preview: Record<string, unknown> | null): Record<string, unknown> {
  return asRecord(preview?.cabecera);
}

function previewTotals(preview: Record<string, unknown> | null): Record<string, unknown> {
  return asRecord(preview?.totales);
}

function previewProviderName(preview: Record<string, unknown> | null, impacto: LectorFacturaImpacto): string | null {
  const r = impacto.resumen;
  if (typeof r.proveedor_nombre === 'string' && r.proveedor_nombre) return r.proveedor_nombre;
  const proveedor = asRecord(preview?.proveedor);
  const crearProveedor = asRecord(preview?.crear_proveedor);
  const emisor = asRecord(preview?.emisor);
  return (
    stringOrNull(proveedor.nombre) ??
    stringOrNull(crearProveedor.razon_social) ??
    stringOrNull(emisor.razon_social)
  );
}

function previewProviderCuit(preview: Record<string, unknown> | null): string | null {
  const crearProveedor = asRecord(preview?.crear_proveedor);
  const emisor = asRecord(preview?.emisor);
  return stringOrNull(crearProveedor.cuit) ?? stringOrNull(emisor.cuit);
}

export function pendingItemsFromPreview(preview: Record<string, unknown> | null): SandboxInvoicePendingItem[] {
  const items = asArray(preview?.items);
  return items
    .map((rawItem, position) => {
      const item = asRecord(rawItem);
      const match = asRecord(item.match);
      const productoId = stringOrNull(match.producto_id);
      const requiresReview = match.requires_review === true;
      if (productoId && !requiresReview) return null;
      return {
        indice: numberOrNull(item.indice) ?? position,
        descripcion: stringOrNull(item.descripcion) ?? 'Item factura',
        codigo: stringOrNull(item.codigo),
        cantidad: numberOrNull(item.cantidad),
        precio_unitario: numberOrNull(item.precio_unitario),
        subtotal: numberOrNull(item.subtotal),
        producto_id: productoId,
        producto_nombre: stringOrNull(match.producto_nombre),
        confidence: numberOrNull(match.confidence),
        motivo: productoId ? 'requires_review' : 'sin_producto',
      } satisfies SandboxInvoicePendingItem;
    })
    .filter((item): item is SandboxInvoicePendingItem => item != null);
}

function ticketBlockingReasons(params: {
  pendingItems: SandboxInvoicePendingItem[];
  bloqueantes: string[];
}): string[] {
  const reasons = [...params.bloqueantes];
  if (params.pendingItems.length > 0) {
    reasons.push(`${params.pendingItems.length} producto(s) pendientes de enlazar o revisar.`);
  }
  return reasons;
}

function ticketStatusForSnapshot(params: {
  pendingItems: SandboxInvoicePendingItem[];
  bloqueantes: string[];
}): SandboxInvoiceTicketStatus {
  return ticketBlockingReasons(params).length === 0 ? 'ready' : 'needs_review';
}

export function buildInvoiceActionSignature(params: {
  tenantId: string;
  lectorJobId: string;
  impactHash: string;
}): string {
  return createHash('sha256')
    .update(`lector_factura_confirmar_importado|${params.tenantId}|${params.lectorJobId}|${params.impactHash}`)
    .digest('hex');
}

export function buildSandboxInvoiceTicketSnapshot(params: {
  resultado: unknown;
  prepared: {
    impacto: LectorFacturaImpacto;
    impactHash: string;
  };
}): {
  summary: SandboxInvoiceTicketSummary;
  pendingItems: SandboxInvoicePendingItem[];
  status: SandboxInvoiceTicketStatus;
  blockingReasons: string[];
} {
  const preview = extractInvoicePreview(params.resultado);
  const header = previewHeader(preview);
  const totals = previewTotals(preview);
  const pendingItems = pendingItemsFromPreview(preview);
  const status = ticketStatusForSnapshot({
    pendingItems,
    bloqueantes: params.prepared.impacto.bloqueantes,
  });
  const blockingReasons = ticketBlockingReasons({
    pendingItems,
    bloqueantes: params.prepared.impacto.bloqueantes,
  });
  const r = params.prepared.impacto.resumen;
  const items = asArray(preview?.items);
  let vinculados = 0;
  let nuevos = 0;
  let paraRevisar = 0;
  for (const raw of items) {
    const item = asRecord(raw);
    const match = asRecord(item.match);
    const productoId = stringOrNull(match.producto_id);
    if (!productoId) nuevos += 1;
    else if (match.requires_review === true) paraRevisar += 1;
    else vinculados += 1;
  }

  const summary: SandboxInvoiceTicketSummary = {
    proveedor_nombre: previewProviderName(preview, params.prepared.impacto),
    proveedor_cuit: previewProviderCuit(preview),
    tipo_comprobante: stringOrNull(header.tipo_comprobante),
    letra: stringOrNull(header.letra),
    punto_venta: numberOrNull(header.punto_venta),
    numero: numberOrNull(header.numero),
    fecha: stringOrNull(header.fecha_emision),
    subtotal: numberOrNull(totals.subtotal),
    iva_21: numberOrNull(totals.iva_21),
    iva_10_5: numberOrNull(totals.iva_10_5),
    iva_27: numberOrNull(totals.iva_27),
    percepcion_iibb: numberOrNull(totals.percepcion_iibb),
    percepcion_iva: numberOrNull(totals.percepcion_iva),
    impuesto_interno: numberOrNull(totals.impuesto_interno),
    otros_impuestos: numberOrNull(totals.otros_impuestos),
    total: numberOrNull(totals.total) ?? numberOrNull(r.total),
    items_count: numberOrNull(r.total_items) ?? items.length,
    productos_vinculados: vinculados,
    productos_pendientes: pendingItems.length,
    productos_nuevos: nuevos,
    productos_para_revisar: paraRevisar,
    afecta_stock: booleanValue(r.afecta_stock),
    afecta_cuenta_corriente: booleanValue(r.afecta_cuenta_corriente),
    actualizar_costos: booleanValue(r.actualizar_costos),
    cambios_costos: params.prepared.impacto.cambios_costos,
    advertencias: params.prepared.impacto.advertencias,
    conflictos: params.prepared.impacto.conflictos,
    bloqueantes: blockingReasons,
    impact_hash: params.prepared.impactHash,
    can_apply: status === 'ready',
  };
  return { summary, pendingItems, status, blockingReasons };
}

function formatAmount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '$0,00';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
}

function ticketStatusLabel(status: SandboxInvoiceTicketStatus): string {
  if (status === 'ready') return 'listo para cargar';
  if (status === 'needs_review') return 'requiere revision';
  if (status === 'applied') return 'cargado';
  if (status === 'closed') return 'cerrado';
  return 'con error';
}

export function buildInvoiceTicketChatSummary(
  ticket: SandboxInvoiceTicketDto,
  token?: string | null,
  borradorUrl?: string | null,
): string {
  const s = ticket.summary;
  const lines = [
    'Factura procesada con IA.',
    `Ticket abierto: ${ticketStatusLabel(ticket.status)}.`,
    s.proveedor_nombre ? `Proveedor: ${s.proveedor_nombre}` : null,
    s.tipo_comprobante || s.numero
      ? `Comprobante: ${[s.tipo_comprobante, s.letra].filter(Boolean).join(' ')} ${[s.punto_venta, s.numero]
          .filter((v) => v != null)
          .join('-')}`.trim()
      : null,
    s.fecha ? `Fecha: ${s.fecha}` : null,
    `Total: ${formatAmount(s.total)}`,
    `Items: ${s.items_count}. Vinculados: ${s.productos_vinculados}. Pendientes: ${s.productos_pendientes}.`,
    s.cambios_costos.length > 0 ? `Cambios de costo: ${s.cambios_costos.length}.` : null,
    s.advertencias.length > 0 ? `Advertencias: ${s.advertencias.slice(0, 3).join(' ')}` : null,
    s.conflictos.length > 0 ? `A revisar: ${s.conflictos.slice(0, 3).join(' ')}` : null,
    s.bloqueantes.length > 0 ? `Bloqueantes: ${s.bloqueantes.join(' ')}` : null,
    ticket.pending_items.length > 0
      ? `Productos pendientes: ${ticket.pending_items
          .slice(0, 5)
          .map((item) => item.descripcion)
          .join(' | ')}${ticket.pending_items.length > 5 ? ' | ...' : ''}`
      : null,
    ticket.status === 'ready'
      ? token
        ? `Para cargarla e impactar datos reales, responde "cargar" o "OK ${token}".`
        : 'Para cargarla e impactar datos reales, responde "cargar".'
      : null,
    ticket.status === 'needs_review' && !borradorUrl
      ? 'No la voy a cargar todavia: primero hay que enlazar los productos pendientes.'
      : null,
    ticket.status === 'needs_review' && borradorUrl ? `Para resolverlo en la app: ${borradorUrl}` : null,
    ticket.status === 'ready'
      ? 'Tambien podes responder "pendientes" para ver el detalle o "cerrar" para cancelar este ticket.'
      : null,
    ticket.status === 'needs_review'
      ? borradorUrl
        ? 'Tambien podes usar "pendientes", "buscar N producto" o "enlazar" desde este chat, o "cerrar" para cancelar.'
        : 'Tambien podes responder "pendientes" para ver el detalle o "cerrar" para cancelar este ticket.'
      : null,
    s.impact_hash ? `Hash impacto: ${s.impact_hash.slice(0, 12)}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

export function buildSandboxWaId(params: { tenantId: string; userId: string }): string {
  return `sandbox:${params.tenantId}:${params.userId}`;
}

export function sandboxRoleFromSession(params: {
  rol: string;
  isSuperAdmin: boolean;
}): import('../types/whatsapp-sandbox.types').WhatsappSandboxRole {
  if (params.isSuperAdmin || params.rol === 'admin') return 'admin';
  if (params.rol === 'visor') return 'readonly';
  return 'operador';
}

export function resumenAplicacionLectorFactura(params: {
  comprobanteId: string;
  actualizacionesCostos: unknown[];
}): string {
  const lines = ['Factura cargada correctamente.', `Comprobante: ${params.comprobanteId}.`];
  if (params.actualizacionesCostos.length > 0) {
    lines.push(`Se actualizaron ${params.actualizacionesCostos.length} costo(s) de producto.`);
  }
  return lines.join('\n');
}
