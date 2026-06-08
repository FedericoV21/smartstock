import type { WhatsAppConversationState } from '@/lib/whatsapp/conversation-memory';

/** Slots recientes para clasificación LLM (sin historial completo). */
export type WhatsAppIntentClassifierContext = {
  topic?: string | null;
  lastIntent?: string | null;
  lastEntityName?: string | null;
  lastEntityType?: string | null;
  lastReportKey?: string | null;
  lastReportPage?: number | null;
  lastOptions?: string[] | null;
  pendingPrompt?: string | null;
};

const SALES_MONTH_PATTERN =
  'enero|ene|febrero|feb|marzo|mar|abril|abr|mayo|may|junio|jun|julio|jul|agosto|ago|septiembre|setiembre|sep|set|octubre|oct|noviembre|nov|diciembre|dic';

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function conversationStateToIntentContext(
  state: WhatsAppConversationState | null | undefined,
): WhatsAppIntentClassifierContext | undefined {
  if (!state) return undefined;
  const hasSignal =
    state.topic ||
    state.lastIntent ||
    state.lastEntityName ||
    state.lastReportKey ||
    state.pendingPrompt;
  if (!hasSignal) return undefined;
  return {
    topic: state.topic,
    lastIntent: state.lastIntent,
    lastEntityName: state.lastEntityName,
    lastEntityType: state.lastEntityType,
    lastReportKey: state.lastReportKey,
    lastReportPage: state.lastReportPage,
    lastOptions: state.lastOptions?.length ? state.lastOptions : null,
    pendingPrompt: state.pendingPrompt,
  };
}

export function formatIntentContextForLlmPrompt(ctx: WhatsAppIntentClassifierContext): string[] {
  const lines: string[] = ['Contexto conversacional reciente (usar solo para desambiguar el mensaje actual):'];
  if (ctx.topic) lines.push(`- topic: ${ctx.topic}`);
  if (ctx.lastIntent) lines.push(`- lastIntent: ${ctx.lastIntent}`);
  if (ctx.lastEntityName) lines.push(`- lastEntityName: ${ctx.lastEntityName}`);
  if (ctx.lastEntityType) lines.push(`- lastEntityType: ${ctx.lastEntityType}`);
  if (ctx.lastReportKey) lines.push(`- lastReportKey: ${ctx.lastReportKey}`);
  if (ctx.lastReportPage != null) lines.push(`- lastReportPage: ${ctx.lastReportPage}`);
  if (ctx.pendingPrompt) lines.push(`- pendingPrompt: ${ctx.pendingPrompt}`);
  lines.push(
    '- Si lastIntent es reporte de ventas/productos/clientes/ganancias/medios_pago y el usuario cambia periodo (ayer, mes anterior, mayo), mantener la misma familia de reporte.',
    '- Si lastIntent es reporte_deuda_* o reporte_stock_* y el mensaje es corto, preferir el mismo tipo de reporte salvo que pida otra cosa explicita.',
    '- Si lastEntityName existe y el mensaje pide telefono/mail sin nombre, asumir esa entidad.',
  );
  return lines;
}

function salesFollowupPrefix(lastIntent: string | null | undefined): string {
  if (lastIntent === 'reporte_ventas_productos') return 'productos mas vendidos';
  if (lastIntent === 'reporte_ventas_articulo') return 'ventas por articulo';
  if (lastIntent === 'reporte_ventas_clientes') return 'clientes que mas compraron';
  if (lastIntent === 'reporte_ganancias') return 'ganancia';
  if (lastIntent === 'reporte_medios_pago') return 'medios de pago';
  if (lastIntent === 'reporte_resumen') return 'resumen del mes';
  if (lastIntent === 'reporte_ventas_pos') return 'ventas pos';
  if (lastIntent === 'reporte_recibos') return 'recibos del mes';
  return 'ventas';
}

function salesFollowupMessageFromContext(
  normalized: string,
  lastIntent: string | null | undefined,
): string | null {
  const prefix = salesFollowupPrefix(lastIntent);
  const clean = normalized
    .replace(/^(?:y|ahora|tambien|despues|luego|por ultimo|finalmente)\s+/, '')
    .replace(/^(?:del?|de\s+la)\s+/, '')
    .replace(/[?.!]+$/g, '')
    .trim();
  if (/^hoy$/.test(clean)) return `${prefix} hoy`;
  if (/^ayer$/.test(clean)) return `${prefix} ayer`;
  if (/^(?:esta\s+)?semana$/.test(clean) || clean === 'semanal') return `${prefix} esta semana`;
  if (/^(?:este\s+)?mes$/.test(clean) || clean === 'mensual') return `${prefix} este mes`;
  if (/^mes\s+(?:anterior|pasado)$/.test(clean)) return `${prefix} mes anterior`;
  if (new RegExp(`^(?:${SALES_MONTH_PATTERN})(?:\\s+\\d{4})?$`).test(clean)) return `${prefix} ${clean}`;
  return null;
}

