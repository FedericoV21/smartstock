import { createHash, randomInt, randomUUID } from 'node:crypto';

import {
  aplicarConfirmacionLectorFacturaJob,
  prepararConfirmacionLectorFacturaDesdeResultado,
  resumenAplicacionLectorFactura,
  type LectorFacturaImpacto,
  type PrepararConfirmacionLectorFacturaResult,
} from '@/lib/lector-facturas/confirmacion-chatbot';
import {
  resolverBorradorUrlWhatsapp,
  sincronizarBorradorWhatsappDesdeJob,
} from '@/lib/lector-facturas/borradores-whatsapp';
import type { WhatsAppTextHandlerReply } from '@/lib/whatsapp/text-handler';

export type WhatsAppSandboxRole = 'admin' | 'operador' | 'readonly';

export type WhatsAppSandboxMessage = {
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
  cambios_costos: LectorFacturaImpacto['cambios_costos'];
  advertencias: string[];
  conflictos: string[];
  bloqueantes: string[];
  impact_hash: string | null;
  can_apply: boolean;
};

export type SandboxInvoiceTicketProductSuggestion = {
  option: number;
  producto_id: string;
  nombre: string;
  codigo: string | null;
  precio_costo: number | null;
  unidad: string | null;
};

export type SandboxInvoiceTicketChatState = {
  last_product_search?: {
    item_indice: number;
    query: string;
    results: SandboxInvoiceTicketProductSuggestion[];
    created_at: string;
  };
};

export type SandboxInvoiceTicket = {
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
  chat_state: SandboxInvoiceTicketChatState;
  impact_hash: string | null;
  error_detail: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  applied_at: string | null;
};

type SessionRole = 'admin' | 'operador' | 'visor' | string;

const CONFIRMATION_WINDOW_MINUTES = 10;
const OPEN_TICKET_STATUSES: SandboxInvoiceTicketStatus[] = ['needs_review', 'ready', 'error'];
const SANDBOX_INVOICE_TICKET_SELECT =
  'id, tenant_id, usuario_id, actor_id, from_wa_id, lector_factura_job_id, action_log_id, status, summary, pending_items, chat_state, impact_hash, error_detail, created_at, updated_at, closed_at, applied_at';

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

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeSandboxMessage(row: any): WhatsAppSandboxMessage {
  const role = String(row?.role ?? 'assistant');
  return {
    id: String(row?.id ?? ''),
    role: role === 'user' || role === 'system' ? role : 'assistant',
    content: String(row?.content ?? ''),
    metadata: asRecord(row?.metadata),
    created_at: String(row?.created_at ?? new Date().toISOString()),
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

function normalizeTicketSummary(value: unknown): SandboxInvoiceTicketSummary {
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
    cambios_costos: Array.isArray(row.cambios_costos)
      ? (row.cambios_costos as SandboxInvoiceTicketSummary['cambios_costos'])
      : [],
    advertencias: asArray(row.advertencias).map(String),
    conflictos: asArray(row.conflictos).map(String),
    bloqueantes: asArray(row.bloqueantes).map(String),
    impact_hash: stringOrNull(row.impact_hash),
    can_apply: booleanValue(row.can_apply),
  };
}

function normalizePendingItem(value: unknown, fallbackIndex: number): SandboxInvoicePendingItem {
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

function normalizeProductSuggestion(value: unknown, fallbackOption: number): SandboxInvoiceTicketProductSuggestion {
  const row = asRecord(value);
  return {
    option: numberOrNull(row.option) ?? fallbackOption,
    producto_id: stringOrNull(row.producto_id) ?? '',
    nombre: stringOrNull(row.nombre) ?? 'Producto',
    codigo: stringOrNull(row.codigo),
    precio_costo: numberOrNull(row.precio_costo),
    unidad: stringOrNull(row.unidad),
  };
}

function normalizeTicketChatState(value: unknown): SandboxInvoiceTicketChatState {
  const row = asRecord(value);
  const last = asRecord(row.last_product_search);
  const itemIndice = numberOrNull(last.item_indice);
  const query = stringOrNull(last.query);
  const results = asArray(last.results)
    .map((candidate, index) => normalizeProductSuggestion(candidate, index + 1))
    .filter((candidate) => candidate.producto_id);
  if (itemIndice == null || !query || results.length === 0) return {};
  return {
    last_product_search: {
      item_indice: itemIndice,
      query,
      results,
      created_at: stringOrNull(last.created_at) ?? new Date().toISOString(),
    },
  };
}

function normalizeTicketRow(row: any): SandboxInvoiceTicket {
  return {
    id: String(row?.id ?? ''),
    tenant_id: String(row?.tenant_id ?? ''),
    usuario_id: String(row?.usuario_id ?? ''),
    actor_id: String(row?.actor_id ?? ''),
    from_wa_id: String(row?.from_wa_id ?? ''),
    lector_factura_job_id: String(row?.lector_factura_job_id ?? ''),
    action_log_id: stringOrNull(row?.action_log_id),
    status: normalizeTicketStatus(row?.status),
    summary: normalizeTicketSummary(row?.summary),
    pending_items: asArray(row?.pending_items).map(normalizePendingItem),
    chat_state: normalizeTicketChatState(row?.chat_state),
    impact_hash: stringOrNull(row?.impact_hash),
    error_detail: stringOrNull(row?.error_detail),
    created_at: String(row?.created_at ?? new Date().toISOString()),
    updated_at: String(row?.updated_at ?? row?.created_at ?? new Date().toISOString()),
    closed_at: stringOrNull(row?.closed_at),
    applied_at: stringOrNull(row?.applied_at),
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
  if (impacto.resumen.proveedor_nombre) return impacto.resumen.proveedor_nombre;
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

function pendingItemsFromPreview(preview: Record<string, unknown> | null): SandboxInvoicePendingItem[] {
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

function confirmationToken(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}

function buildInvoiceActionSignature(params: {
  tenantId: string;
  lectorJobId: string;
  impactHash: string;
}) {
  return createHash('sha256')
    .update(`lector_factura_confirmar_importado|${params.tenantId}|${params.lectorJobId}|${params.impactHash}`)
    .digest('hex');
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

export function buildWhatsAppInvoiceTicketChatSummary(
  ticket: SandboxInvoiceTicket,
  token?: string | null,
  borradorUrl?: string | null,
): string {
  const s = ticket.summary;
  const lines = [
    'Factura procesada con IA.',
    `Ticket abierto: ${ticketStatusLabel(ticket.status)}.`,
    s.proveedor_nombre ? `Proveedor: ${s.proveedor_nombre}` : null,
    s.tipo_comprobante || s.numero
      ? `Comprobante: ${[s.tipo_comprobante, s.letra].filter(Boolean).join(' ')} ${[
          s.punto_venta,
          s.numero,
        ].filter((v) => v != null).join('-')}`.trim()
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
    ticket.status === 'needs_review' && borradorUrl
      ? `Para resolverlo en la app: ${borradorUrl}`
      : null,
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

function textReply(body: string): WhatsAppTextHandlerReply {
  return {
    body,
    messageType: 'text',
    documentLink: null,
    documentFilename: null,
    documentCaption: null,
  };
}

function buildPendingItemsChat(ticket: SandboxInvoiceTicket): string {
  if (ticket.pending_items.length === 0) {
    return [
      'No quedan productos pendientes en este ticket.',
      ticket.status === 'ready' ? 'Podes responder "cargar" para impactar la factura.' : null,
    ].filter(Boolean).join('\n');
  }

  const lines = ticket.pending_items.map((item, index) => {
    const details = [
      item.codigo ? `cod. ${item.codigo}` : null,
      item.cantidad != null ? `cant. ${item.cantidad}` : null,
      item.precio_unitario != null ? formatAmount(item.precio_unitario) : null,
      item.motivo === 'requires_review' ? 'requiere revisar match' : 'sin producto enlazado',
    ].filter(Boolean).join(', ');
    return `${index + 1}. ${item.descripcion}${details ? ` (${details})` : ''}`;
  });

  return [
    'Productos pendientes de este ticket:',
    ...lines,
    '',
    'Para buscar: "buscar 1 texto del producto".',
    'Despues elegi: "enlazar 1 2" (item 1, opcion 2).',
    'Para cancelar: "cerrar".',
  ].join('\n');
}

function pendingItemFromChatRef(ticket: SandboxInvoiceTicket, refText: string): {
  item: SandboxInvoicePendingItem;
  displayNumber: number;
} | null {
  const ref = Number(refText);
  if (!Number.isInteger(ref) || ref <= 0) return null;
  const byDisplay = ticket.pending_items[ref - 1];
  if (byDisplay) return { item: byDisplay, displayNumber: ref };
  const byIndice = ticket.pending_items.find((item) => item.indice === ref);
  if (byIndice) {
    return {
      item: byIndice,
      displayNumber: ticket.pending_items.findIndex((item) => item.indice === byIndice.indice) + 1,
    };
  }
  return null;
}

function parseTicketChatCommand(
  text: string,
  ticket: SandboxInvoiceTicket,
):
  | { action: 'continue'; token: string | null }
  | { action: 'close' }
  | { action: 'review' }
  | { action: 'search_product'; item: SandboxInvoicePendingItem; displayNumber: number; query: string }
  | { action: 'link_product'; item: SandboxInvoicePendingItem; displayNumber: number; option: number }
  | null {
  const normalized = normalizeText(text);
  if (/^(cerrar|cancelar|cancelo|no)(\s+ticket)?$/.test(normalized)) return { action: 'close' };

  const withToken = normalized.match(/^(?:ok|si|confirmo|confirmar|cargar|continuar|aplicar)\s+(\d{4})$/);
  if (withToken) return { action: 'continue', token: withToken[1] };

  if (/^(si|ok|dale|confirmo)$/.test(normalized)) {
    return { action: 'continue', token: null };
  }

  if (/^(cargar|continuar|confirmar|aplicar)(\s+factura)?$/.test(normalized)) {
    return { action: 'continue', token: null };
  }

  const tokenOnly = normalized.match(/^(\d{4})$/);
  if (tokenOnly) return { action: 'continue', token: tokenOnly[1] };

  if (/^(revisar|pendientes|productos|ver pendientes|listar pendientes|detalle)(\s+productos)?$/.test(normalized)) {
    return { action: 'review' };
  }

  const search = normalized.match(/^(?:buscar|busca|producto|productos)\s+(\d+)\s+(.+)$/);
  if (search) {
    const resolved = pendingItemFromChatRef(ticket, search[1]);
    const query = search[2]?.trim() ?? '';
    if (resolved && query) {
      return {
        action: 'search_product',
        item: resolved.item,
        displayNumber: resolved.displayNumber,
        query,
      };
    }
  }

  const link = normalized.match(/^(?:enlazar|vincular|usar|elegir)\s+(\d+)\s+(\d+)$/);
  if (link) {
    const resolved = pendingItemFromChatRef(ticket, link[1]);
    const option = Number(link[2]);
    if (resolved && Number.isInteger(option) && option > 0) {
      return {
        action: 'link_product',
        item: resolved.item,
        displayNumber: resolved.displayNumber,
        option,
      };
    }
  }

  return null;
}

async function insertSandboxTicketAssistantReply(params: {
  db: any;
  tenantId: string;
  userId: string;
  actorId: string | null;
  ticketId: string;
  body: string;
  metadata?: Record<string, unknown>;
  writeSandboxMessage?: boolean;
}): Promise<{ messages: WhatsAppSandboxMessage[]; replies: WhatsAppTextHandlerReply[] }> {
  const reply = textReply(params.body);
  if (params.writeSandboxMessage !== false) {
    await insertWhatsAppSandboxMessage({
      db: params.db,
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: params.actorId,
      role: 'assistant',
      content: reply.body,
      metadata: {
        kind: 'sandbox_invoice_ticket_chat',
        ticket_id: params.ticketId,
        ...(params.metadata ?? {}),
      },
    });
  }
  return {
    messages: params.writeSandboxMessage === false ? [] : await loadWhatsAppSandboxMessages(params),
    replies: [reply],
  };
}

export function buildWhatsAppSandboxWaId(params: { tenantId: string; userId: string }): string {
  return `sandbox:${params.tenantId}:${params.userId}`;
}

export function sandboxRoleFromSession(params: {
  rol: SessionRole;
  isSuperAdmin: boolean;
}): WhatsAppSandboxRole {
  if (params.isSuperAdmin || params.rol === 'admin') return 'admin';
  if (params.rol === 'visor') return 'readonly';
  return 'operador';
}

export async function ensureWhatsAppSandboxActor(params: {
  db: any;
  tenantId: string;
  userId: string;
  role: WhatsAppSandboxRole;
}): Promise<{ id: string; fromWaId: string }> {
  const { db, tenantId, userId, role } = params;
  const fromWaId = buildWhatsAppSandboxWaId({ tenantId, userId });

  const { data: existing, error: existingErr } = await db
    .from('whatsapp_actor' as any)
    .select('id, rol_whatsapp, trust_level, activo')
    .eq('tenant_id', tenantId)
    .eq('from_wa_id', fromWaId)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);

  const nowIso = new Date().toISOString();
  if (existing?.id) {
    const needsUpdate =
      existing.rol_whatsapp !== role ||
      existing.trust_level !== 'verified' ||
      existing.activo !== true;
    if (needsUpdate) {
      const { error: updateErr } = await db
        .from('whatsapp_actor' as any)
        .update({
          usuario_id: userId,
          rol_whatsapp: role,
          trust_level: 'verified',
          activo: true,
          verified_at: nowIso,
        })
        .eq('tenant_id', tenantId)
        .eq('id', existing.id);
      if (updateErr) throw new Error(updateErr.message);
    }
    return { id: String(existing.id), fromWaId };
  }

  const { data: created, error: createErr } = await db
    .from('whatsapp_actor' as any)
    .insert({
      tenant_id: tenantId,
      usuario_id: userId,
      from_wa_id: fromWaId,
      rol_whatsapp: role,
      trust_level: 'verified',
      activo: true,
      verified_at: nowIso,
      replaced_by_actor_id: null,
    })
    .select('id')
    .single();

  if (createErr) {
    const { data: recovered, error: recoverErr } = await db
      .from('whatsapp_actor' as any)
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('from_wa_id', fromWaId)
      .maybeSingle();
    if (recoverErr || !recovered?.id) {
      throw new Error(createErr.message);
    }
    return { id: String(recovered.id), fromWaId };
  }

  return { id: String(created.id), fromWaId };
}

export async function loadWhatsAppSandboxMessages(params: {
  db: any;
  tenantId: string;
  userId: string;
  limit?: number;
}): Promise<WhatsAppSandboxMessage[]> {
  const limit = Math.max(1, Math.min(300, Number(params.limit ?? 200)));
  const { data, error } = await params.db
    .from('whatsapp_sandbox_message' as any)
    .select('id, role, content, metadata, created_at')
    .eq('tenant_id', params.tenantId)
    .eq('usuario_id', params.userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  return ((data ?? []) as any[]).reverse().map(normalizeSandboxMessage);
}

export async function insertWhatsAppSandboxMessage(params: {
  db: any;
  tenantId: string;
  userId: string;
  actorId: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await params.db.from('whatsapp_sandbox_message' as any).insert({
    tenant_id: params.tenantId,
    usuario_id: params.userId,
    actor_id: params.actorId,
    role: params.role,
    content: params.content,
    metadata: params.metadata ?? {},
  });
  if (error) throw new Error(error.message);
}

export async function createOrReuseInvoiceAction(params: {
  db: any;
  tenantId: string;
  actorId: string;
  fromWaId: string;
  lectorJobId: string;
  impactHash: string;
}): Promise<{ token: string; actionId: string | null }> {
  const actionSignature = buildInvoiceActionSignature({
    tenantId: params.tenantId,
    lectorJobId: params.lectorJobId,
    impactHash: params.impactHash,
  });

  const { data: existing, error: existingErr } = await params.db
    .from('whatsapp_action_log' as any)
    .select('id, action_status, confirmation_token')
    .eq('tenant_id', params.tenantId)
    .eq('action_signature', actionSignature)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);

  if (existing?.id && existing.action_status === 'pending_confirmation' && existing.confirmation_token) {
    return { token: String(existing.confirmation_token), actionId: String(existing.id) };
  }
  if (existing?.id && existing.action_status === 'executed') {
    throw new Error('La accion de carga de esta factura ya fue ejecutada.');
  }

  const token = confirmationToken();
  const expiresAt = new Date(Date.now() + CONFIRMATION_WINDOW_MINUTES * 60_000).toISOString();
  const actionPayload = {
    lector_factura_job_id: params.lectorJobId,
    impact_hash: params.impactHash,
    tool_version: 'sandbox-v1',
  };

  if (existing?.id) {
    const { error: updateErr } = await params.db
      .from('whatsapp_action_log' as any)
      .update({
        actor_id: params.actorId,
        from_wa_id: params.fromWaId,
        action_type: 'lector_factura_confirmar_importado',
        action_status: 'pending_confirmation',
        confirmation_token: token,
        confirmation_expires_at: expiresAt,
        action_payload: actionPayload,
        result_payload: null,
        error_detail: null,
        confirmed_at: null,
        executed_at: null,
      })
      .eq('id', existing.id)
      .eq('tenant_id', params.tenantId);
    if (updateErr) throw new Error(updateErr.message);
    return { token, actionId: String(existing.id) };
  }

  const { data: inserted, error: insertErr } = await params.db
    .from('whatsapp_action_log' as any)
    .insert({
      tenant_id: params.tenantId,
      actor_id: params.actorId,
      from_wa_id: params.fromWaId,
      action_type: 'lector_factura_confirmar_importado',
      action_status: 'pending_confirmation',
      action_signature: actionSignature,
      confirmation_token: token,
      confirmation_expires_at: expiresAt,
      action_payload: actionPayload,
    })
    .select('id')
    .single();
  if (insertErr) throw new Error(insertErr.message);

  return { token, actionId: inserted?.id ? String(inserted.id) : null };
}

export function buildWhatsAppSandboxInvoiceTicketSnapshot(params: {
  resultado: unknown;
  prepared: PrepararConfirmacionLectorFacturaResult;
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
    total: numberOrNull(totals.total) ?? r.total,
    items_count: r.total_items,
    productos_vinculados: r.productos_vinculados,
    productos_pendientes: pendingItems.length,
    productos_nuevos: r.productos_nuevos,
    productos_para_revisar: r.productos_para_revisar,
    afecta_stock: r.afecta_stock,
    afecta_cuenta_corriente: r.afecta_cuenta_corriente,
    actualizar_costos: r.actualizar_costos,
    cambios_costos: params.prepared.impacto.cambios_costos,
    advertencias: params.prepared.impacto.advertencias,
    conflictos: params.prepared.impacto.conflictos,
    bloqueantes: blockingReasons,
    impact_hash: params.prepared.impactHash,
    can_apply: status === 'ready',
  };
  return { summary, pendingItems, status, blockingReasons };
}

export async function insertWhatsAppSandboxInvoiceTicket(params: {
  db: any;
  tenantId: string;
  userId: string;
  actorId: string;
  fromWaId: string;
  lectorFacturaJobId: string;
  actionLogId: string | null;
  snapshot: ReturnType<typeof buildWhatsAppSandboxInvoiceTicketSnapshot>;
}): Promise<SandboxInvoiceTicket> {
  const { data, error } = await params.db
    .from('whatsapp_sandbox_invoice_ticket' as any)
    .insert({
      tenant_id: params.tenantId,
      usuario_id: params.userId,
      actor_id: params.actorId,
      from_wa_id: params.fromWaId,
      lector_factura_job_id: params.lectorFacturaJobId,
      action_log_id: params.actionLogId,
      status: params.snapshot.status,
      summary: params.snapshot.summary,
      pending_items: params.snapshot.pendingItems,
      impact_hash: params.snapshot.summary.impact_hash,
      error_detail:
        params.snapshot.status === 'needs_review'
          ? params.snapshot.blockingReasons.join(' | ') || null
          : null,
    })
    .select(SANDBOX_INVOICE_TICKET_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return normalizeTicketRow(data);
}

export async function listWhatsAppSandboxInvoiceTickets(params: {
  db: any;
  tenantId: string;
  userId: string;
  limit?: number;
}): Promise<SandboxInvoiceTicket[]> {
  const limit = Math.max(1, Math.min(100, Number(params.limit ?? 20)));
  const { data, error } = await params.db
    .from('whatsapp_sandbox_invoice_ticket' as any)
    .select(SANDBOX_INVOICE_TICKET_SELECT)
    .eq('tenant_id', params.tenantId)
    .eq('usuario_id', params.userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map(normalizeTicketRow);
}

async function loadWhatsAppSandboxInvoiceTicket(params: {
  db: any;
  tenantId: string;
  userId: string;
  ticketId: string;
}): Promise<SandboxInvoiceTicket | null> {
  const { data, error } = await params.db
    .from('whatsapp_sandbox_invoice_ticket' as any)
    .select(SANDBOX_INVOICE_TICKET_SELECT)
    .eq('tenant_id', params.tenantId)
    .eq('usuario_id', params.userId)
    .eq('id', params.ticketId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ? normalizeTicketRow(data) : null;
}

async function loadActiveWhatsAppSandboxInvoiceTicket(params: {
  db: any;
  tenantId: string;
  userId: string;
  fromWaId?: string | null;
}): Promise<SandboxInvoiceTicket | null> {
  const tickets = await listWhatsAppSandboxInvoiceTickets({
    db: params.db,
    tenantId: params.tenantId,
    userId: params.userId,
    limit: 20,
  });
  return tickets.find((ticket) => {
    if (!OPEN_TICKET_STATUSES.includes(ticket.status)) return false;
    if (params.fromWaId && ticket.from_wa_id !== params.fromWaId) return false;
    return true;
  }) ?? null;
}

async function updateTicketSnapshot(params: {
  db: any;
  tenantId: string;
  ticketId: string;
  snapshot: ReturnType<typeof buildWhatsAppSandboxInvoiceTicketSnapshot>;
  actionLogId?: string | null;
  status?: SandboxInvoiceTicketStatus;
  errorDetail?: string | null;
}): Promise<SandboxInvoiceTicket> {
  const nextStatus = params.status ?? params.snapshot.status;
  const { data, error } = await params.db
    .from('whatsapp_sandbox_invoice_ticket' as any)
    .update({
      status: nextStatus,
      summary: {
        ...params.snapshot.summary,
        can_apply: nextStatus === 'ready',
      },
      pending_items: params.snapshot.pendingItems,
      impact_hash: params.snapshot.summary.impact_hash,
      ...(params.actionLogId !== undefined ? { action_log_id: params.actionLogId } : {}),
      error_detail:
        params.errorDetail !== undefined
          ? params.errorDetail
          : nextStatus === 'needs_review'
            ? params.snapshot.blockingReasons.join(' | ') || null
            : null,
    })
    .eq('id', params.ticketId)
    .eq('tenant_id', params.tenantId)
    .select(SANDBOX_INVOICE_TICKET_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return normalizeTicketRow(data);
}

async function cancelInvoiceAction(params: {
  db: any;
  tenantId: string;
  actionLogId: string | null;
  reason: string;
}) {
  if (!params.actionLogId) return;
  const { error } = await params.db
    .from('whatsapp_action_log' as any)
    .update({
      action_status: 'cancelled',
      error_detail: params.reason,
    })
    .eq('id', params.actionLogId)
    .eq('tenant_id', params.tenantId)
    .eq('action_status', 'pending_confirmation');
  if (error) throw new Error(error.message);
}

async function updateTicketChatState(params: {
  db: any;
  tenantId: string;
  ticketId: string;
  chatState: SandboxInvoiceTicketChatState;
}): Promise<SandboxInvoiceTicket> {
  const { data, error } = await params.db
    .from('whatsapp_sandbox_invoice_ticket' as any)
    .update({
      chat_state: params.chatState,
    })
    .eq('id', params.ticketId)
    .eq('tenant_id', params.tenantId)
    .select(SANDBOX_INVOICE_TICKET_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return normalizeTicketRow(data);
}

async function searchProductsForTicketChat(params: {
  db: any;
  tenantId: string;
  query: string;
}): Promise<SandboxInvoiceTicketProductSuggestion[]> {
  const like = params.query.replace(/[%_,]/g, ' ').trim();
  if (!like) return [];
  const { data, error } = await params.db
    .from('producto' as any)
    .select('id, codigo, nombre, precio_costo, unidad')
    .eq('tenant_id', params.tenantId)
    .eq('activo', true)
    .ilike('nombre', `%${like}%`)
    .order('nombre')
    .limit(5);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) {
    const byCode = await params.db
      .from('producto' as any)
      .select('id, codigo, nombre, precio_costo, unidad')
      .eq('tenant_id', params.tenantId)
      .eq('activo', true)
      .ilike('codigo', `%${like}%`)
      .order('nombre')
      .limit(5);
    if (byCode.error) throw new Error(byCode.error.message);
    rows.push(...((byCode.data ?? []) as any[]));
  }
  return rows.map((row, index) => ({
    option: index + 1,
    producto_id: String(row.id),
    nombre: String(row.nombre ?? 'Producto'),
    codigo: row.codigo ?? null,
    precio_costo: row.precio_costo == null ? null : Number(row.precio_costo),
    unidad: row.unidad ?? null,
  }));
}

function productSearchReply(params: {
  displayNumber: number;
  item: SandboxInvoicePendingItem;
  results: SandboxInvoiceTicketProductSuggestion[];
}): string {
  if (params.results.length === 0) {
    return [
      `No encontre productos para el item ${params.displayNumber}: ${params.item.descripcion}.`,
      'Proba con otro texto, por ejemplo: "buscar 1 coca".',
    ].join('\n');
  }
  const options = params.results.map((product) => {
    const details = [
      product.codigo ? `cod. ${product.codigo}` : null,
      product.unidad,
      product.precio_costo != null ? formatAmount(product.precio_costo) : null,
    ].filter(Boolean).join(', ');
    return `${product.option}. ${product.nombre}${details ? ` (${details})` : ''}`;
  });
  return [
    `Opciones para item ${params.displayNumber}: ${params.item.descripcion}`,
    ...options,
    '',
    `Para enlazar responde: "enlazar ${params.displayNumber} 1" cambiando el ultimo numero por la opcion correcta.`,
  ].join('\n');
}

async function loadTicketJob(params: {
  db: any;
  tenantId: string;
  ticket: SandboxInvoiceTicket;
}) {
  const { data: job, error } = await params.db
    .from('lector_factura_job' as any)
    .select('id, tenant_id, sucursal_id, usuario_id, status, resultado, application_status, applied_comprobante_id')
    .eq('id', params.ticket.lector_factura_job_id)
    .eq('tenant_id', params.tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job?.id) throw new Error('Job de factura no encontrado.');
  return job;
}

async function refreshTicketFromJob(params: {
  db: any;
  tenantId: string;
  ticket: SandboxInvoiceTicket;
  job: any;
}): Promise<{
  prepared: PrepararConfirmacionLectorFacturaResult;
  snapshot: ReturnType<typeof buildWhatsAppSandboxInvoiceTicketSnapshot>;
  token: string | null;
  actionId: string | null;
  ticket: SandboxInvoiceTicket;
}> {
  const prepared = await prepararConfirmacionLectorFacturaDesdeResultado({
    db: params.db,
    tenantId: params.tenantId,
    sucursalId: params.job.sucursal_id ?? null,
    resultado: params.job.resultado,
  });
  const snapshot = buildWhatsAppSandboxInvoiceTicketSnapshot({
    resultado: params.job.resultado,
    prepared,
  });

  let token: string | null = null;
  let actionId = params.ticket.action_log_id;
  if (snapshot.status === 'ready') {
    const action = await createOrReuseInvoiceAction({
      db: params.db,
      tenantId: params.tenantId,
      actorId: params.ticket.actor_id,
      fromWaId: params.ticket.from_wa_id,
      lectorJobId: params.ticket.lector_factura_job_id,
      impactHash: prepared.impactHash,
    });
    token = action.token;
    actionId = action.actionId;
  } else {
    await cancelInvoiceAction({
      db: params.db,
      tenantId: params.tenantId,
      actionLogId: params.ticket.action_log_id,
      reason: 'ticket_requires_review',
    });
    actionId = null;
  }

  const { error: jobUpdateErr } = await params.db
    .from('lector_factura_job' as any)
    .update({
      resultado: params.job.resultado,
      impacto_preview: prepared.impacto,
      impact_hash: prepared.impactHash,
      confirm_payload: prepared.confirmPayload,
      application_status: snapshot.status === 'ready' ? 'pending' : 'blocked',
      applied_error: snapshot.status === 'ready' ? null : snapshot.blockingReasons.join(' | '),
    })
    .eq('id', params.ticket.lector_factura_job_id)
    .eq('tenant_id', params.tenantId);
  if (jobUpdateErr) throw new Error(jobUpdateErr.message);

  const updatedTicket = await updateTicketSnapshot({
    db: params.db,
    tenantId: params.tenantId,
    ticketId: params.ticket.id,
    snapshot,
    actionLogId: actionId,
  });

  await sincronizarBorradorWhatsappDesdeJob({
    db: params.db,
    tenantId: params.tenantId,
    resultadoJob: params.job.resultado,
    ticketId: params.ticket.id,
  });

  return { prepared, snapshot, token, actionId, ticket: updatedTicket };
}

async function borradorUrlParaTicket(params: {
  db: any;
  tenantId: string;
  ticket: SandboxInvoiceTicket;
  snapshot: ReturnType<typeof buildWhatsAppSandboxInvoiceTicketSnapshot>;
  resultado: unknown;
}): Promise<string | null> {
  return resolverBorradorUrlWhatsapp({
    db: params.db,
    tenantId: params.tenantId,
    snapshot: params.snapshot,
    resultado: params.resultado,
    meta: {
      lectorFacturaJobId: params.ticket.lector_factura_job_id,
      whatsappTicketId: params.ticket.id,
    },
  });
}

export async function closeWhatsAppSandboxInvoiceTicket(params: {
  db: any;
  tenantId: string;
  userId: string;
  ticketId: string;
  actorId?: string | null;
  writeSandboxMessage?: boolean;
}): Promise<{ ticket: SandboxInvoiceTicket; messages: WhatsAppSandboxMessage[]; reply: WhatsAppTextHandlerReply }> {
  const writeSandboxMessage = params.writeSandboxMessage !== false;
  const ticket = await loadWhatsAppSandboxInvoiceTicket(params);
  if (!ticket) throw new Error('Ticket de factura no encontrado.');
  if (ticket.status === 'applied') {
    const reply = textReply('La factura ya fue cargada; no puedo cerrar ese ticket.');
    if (writeSandboxMessage) {
      await insertWhatsAppSandboxMessage({
        db: params.db,
        tenantId: params.tenantId,
        userId: params.userId,
        actorId: params.actorId ?? ticket.actor_id,
        role: 'assistant',
        content: reply.body,
        metadata: { kind: 'sandbox_invoice_ticket_status', ticket_id: ticket.id },
      });
    }
    return {
      ticket,
      messages: writeSandboxMessage ? await loadWhatsAppSandboxMessages(params) : [],
      reply,
    };
  }

  await cancelInvoiceAction({
    db: params.db,
    tenantId: params.tenantId,
    actionLogId: ticket.action_log_id,
    reason: 'ticket_closed_by_user',
  });

  const nowIso = new Date().toISOString();
  const { data, error } = await params.db
    .from('whatsapp_sandbox_invoice_ticket' as any)
    .update({
      status: 'closed',
      closed_at: nowIso,
      error_detail: null,
    })
    .eq('id', ticket.id)
    .eq('tenant_id', params.tenantId)
    .select(SANDBOX_INVOICE_TICKET_SELECT)
    .single();
  if (error) throw new Error(error.message);

  const updatedTicket = normalizeTicketRow(data);
  const reply = textReply('Ticket cerrado. No se cargo la factura ni se modificaron datos.');
  if (writeSandboxMessage) {
    await insertWhatsAppSandboxMessage({
      db: params.db,
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: params.actorId ?? ticket.actor_id,
      role: 'assistant',
      content: reply.body,
      metadata: { kind: 'sandbox_invoice_ticket_status', ticket_id: ticket.id },
    });
  }
  return {
    ticket: updatedTicket,
    messages: writeSandboxMessage ? await loadWhatsAppSandboxMessages(params) : [],
    reply,
  };
}

export async function continueWhatsAppSandboxInvoiceTicket(params: {
  db: any;
  tenantId: string;
  userId: string;
  ticketId: string;
  token?: string | null;
  actorId?: string | null;
  writeSandboxMessage?: boolean;
}): Promise<{ ticket: SandboxInvoiceTicket; messages: WhatsAppSandboxMessage[]; reply: WhatsAppTextHandlerReply }> {
  const writeSandboxMessage = params.writeSandboxMessage !== false;
  const ticket = await loadWhatsAppSandboxInvoiceTicket(params);
  if (!ticket) throw new Error('Ticket de factura no encontrado.');
  if (ticket.status === 'closed') {
    const reply = textReply('Ese ticket ya esta cerrado. Subi la factura otra vez si queres reabrir el analisis.');
    if (writeSandboxMessage) {
      await insertWhatsAppSandboxMessage({
        db: params.db,
        tenantId: params.tenantId,
        userId: params.userId,
        actorId: params.actorId ?? ticket.actor_id,
        role: 'assistant',
        content: reply.body,
        metadata: { kind: 'sandbox_invoice_ticket_status', ticket_id: ticket.id },
      });
    }
    return { ticket, messages: writeSandboxMessage ? await loadWhatsAppSandboxMessages(params) : [], reply };
  }
  if (ticket.status === 'applied') {
    const reply = textReply('Ese ticket ya fue cargado.');
    if (writeSandboxMessage) {
      await insertWhatsAppSandboxMessage({
        db: params.db,
        tenantId: params.tenantId,
        userId: params.userId,
        actorId: params.actorId ?? ticket.actor_id,
        role: 'assistant',
        content: reply.body,
        metadata: { kind: 'sandbox_invoice_ticket_status', ticket_id: ticket.id },
      });
    }
    return { ticket, messages: writeSandboxMessage ? await loadWhatsAppSandboxMessages(params) : [], reply };
  }

  if (params.token && ticket.action_log_id) {
    const { data: action, error: actionErr } = await params.db
      .from('whatsapp_action_log' as any)
      .select('id, confirmation_token')
      .eq('id', ticket.action_log_id)
      .eq('tenant_id', params.tenantId)
      .maybeSingle();
    if (actionErr) throw new Error(actionErr.message);
    if (action?.confirmation_token && String(action.confirmation_token) !== params.token) {
      const reply = textReply('Codigo de confirmacion incorrecto. Revisalo y volve a intentar.');
      if (writeSandboxMessage) {
        await insertWhatsAppSandboxMessage({
          db: params.db,
          tenantId: params.tenantId,
          userId: params.userId,
          actorId: params.actorId ?? ticket.actor_id,
          role: 'assistant',
          content: reply.body,
          metadata: { kind: 'sandbox_invoice_ticket_status', ticket_id: ticket.id },
        });
      }
      return { ticket, messages: writeSandboxMessage ? await loadWhatsAppSandboxMessages(params) : [], reply };
    }
  }

  const job = await loadTicketJob({ db: params.db, tenantId: params.tenantId, ticket });
  const refreshed = await refreshTicketFromJob({
    db: params.db,
    tenantId: params.tenantId,
    ticket,
    job,
  });

  if (refreshed.snapshot.status !== 'ready') {
    const borradorUrl = await borradorUrlParaTicket({
      db: params.db,
      tenantId: params.tenantId,
      ticket: refreshed.ticket,
      snapshot: refreshed.snapshot,
      resultado: job.resultado,
    });
    const reply = textReply(
      buildWhatsAppInvoiceTicketChatSummary(refreshed.ticket, refreshed.token, borradorUrl),
    );
    if (writeSandboxMessage) {
      await insertWhatsAppSandboxMessage({
        db: params.db,
        tenantId: params.tenantId,
        userId: params.userId,
        actorId: params.actorId ?? ticket.actor_id,
        role: 'assistant',
        content: reply.body,
        metadata: { kind: 'sandbox_invoice_ticket', ticket_id: ticket.id },
      });
    }
    return {
      ticket: refreshed.ticket,
      messages: writeSandboxMessage ? await loadWhatsAppSandboxMessages(params) : [],
      reply,
    };
  }

  const applied = await aplicarConfirmacionLectorFacturaJob({
    db: params.db,
    tenantId: params.tenantId,
    job,
    sucursalId: job.sucursal_id ?? null,
    userId: job.usuario_id ?? params.userId,
    acceptedImpactHash: refreshed.prepared.impactHash,
  });

  if (!applied.ok) {
    const { data, error } = await params.db
      .from('whatsapp_sandbox_invoice_ticket' as any)
      .update({
        status: 'error',
        error_detail: applied.error,
      })
      .eq('id', ticket.id)
      .eq('tenant_id', params.tenantId)
      .select(SANDBOX_INVOICE_TICKET_SELECT)
      .single();
    if (error) throw new Error(error.message);
    const errorTicket = normalizeTicketRow(data);
    const reply = textReply(`No pude cargar la factura: ${applied.error}`);
    if (writeSandboxMessage) {
      await insertWhatsAppSandboxMessage({
        db: params.db,
        tenantId: params.tenantId,
        userId: params.userId,
        actorId: params.actorId ?? ticket.actor_id,
        role: 'assistant',
        content: reply.body,
        metadata: { kind: 'sandbox_invoice_ticket_status', ticket_id: ticket.id },
      });
    }
    return {
      ticket: errorTicket,
      messages: writeSandboxMessage ? await loadWhatsAppSandboxMessages(params) : [],
      reply,
    };
  }

  const nowIso = new Date().toISOString();
  if (refreshed.actionId) {
    const { error: actionErr } = await params.db
      .from('whatsapp_action_log' as any)
      .update({
        action_status: 'executed',
        confirmed_at: nowIso,
        executed_at: nowIso,
        result_payload: {
          comprobante_id: applied.comprobante_id,
          actualizaciones_costos: applied.actualizaciones_costos,
          idempotent_replay: applied.idempotent_replay,
        },
        error_detail: null,
      })
      .eq('id', refreshed.actionId)
      .eq('tenant_id', params.tenantId);
    if (actionErr) throw new Error(actionErr.message);
  }

  const { data, error } = await params.db
    .from('whatsapp_sandbox_invoice_ticket' as any)
    .update({
      status: 'applied',
      applied_at: nowIso,
      error_detail: null,
    })
    .eq('id', ticket.id)
    .eq('tenant_id', params.tenantId)
    .select(SANDBOX_INVOICE_TICKET_SELECT)
    .single();
  if (error) throw new Error(error.message);

  const appliedTicket = normalizeTicketRow(data);
  const reply = textReply(
    resumenAplicacionLectorFactura({
      comprobanteId: applied.comprobante_id,
      actualizacionesCostos: applied.actualizaciones_costos,
    }),
  );
  if (writeSandboxMessage) {
    await insertWhatsAppSandboxMessage({
      db: params.db,
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: params.actorId ?? ticket.actor_id,
      role: 'assistant',
      content: reply.body,
      metadata: {
        kind: 'sandbox_invoice_ticket_applied',
        ticket_id: ticket.id,
        comprobante_id: applied.comprobante_id,
      },
    });
  }
  return {
    ticket: appliedTicket,
    messages: writeSandboxMessage ? await loadWhatsAppSandboxMessages(params) : [],
    reply,
  };
}

export async function linkWhatsAppSandboxInvoiceTicketItem(params: {
  db: any;
  tenantId: string;
  userId: string;
  ticketId: string;
  itemIndice: number;
  productoId: string;
  writeSandboxMessage?: boolean;
}): Promise<{ ticket: SandboxInvoiceTicket; messages: WhatsAppSandboxMessage[]; reply: WhatsAppTextHandlerReply }> {
  const writeSandboxMessage = params.writeSandboxMessage !== false;
  const ticket = await loadWhatsAppSandboxInvoiceTicket(params);
  if (!ticket) throw new Error('Ticket de factura no encontrado.');
  if (ticket.status === 'closed' || ticket.status === 'applied') {
    throw new Error('Este ticket ya no admite cambios.');
  }

  const { data: producto, error: productoErr } = await params.db
    .from('producto' as any)
    .select('id, codigo, nombre, iva_porcentaje, unidad, unidad_compra, contenido_unidad_compra, activo')
    .eq('tenant_id', params.tenantId)
    .eq('id', params.productoId)
    .eq('activo', true)
    .maybeSingle();
  if (productoErr) throw new Error(productoErr.message);
  if (!producto?.id) throw new Error('Producto no encontrado o inactivo.');

  const job = await loadTicketJob({ db: params.db, tenantId: params.tenantId, ticket });
  const preview = extractInvoicePreview(job.resultado);
  if (!preview) throw new Error('El job no tiene un resultado de factura valido.');
  const items = asArray(preview.items);
  const item = items
    .map((rawItem, position) => ({ item: asRecord(rawItem), position }))
    .find(({ item, position }) => (numberOrNull(item.indice) ?? position) === params.itemIndice);
  if (!item) throw new Error('Item de factura no encontrado en el ticket.');

  item.item.match = {
    producto_id: String(producto.id),
    confidence: 1,
    metodo: 'manual_ticket',
    producto_nombre: String(producto.nombre ?? ''),
    requires_review: false,
  };
  item.item.producto_unidad = producto.unidad ?? item.item.producto_unidad ?? null;
  item.item.producto_unidad_compra = producto.unidad_compra ?? item.item.producto_unidad_compra ?? null;
  item.item.producto_contenido_unidad_compra =
    producto.contenido_unidad_compra ?? item.item.producto_contenido_unidad_compra ?? null;
  if (item.item.iva_porcentaje == null && producto.iva_porcentaje != null) {
    item.item.iva_porcentaje = producto.iva_porcentaje;
  }

  const refreshed = await refreshTicketFromJob({
    db: params.db,
    tenantId: params.tenantId,
    ticket,
    job,
  });
  const refreshedTicket = await updateTicketChatState({
    db: params.db,
    tenantId: params.tenantId,
    ticketId: ticket.id,
    chatState: {},
  });

  const borradorUrl = await borradorUrlParaTicket({
    db: params.db,
    tenantId: params.tenantId,
    ticket: refreshedTicket,
    snapshot: refreshed.snapshot,
    resultado: job.resultado,
  });
  const reply = textReply(
    buildWhatsAppInvoiceTicketChatSummary(refreshedTicket, refreshed.token, borradorUrl),
  );
  if (writeSandboxMessage) {
    await insertWhatsAppSandboxMessage({
      db: params.db,
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: ticket.actor_id,
      role: 'assistant',
      content: reply.body,
      metadata: {
        kind: 'sandbox_invoice_ticket',
        ticket_id: ticket.id,
        linked_item_indice: params.itemIndice,
        linked_producto_id: params.productoId,
      },
    });
  }

  return {
    ticket: refreshedTicket,
    messages: writeSandboxMessage ? await loadWhatsAppSandboxMessages(params) : [],
    reply,
  };
}

export async function hasPendingRealSandboxInvoiceAction(params: {
  db: any;
  tenantId: string;
  actorId: string;
  fromWaId: string;
}): Promise<boolean> {
  const { data, error } = await params.db
    .from('whatsapp_action_log' as any)
    .select('id')
    .eq('tenant_id', params.tenantId)
    .eq('actor_id', params.actorId)
    .eq('from_wa_id', params.fromWaId)
    .eq('action_type', 'lector_factura_confirmar_importado')
    .eq('action_status', 'pending_confirmation')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

function contentFromReply(reply: WhatsAppTextHandlerReply): string {
  if (reply.messageType === 'document' && reply.documentLink) {
    const caption = reply.documentCaption || reply.body || 'Reporte PDF';
    return `${caption}\n${reply.documentLink}`;
  }
  return reply.body;
}

function isReadonlyTicketRole(role: string | null | undefined): boolean {
  const normalized = normalizeText(String(role ?? ''));
  return normalized === 'readonly' || normalized === 'visor';
}

export async function handleWhatsAppInvoiceTicketChatCommand(params: {
  db: any;
  tenantId: string;
  userId: string;
  actorId: string;
  fromWaId: string;
  actorRole?: string | null;
  content: string;
  writeSandboxMessage?: boolean;
}): Promise<
  | { handled: false }
  | { handled: true; messages: WhatsAppSandboxMessage[]; replies: WhatsAppTextHandlerReply[] }
> {
  const activeInvoiceTicket = await loadActiveWhatsAppSandboxInvoiceTicket({
    db: params.db,
    tenantId: params.tenantId,
    userId: params.userId,
    fromWaId: params.fromWaId,
  });
  const ticketCommand = activeInvoiceTicket
    ? parseTicketChatCommand(params.content, activeInvoiceTicket)
    : null;
  if (!activeInvoiceTicket || !ticketCommand) return { handled: false };

  if (
    isReadonlyTicketRole(params.actorRole) &&
    (ticketCommand.action === 'continue' || ticketCommand.action === 'link_product')
  ) {
    const reply = await insertSandboxTicketAssistantReply({
      db: params.db,
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: params.actorId,
      ticketId: activeInvoiceTicket.id,
      body: 'Tu rol de WhatsApp es solo lectura. Podes revisar el ticket, pero no cargar la factura ni enlazar productos.',
      metadata: { ticket_chat_action: 'readonly_denied' },
      writeSandboxMessage: params.writeSandboxMessage,
    });
    return { handled: true, ...reply };
  }

  if (ticketCommand.action === 'close') {
    const result = await closeWhatsAppSandboxInvoiceTicket({
      db: params.db,
      tenantId: params.tenantId,
      userId: params.userId,
      ticketId: activeInvoiceTicket.id,
      actorId: params.actorId,
      writeSandboxMessage: params.writeSandboxMessage,
    });
    return { handled: true, messages: result.messages, replies: [result.reply] };
  }

  if (ticketCommand.action === 'continue') {
    const result = await continueWhatsAppSandboxInvoiceTicket({
      db: params.db,
      tenantId: params.tenantId,
      userId: params.userId,
      ticketId: activeInvoiceTicket.id,
      token: ticketCommand.token,
      actorId: params.actorId,
      writeSandboxMessage: params.writeSandboxMessage,
    });
    return { handled: true, messages: result.messages, replies: [result.reply] };
  }

  if (ticketCommand.action === 'review') {
    const reply = await insertSandboxTicketAssistantReply({
      db: params.db,
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: params.actorId,
      ticketId: activeInvoiceTicket.id,
      body: buildPendingItemsChat(activeInvoiceTicket),
      metadata: { ticket_chat_action: 'review_pending_items' },
      writeSandboxMessage: params.writeSandboxMessage,
    });
    return { handled: true, ...reply };
  }

  if (ticketCommand.action === 'search_product') {
    const results = await searchProductsForTicketChat({
      db: params.db,
      tenantId: params.tenantId,
      query: ticketCommand.query,
    });
    await updateTicketChatState({
      db: params.db,
      tenantId: params.tenantId,
      ticketId: activeInvoiceTicket.id,
      chatState:
        results.length > 0
          ? {
              last_product_search: {
                item_indice: ticketCommand.item.indice,
                query: ticketCommand.query,
                results,
                created_at: new Date().toISOString(),
              },
            }
          : {},
    });
    const reply = await insertSandboxTicketAssistantReply({
      db: params.db,
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: params.actorId,
      ticketId: activeInvoiceTicket.id,
      body: productSearchReply({
        displayNumber: ticketCommand.displayNumber,
        item: ticketCommand.item,
        results,
      }),
      metadata: {
        ticket_chat_action: 'search_product',
        item_indice: ticketCommand.item.indice,
        query: ticketCommand.query,
        results_count: results.length,
      },
      writeSandboxMessage: params.writeSandboxMessage,
    });
    return { handled: true, ...reply };
  }

  const lastSearch = activeInvoiceTicket.chat_state.last_product_search;
  if (!lastSearch || lastSearch.item_indice !== ticketCommand.item.indice) {
    const reply = await insertSandboxTicketAssistantReply({
      db: params.db,
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: params.actorId,
      ticketId: activeInvoiceTicket.id,
      body: [
        `Primero necesito buscar opciones para el item ${ticketCommand.displayNumber}.`,
        `Responde: "buscar ${ticketCommand.displayNumber} texto del producto".`,
      ].join('\n'),
      metadata: { ticket_chat_action: 'link_product_missing_search' },
      writeSandboxMessage: params.writeSandboxMessage,
    });
    return { handled: true, ...reply };
  }

  const selected = lastSearch.results.find((product) => product.option === ticketCommand.option);
  if (!selected) {
    const reply = await insertSandboxTicketAssistantReply({
      db: params.db,
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: params.actorId,
      ticketId: activeInvoiceTicket.id,
      body: `No tengo una opcion ${ticketCommand.option} para ese item. Responde "buscar ${ticketCommand.displayNumber} ${lastSearch.query}" para verlas de nuevo.`,
      metadata: { ticket_chat_action: 'link_product_invalid_option' },
      writeSandboxMessage: params.writeSandboxMessage,
    });
    return { handled: true, ...reply };
  }

  const result = await linkWhatsAppSandboxInvoiceTicketItem({
    db: params.db,
    tenantId: params.tenantId,
    userId: params.userId,
    ticketId: activeInvoiceTicket.id,
    itemIndice: ticketCommand.item.indice,
    productoId: selected.producto_id,
    writeSandboxMessage: params.writeSandboxMessage,
  });
  return {
    handled: true,
    messages: result.messages,
    replies: [result.reply],
  };
}

export async function sendWhatsAppSandboxChatMessage(params: {
  db: any;
  tenantId: string;
  userId: string;
  role: WhatsAppSandboxRole;
  content: string;
}): Promise<{ messages: WhatsAppSandboxMessage[]; replies: WhatsAppTextHandlerReply[] }> {
  const content = params.content.trim();
  if (!content) {
    return {
      messages: await loadWhatsAppSandboxMessages(params),
      replies: [],
    };
  }

  const actor = await ensureWhatsAppSandboxActor({
    db: params.db,
    tenantId: params.tenantId,
    userId: params.userId,
    role: params.role,
  });

  await insertWhatsAppSandboxMessage({
    db: params.db,
    tenantId: params.tenantId,
    userId: params.userId,
    actorId: actor.id,
    role: 'user',
    content,
  });

  const ticketCommandResult = await handleWhatsAppInvoiceTicketChatCommand({
    db: params.db,
    tenantId: params.tenantId,
    userId: params.userId,
    actorId: actor.id,
    fromWaId: actor.fromWaId,
    actorRole: params.role,
    content,
    writeSandboxMessage: true,
  });
  if (ticketCommandResult.handled) return ticketCommandResult;

  const actionMode = (await hasPendingRealSandboxInvoiceAction({
    db: params.db,
    tenantId: params.tenantId,
    actorId: actor.id,
    fromWaId: actor.fromWaId,
  }))
    ? 'execute'
    : 'simulate';

  const { handleWhatsAppTextMessage } = await import('@/lib/whatsapp/text-handler');
  const handlerResult = await handleWhatsAppTextMessage({
    db: params.db,
    tenantId: params.tenantId,
    fromWaId: actor.fromWaId,
    phoneNumberId: null,
    inboundMessageId: `sandbox:${randomUUID()}`,
    wamid: `sandbox:${randomUUID()}`,
    textBody: content,
    source: 'sandbox_text',
    mode: 'sandbox',
    actionMode,
    sandboxUserId: params.userId,
  });

  for (const reply of handlerResult.replies) {
    await insertWhatsAppSandboxMessage({
      db: params.db,
      tenantId: params.tenantId,
      userId: params.userId,
      actorId: actor.id,
      role: 'assistant',
      content: contentFromReply(reply),
      metadata: {
        message_type: reply.messageType,
        document_link: reply.documentLink,
        document_filename: reply.documentFilename,
        document_caption: reply.documentCaption,
      },
    });
  }

  return {
    messages: await loadWhatsAppSandboxMessages(params),
    replies: handlerResult.replies,
  };
}

export async function clearWhatsAppSandboxChat(params: {
  db: any;
  tenantId: string;
  userId: string;
}): Promise<void> {
  const fromWaId = buildWhatsAppSandboxWaId({
    tenantId: params.tenantId,
    userId: params.userId,
  });
  const { data: actor, error: actorErr } = await params.db
    .from('whatsapp_actor' as any)
    .select('id')
    .eq('tenant_id', params.tenantId)
    .eq('from_wa_id', fromWaId)
    .maybeSingle();
  if (actorErr) throw new Error(actorErr.message);

  const { error: messagesErr } = await params.db
    .from('whatsapp_sandbox_message' as any)
    .delete()
    .eq('tenant_id', params.tenantId)
    .eq('usuario_id', params.userId);
  if (messagesErr) throw new Error(messagesErr.message);

  const { error: actionsErr } = await params.db
    .from('whatsapp_sandbox_pending_action' as any)
    .delete()
    .eq('tenant_id', params.tenantId)
    .eq('usuario_id', params.userId);
  if (actionsErr) throw new Error(actionsErr.message);

  if (actor?.id) {
    const { error: memoryErr } = await params.db
      .from('whatsapp_conversation_state' as any)
      .delete()
      .eq('tenant_id', params.tenantId)
      .eq('actor_id', actor.id);
    if (memoryErr) throw new Error(memoryErr.message);
  }
}