function reportContinueFromContext(ctx: WhatsAppIntentClassifierContext, normalized: string): string | null {
  if (!/^(?:segui|seguí|siguiente|mas|más|continuar)$/.test(normalized)) return null;
  if (!ctx.lastReportKey) return null;
  const nextPage = Math.max(2, (ctx.lastReportPage ?? 1) + 1);
  if (ctx.lastReportKey === 'stock_general') return `reporte stock general pagina ${nextPage}`;
  if (ctx.lastReportKey === 'stock_bajo') return `reporte stock bajo pagina ${nextPage}`;
  if (ctx.lastReportKey === 'deuda_clientes') return `reporte deuda clientes pagina ${nextPage}`;
  if (ctx.lastReportKey === 'deuda_proveedores') return `reporte deuda proveedores pagina ${nextPage}`;
  return null;
}

function contactFollowupFromContext(
  rawText: string,
  normalized: string,
  ctx: WhatsAppIntentClassifierContext,
): string | null {
  if (ctx.lastEntityType === 'proveedor' && ctx.lastEntityName) {
    if (/\b(mail|email|correo)\b/.test(normalized)) {
      return `mail de proveedor ${ctx.lastEntityName}`;
    }
    if (/\b(telefono|tel|celular|whatsapp|numero|nro)\b/.test(normalized)) {
      return `telefono de proveedor ${ctx.lastEntityName}`;
    }
    if (/\b(direccion|domicilio)\b/.test(normalized)) {
      return `direccion de proveedor ${ctx.lastEntityName}`;
    }
  }

  if (ctx.lastEntityType === 'cliente' && ctx.lastEntityName) {
    if (/\b(mail|email|correo)\b/.test(normalized)) {
      return `mail de cliente ${ctx.lastEntityName}`;
    }
    if (/\b(telefono|tel|celular|whatsapp|numero|nro)\b/.test(normalized)) {
      return `telefono de cliente ${ctx.lastEntityName}`;
    }
    if (/\b(direccion|domicilio)\b/.test(normalized)) {
      return `direccion de cliente ${ctx.lastEntityName}`;
    }
    if (/\b(?:la\s+)?primera\b/.test(normalized) && /\b(telefono|mail|correo|direccion)\b/.test(normalized)) {
      return rawText.replace(/\b(?:la\s+)?primera\b/i, ctx.lastEntityName);
    }
  }

  const firstOption = ctx.lastOptions?.[0]?.trim();
  if (
    firstOption &&
    ctx.lastIntent === 'reporte_deuda_proveedores' &&
    /\b(?:el\s+)?primero?\b/.test(normalized)
  ) {
    if (/\b(mail|email|correo)\b/.test(normalized)) return `mail de proveedor ${firstOption}`;
    if (/\b(direccion|domicilio)\b/.test(normalized)) return `direccion de proveedor ${firstOption}`;
    if (/\b(telefono|tel|celular|whatsapp|numero|nro)\b/.test(normalized)) {
      return `telefono de proveedor ${firstOption}`;
    }
  }

  return null;
}

/**
 * Expande mensajes cortos cuando la memoria del handler no reescribió pero hay slots recientes.
 * Retorna null si no aplica expansion.
 */
export function expandMessageWithIntentContext(
  rawText: string,
  ctx?: WhatsAppIntentClassifierContext,
): string | null {
  if (!ctx) return null;
  const normalized = normalizeText(rawText);
  if (!normalized) return null;

  const salesIntents = new Set([
    'reporte_ventas',
    'reporte_ventas_productos',
    'reporte_ventas_articulo',
    'reporte_ventas_clientes',
    'reporte_ganancias',
    'reporte_medios_pago',
    'reporte_resumen',
    'reporte_ventas_pos',
    'reporte_recibos',
    'reporte_comparativo_ventas',
  ]);
  if (
    (ctx.topic === 'ventas' || (ctx.lastIntent && salesIntents.has(ctx.lastIntent))) &&
    ctx.lastIntent
  ) {
    const sales = salesFollowupMessageFromContext(normalized, ctx.lastIntent);
    if (sales) return sales;
  }

  const continued = reportContinueFromContext(ctx, normalized);
  if (continued) return continued;

  const contact = contactFollowupFromContext(rawText, normalized, ctx);
  if (contact) return contact;

  if (/^(de nuevo|otra vez|lo mismo)$/.test(normalized) && ctx.lastIntent && ctx.lastEntityName) {
    if (ctx.lastIntent === 'cliente_deuda' || ctx.lastEntityType === 'cliente') {
      return `cuanto me debe el cliente ${ctx.lastEntityName}`;
    }
    if (ctx.lastIntent === 'proveedor_deuda' || ctx.lastEntityType === 'proveedor') {
      return `cuanto le debo a proveedor ${ctx.lastEntityName}`;
    }
  }

  if (/^(y\s+)?(su\s+)?saldo$/.test(normalized) && ctx.lastEntityName) {
    if (ctx.lastEntityType === 'cliente' || ctx.topic === 'deuda_clientes') {
      return `cuanto me debe el cliente ${ctx.lastEntityName}`;
    }
    if (ctx.lastEntityType === 'proveedor' || ctx.topic === 'deuda_proveedores') {
      return `cuanto le debo a proveedor ${ctx.lastEntityName}`;
    }
  }

  return null;
}
