import { llamarGeminiTexto } from '@/lib/ia/gemini';
import { intentarParseObjetoJsonModelo } from '@/lib/ia/json-respuesta-ia';
import { llamarOpenRouterTexto, parseOpenRouterModelsList, tieneOpenRouterTextoConfigurado } from '@/lib/ia/openrouter';
import { aplanarRepresentativosVentaPorOrden } from '@/lib/facturacion/ventas-representativas-por-orden';
import { factorLineasVsTotalComprobante } from '@/lib/facturacion/reconciliar-items-total';
import { sumarDiasYmd, ymdArgentina } from '@/lib/reportes/periodos';
import {
  buildWhatsAppCapabilitiesCatalog,
  type WhatsAppCapabilityChannel,
} from '@/lib/whatsapp/capabilities-catalog';
import {
  composeAmbiguousDebtScopeReply,
  composeExamplesReply,
  composeGenericTargetReply,
  composeGreetingReply,
  composeHelpReply,
  composeMissingTargetReply,
  composeReportScopeReply,
  composeUnknownCatalogReply,
} from '@/lib/whatsapp/response-composer';
import { classifyActionPhrase, composeActionHintReply } from '@/lib/whatsapp/action-parsers';
import { isHighConfidenceActionIntent, detectActionIntent } from '@/lib/whatsapp/action-intent';
import type { WhatsAppToolTrace } from '@/lib/whatsapp/agent-logs';
import { generateAndUploadWhatsAppReportPdf } from '@/lib/whatsapp/report-pdf';
import {
  resolveWhatsAppReportPeriod,
  runReporteCierreCajaTool,
  runReporteVentasArticuloTool,
  runReporteGastoProveedoresTool,
  runReporteLibroIvaTool,
  runReporteRecibosTool,
  resolveWhatsAppComparativoPeriods,
  runReporteComparativoVentasTool,
  runReporteResumenTool,
  runReporteVencimientosTool,
  runReporteVentasPosTool,
} from '@/lib/whatsapp/report-tools';
import { validateEntityTargetName, validateReportPage } from '@/lib/whatsapp/tool-contracts';
import {
  parseVentasPosReportFilters,
  resolveVentasPosReportFilters,
  type VentasPosResolvedFilters,
} from '@/lib/whatsapp/ventas-pos-report';
import { runClienteExtractoCcTool } from '@/lib/cuenta-corriente/whatsapp-extracto-cliente';
import type { WhatsAppConversationState } from '@/lib/whatsapp/conversation-memory';
import { resolveConversationMessage } from '@/lib/whatsapp/conversation-resolver';
import {
  conversationStateToIntentContext,
  formatIntentContextForLlmPrompt,
  type WhatsAppIntentClassifierContext,
} from '@/lib/whatsapp/intent-context';
import {
  formatIntentClassifierFewShotsForPrompt,
  shouldInvokeIntentLlmAfterRules,
} from '@/lib/whatsapp/intent-classifier-examples';
import {
  composeReplyWithLlmPolish,
  type ReplyPolishKind,
} from '@/lib/whatsapp/reply-llm-polish';

export type { WhatsAppIntentClassifierContext };

type AgentIntent =
  | 'proveedor_deuda'
  | 'cliente_deuda'
  | 'cliente_extracto_cc'
  | 'cliente_contacto'
  | 'proveedor_contacto'
  | 'stock_producto'
  | 'stock_mas_bajo'
  | 'reporte_stock_general'
  | 'reporte_deuda_clientes'
  | 'reporte_deuda_proveedores'
  | 'reporte_stock_bajo'
  | 'reporte_ventas'
  | 'reporte_ventas_productos'
  | 'reporte_ventas_articulo'
  | 'reporte_ventas_clientes'
  | 'reporte_ganancias'
  | 'reporte_medios_pago'
  | 'reporte_resumen'
  | 'reporte_comparativo_ventas'
  | 'reporte_vencimientos'
  | 'reporte_ventas_pos'
  | 'reporte_recibos'
  | 'reporte_libro_iva'
  | 'reporte_gasto_proveedores'
  | 'reporte_cierre_caja'
  | 'assistant_greeting'
  | 'assistant_help'
  | 'assistant_examples'
  | 'unsupported_action'
  | 'unknown';

type IntentDetection = {
  intent: AgentIntent;
  targetName: string | null;
  confidence: number;
  fallbackReason?: string;
  contactField?: EntityContactField;
};

type EntityContactField = 'telefono' | 'email' | 'direccion' | 'contacto';
type ClienteContactField = EntityContactField;
type SalesReportPeriodKey = 'hoy' | 'ayer' | 'semana' | 'mes' | 'mes_anterior';
type SalesReportPeriodRequest =
  | SalesReportPeriodKey
  | {
      kind: 'named_month';
      month: number;
      year: number;
      label: string;
    };

export type ReadOnlyAgentResult = {
  reply: string;
  intent: AgentIntent;
  confidence: number;
  tool: string | null;
  fallbackReason: string | null;
  resolvedEntity?: {
    type: 'proveedor' | 'cliente' | 'producto';
    name: string;
  } | null;
  reportContext?: {
    key: 'stock_general' | 'stock_bajo' | 'deuda_clientes' | 'deuda_proveedores';
    page: number;
    hasMore: boolean;
  } | null;
  toolTrace?: WhatsAppToolTrace | null;
  memoryOptions?: string[];
};

const ACTION_KEYWORDS = [
  'registrar pago',
  'registrar cobro',
  'cobrar',
  'ajustar stock',
  'transferir stock',
  'crear pedido',
  'emitir factura',
  'anular',
  'eliminar',
  'modificar',
  'actualizar',
];

const LLM_INTENT_TIMEOUT_MS = 8_000;
const TARGET_STOPWORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'al',
  'por',
  'para',
  'con',
  'que',
  'me',
  'mi',
  'mis',
  'tu',
  'tus',
  'su',
  'sus',
  'favor',
  'porfavor',
]);

const GENERIC_TOKENS_BY_INTENT: Record<
  | 'proveedor_deuda'
  | 'proveedor_contacto'
  | 'cliente_deuda'
  | 'cliente_extracto_cc'
  | 'cliente_contacto'
  | 'stock_producto',
  Set<string>
> = {
  proveedor_deuda: new Set(['proveedor', 'proveedores']),
  proveedor_contacto: new Set(['proveedor', 'proveedores', 'contacto', 'contactos']),
  cliente_deuda: new Set(['cliente', 'clientes']),
  cliente_extracto_cc: new Set(['cliente', 'clientes']),
  cliente_contacto: new Set(['cliente', 'clientes', 'contacto', 'contactos']),
  stock_producto: new Set([
    'producto',
    'productos',
    'articulo',
    'articulos',
    'item',
    'items',
    'mercaderia',
    'mercaderias',
    'stock',
    'inventario',
  ]),
};

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function sanitizeLike(text: string): string {
  return text.replace(/[%_,]/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
}

function formatStockQty(value: number): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '0';

  const isInteger = Math.abs(n - Math.trunc(n)) < 0.0005;
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: isInteger ? 0 : 3,
    maximumFractionDigits: 3,
  }).format(n);
}

const REPORT_PAGE_SIZE = 10;

function reportPageFromMessage(message: string): number {
  return validateReportPage(message);
}

function paginateRows<T>(rows: T[], page: number): { pageRows: T[]; hasMore: boolean; totalPages: number } {
  const safePage = Math.max(1, page);
  const totalPages = Math.max(1, Math.ceil(rows.length / REPORT_PAGE_SIZE));
  const boundedPage = Math.min(safePage, totalPages);
  const from = (boundedPage - 1) * REPORT_PAGE_SIZE;
  const to = from + REPORT_PAGE_SIZE;
  return {
    pageRows: rows.slice(from, to),
    hasMore: to < rows.length,
    totalPages,
  };
}

function extractQuoted(text: string): string | null {
  const match = text.match(/["']([^"']{2,})["']/);
  return match?.[1]?.trim() || null;
}

function stripTrailingContext(value: string): string {
  return value
    .replace(/[,;]\s*(?:que|porque|para|necesito|quiero)\b.*$/gi, '')
    .replace(/\s+(?:que\s+)?(?:necesito|quiero)\b.*$/gi, '')
    .replace(/\s+(?:porque|ya\s+que)\b.*$/gi, '')
    .replace(/\s+para\s+(?:llamar|contactar|avisar|escribir)\w*\b.*$/gi, '')
    .replace(/\b(hoy|ahora|por favor|gracias)\b/gi, '')
    .replace(/[?.!,:;]+$/g, '')
    .trim();
}

function tokenizeTarget(value: string): string[] {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function isGenericTargetName(
  intent: AgentIntent,
  targetName: string | null,
): targetName is string {
  if (!targetName) return true;
  if (!(intent in GENERIC_TOKENS_BY_INTENT)) return false;

  const tokens = tokenizeTarget(targetName);
  if (tokens.length === 0) return true;

  const relevant = tokens.filter((token) => !TARGET_STOPWORDS.has(token));
  if (relevant.length === 0) return true;

  const genericSet =
    GENERIC_TOKENS_BY_INTENT[
      intent as
        | 'proveedor_deuda'
        | 'cliente_deuda'
        | 'cliente_extracto_cc'
        | 'cliente_contacto'
        | 'proveedor_contacto'
        | 'stock_producto'
    ];
  return relevant.every((token) => genericSet.has(token));
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function clampConfidence(value: unknown, fallback = 0.4): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function toolExecutionError(params: {
  error: unknown;
  trace: WhatsAppToolTrace;
}): Error & { toolTrace?: WhatsAppToolTrace } {
  const original = params.error instanceof Error ? params.error : new Error(String(params.error));
  return Object.assign(original, { toolTrace: params.trace });
}

async function runTracedTool<T>(
  name: string,
  args: Record<string, unknown>,
  execute: () => Promise<T>,
): Promise<{ value: T; trace: WhatsAppToolTrace }> {
  const startedAt = Date.now();
  try {
    const value = await execute();
    return {
      value,
      trace: {
        name,
        args,
        status: 'success',
        durationMs: Date.now() - startedAt,
        result: value,
      },
    };
  } catch (error) {
    throw toolExecutionError({
      error,
      trace: {
        name,
        args,
        status: 'error',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function sanitizeTargetName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = stripTrailingContext(value);
  return clean.length > 0 ? clean : null;
}

function normalizeContactField(value: unknown): ClienteContactField | undefined {
  const v = normalizeText(String(value ?? ''));
  if (!v) return undefined;
  if (v === 'telefono' || v === 'phone' || v === 'celular' || v === 'numero' || v === 'whatsapp')
    return 'telefono';
  if (v === 'mail' || v === 'email' || v === 'e_mail' || v === 'correo') return 'email';
  if (v === 'direccion' || v === 'domicilio' || v === 'address') return 'direccion';
  if (v === 'contacto' || v === 'datos_contacto' || v === 'contact') return 'contacto';
  return undefined;
}

function normalizeIntent(value: unknown): AgentIntent {
  const v = normalizeText(String(value ?? 'unknown'));
  if (!v) return 'unknown';
  if (v === 'proveedor_deuda' || v === 'supplier_debt') return 'proveedor_deuda';
  if (v === 'cliente_deuda' || v === 'customer_debt') return 'cliente_deuda';
  if (
    v === 'cliente_extracto_cc' ||
    v === 'reporte_extracto_cliente' ||
    v === 'customer_cc_statement' ||
    v === 'cc_extract'
  )
    return 'cliente_extracto_cc';
  if (v === 'cliente_contacto' || v === 'customer_contact' || v === 'client_contact') return 'cliente_contacto';
  if (v === 'proveedor_contacto' || v === 'supplier_contact') return 'proveedor_contacto';
  if (v === 'stock_producto' || v === 'product_stock') return 'stock_producto';
  if (v === 'stock_mas_bajo' || v === 'lowest_stock_product') return 'stock_mas_bajo';
  if (v === 'reporte_stock_general' || v === 'report_stock_general' || v === 'inventory_summary')
    return 'reporte_stock_general';
  if (v === 'reporte_deuda_clientes' || v === 'report_client_debt') return 'reporte_deuda_clientes';
  if (v === 'reporte_deuda_proveedores' || v === 'report_supplier_debt')
    return 'reporte_deuda_proveedores';
  if (v === 'reporte_stock_bajo' || v === 'report_low_stock') return 'reporte_stock_bajo';
  if (v === 'reporte_ventas' || v === 'report_sales' || v === 'sales_report') return 'reporte_ventas';
  if (v === 'reporte_ventas_productos' || v === 'report_sales_products' || v === 'top_selling_products')
    return 'reporte_ventas_productos';
  if (v === 'reporte_ventas_articulo' || v === 'report_sales_by_sku' || v === 'sku_sales_report')
    return 'reporte_ventas_articulo';
  if (v === 'reporte_ventas_clientes' || v === 'report_sales_customers' || v === 'top_customers')
    return 'reporte_ventas_clientes';
  if (v === 'reporte_ganancias' || v === 'report_profit' || v === 'profit_report') return 'reporte_ganancias';
  if (v === 'reporte_medios_pago' || v === 'report_payment_methods' || v === 'payment_methods_report')
    return 'reporte_medios_pago';
  if (v === 'reporte_resumen' || v === 'report_summary' || v === 'business_summary') return 'reporte_resumen';
  if (
    v === 'reporte_comparativo_ventas' ||
    v === 'sales_comparison' ||
    v === 'comparative_sales'
  ) {
    return 'reporte_comparativo_ventas';
  }
  if (v === 'reporte_vencimientos' || v === 'report_expiry' || v === 'expiry_report') return 'reporte_vencimientos';
  if (v === 'reporte_ventas_pos' || v === 'report_pos_sales' || v === 'pos_tickets_report')
    return 'reporte_ventas_pos';
  if (v === 'reporte_recibos' || v === 'report_receipts') return 'reporte_recibos';
  if (v === 'reporte_libro_iva' || v === 'report_iva_book' || v === 'iva_book') return 'reporte_libro_iva';
  if (v === 'reporte_gasto_proveedores' || v === 'report_supplier_spend') return 'reporte_gasto_proveedores';
  if (v === 'reporte_cierre_caja' || v === 'report_cash_close') return 'reporte_cierre_caja';
  if (v === 'unsupported_action' || v === 'action') return 'unsupported_action';
  return 'unknown';
}

function normalizeFallbackReason(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = normalizeText(value).replace(/[^a-z0-9_]/g, '_');
  return clean.length > 0 ? clean : undefined;
}

function shouldUseLlmIntentClassifier(): boolean {
  const flag = normalizeText(process.env.WHATSAPP_AGENT_INTENT_LLM ?? 'true');
  if (flag === '0' || flag === 'false' || flag === 'no' || flag === 'off') return false;
  return true;
}

function llmProviderPreference(): 'gemini' | 'openrouter' | 'auto' | 'disabled' {
  const raw = normalizeText(process.env.WHATSAPP_AGENT_INTENT_LLM_PROVIDER ?? 'auto');
  if (raw === 'gemini' || raw === 'openrouter' || raw === 'disabled') return raw;
  return 'auto';
}

function resolveWhatsAppIntentModels(): string[] | null {
  const single = process.env.WHATSAPP_AGENT_INTENT_LLM_MODEL?.trim();
  if (single) return [single];
  const fromEnv = parseOpenRouterModelsList();
  return fromEnv.length > 0 ? fromEnv : null;
}

async function callOpenRouterTextClassifier(prompt: string): Promise<string | null> {
  return llamarOpenRouterTexto({
    messages: [
      {
        role: 'system',
        content:
          'Extraé intención para SmartStock WhatsApp. Devolvé solo JSON con intent, targetName, confidence, fallbackReason.',
      },
      { role: 'user', content: prompt },
    ],
    modelsOverride: resolveWhatsAppIntentModels(),
    maxTokens: 250,
    timeoutMs: LLM_INTENT_TIMEOUT_MS,
    jsonObject: true,
  });
}

async function classifyIntentWithLlm(
  rawText: string,
  intentContext?: WhatsAppIntentClassifierContext,
): Promise<IntentDetection | null> {
  if (!shouldUseLlmIntentClassifier()) return null;
  if (rawText.trim().length < 2) return null;

  const contextLines = intentContext ? formatIntentContextForLlmPrompt(intentContext) : [];
  const fewShotLines = formatIntentClassifierFewShotsForPrompt();

  const prompt = [
    'Clasificá este mensaje para un agente read-only de SmartStock.',
    ...contextLines,
    ...fewShotLines,
    'Intents permitidos:',
    '- proveedor_deuda',
    '- cliente_deuda',
    '- cliente_extracto_cc',
    '- cliente_contacto',
    '- proveedor_contacto',
    '- stock_producto',
    '- stock_mas_bajo',
    '- reporte_stock_general',
    '- reporte_deuda_clientes',
    '- reporte_deuda_proveedores',
    '- reporte_stock_bajo',
    '- reporte_ventas',
    '- reporte_ventas_productos',
    '- reporte_ventas_articulo',
    '- reporte_ventas_clientes',
    '- reporte_ganancias',
    '- reporte_medios_pago',
    '- reporte_resumen',
    '- reporte_comparativo_ventas',
    '- reporte_vencimientos',
    '- reporte_ventas_pos',
    '- reporte_recibos',
    '- reporte_libro_iva',
    '- reporte_gasto_proveedores',
    '- reporte_cierre_caja',
    '- unsupported_action',
    '- unknown',
    'Reglas:',
    '- Si pide telefono, numero, celular o WhatsApp de un cliente, usa intent=cliente_contacto y contactField=telefono.',
    '- Si pide mail/email/correo de un cliente, usa intent=cliente_contacto y contactField=email.',
    '- Si pide direccion/domicilio de un cliente, usa intent=cliente_contacto y contactField=direccion.',
    '- Si pide datos de contacto de un cliente sin campo puntual, usa intent=cliente_contacto y contactField=contacto.',
    '- Si pide telefono, mail o direccion de un proveedor, usa intent=proveedor_contacto y contactField acorde.',
    '- Si pide datos de contacto de un proveedor sin campo puntual, usa intent=proveedor_contacto y contactField=contacto.',
    '- Si falta nombre de entidad en proveedor/cliente/producto, dejá targetName=null y fallbackReason=missing_target_name.',
    '- Si usa target genérico (ej: "stock de producto", "deuda de cliente"), usá fallbackReason=generic_target_name.',
    '- Si piden stock general/inventario completo sin producto puntual, usá intent=reporte_stock_general.',
    '- Si piden deuda de proveedores en general (plural), usá intent=reporte_deuda_proveedores.',
    '- Si pide deuda sin aclarar cliente/proveedor, fallbackReason=ambiguous_debt_scope.',
    '- Si pide ventas, cuanto vendio, facturacion o facturado de hoy/ayer/semana/mes o de un mes nombrado (ej: mayo), usa intent=reporte_ventas.',
    '- Si pide productos/articulos mas vendidos, ranking de productos vendidos o que producto vendio mas, usa intent=reporte_ventas_productos.',
    '- Si pide ventas por articulo/SKU, top sku o ranking con margen/rentabilidad por producto, usa intent=reporte_ventas_articulo.',
    '- Si pide clientes que mas compraron, mejores clientes o ventas por cliente, usa intent=reporte_ventas_clientes.',
    '- Si pide ganancia, margen, rentabilidad o utilidad, usa intent=reporte_ganancias.',
    '- Si pide medios/metodos/formas de pago, usa intent=reporte_medios_pago.',
    '- Si pide resumen general, KPI del negocio o ingresos del periodo sin detalle SKU, usa intent=reporte_resumen.',
    '- Si pide comparar ventas/ingresos vs mes anterior o "como venimos vs mes pasado", usa intent=reporte_comparativo_ventas.',
    '- Si pide vencimientos, productos por vencer o alertas de vencimiento, usa intent=reporte_vencimientos.',
    '- Si pide ventas POS, tickets de caja o ventas por ticket, usa intent=reporte_ventas_pos (opcional: filtrar por caja u operador/cajero).',
    '- Si pide recibos o cobranzas con recibo, usa intent=reporte_recibos.',
    '- Si pide cierre de caja, arqueo, cierre Z, efectivo en caja o estado del turno (sin cerrar desde el chat), usa intent=reporte_cierre_caja.',
    '- Si pide extracto, movimientos o historial de cuenta corriente de un cliente puntual, usa intent=cliente_extracto_cc (no confundir con saldo puntual cliente_deuda).',
    '- Si pide libro IVA o resumen de IVA fiscal, usa intent=reporte_libro_iva.',
    '- Si pide gasto por proveedor o ranking de proveedores por costo, usa intent=reporte_gasto_proveedores.',
    '- Si está fuera de catálogo, intent=unknown y fallbackReason=not_in_catalog.',
    '- Respondé estrictamente JSON: {"intent":"...","targetName":string|null,"confidence":0..1,"fallbackReason":string|null}.',
    '- Si el intent es cliente_contacto o proveedor_contacto, responde tambien contactField como telefono, email, direccion o contacto.',
    `Mensaje: """${rawText.trim()}"""`,
  ].join('\n');

  const provider = llmProviderPreference();
  let rawResponse: string | null = null;

  if (provider === 'disabled') return null;

  const tryOpenRouter = () => callOpenRouterTextClassifier(prompt);
  const tryGemini = async (): Promise<string | null> => {
    try {
      return await llamarGeminiTexto(prompt);
    } catch {
      return null;
    }
  };

  if (provider === 'openrouter') {
    rawResponse = await tryOpenRouter();
  } else if (provider === 'gemini') {
    rawResponse = await tryGemini();
  } else if (tieneOpenRouterTextoConfigurado()) {
    rawResponse = await tryOpenRouter();
    if (!rawResponse) rawResponse = await tryGemini();
  } else {
    rawResponse = await tryGemini();
    if (!rawResponse) rawResponse = await tryOpenRouter();
  }
  if (!rawResponse) return null;

  const parsed = intentarParseObjetoJsonModelo(rawResponse);
  if (!parsed || typeof parsed.data !== 'object' || parsed.data == null) return null;

  const obj = parsed.data as Record<string, unknown>;
  const intent = normalizeIntent(obj.intent);
  const targetName = sanitizeTargetName(obj.targetName);
  const confidence = clampConfidence(obj.confidence, 0.65);
  const fallbackReason = normalizeFallbackReason(obj.fallbackReason);
  const contactField = normalizeContactField(obj.contactField);

  return {
    intent,
    targetName,
    confidence,
    fallbackReason,
    contactField,
  };
}

function detectClienteContactField(text: string): ClienteContactField | null {
  if (/\b(mail|email|e-mail|correo)\b/.test(text)) return 'email';
  if (/\b(direccion|domicilio)\b/.test(text)) return 'direccion';
  if (/\b(telefono|tel|celular|whatsapp)\b/.test(text)) return 'telefono';
  if (/\b(numero|nro)\b/.test(text) && (/\bcliente\b/.test(text) || /\b(numero|nro)\s+de\s+telefono\b/.test(text)))
    return 'telefono';
  if (/\b(?:el\s+)?(?:numero|nro)\s+de\s+(?!factura|pedido|comprobante|ticket)\S+/.test(text))
    return 'telefono';
  if (/\b(datos?\s+de\s+contacto|contacto)\b/.test(text)) return 'contacto';
  return null;
}

function cleanClienteContactTarget(value: string): string | null {
  const clean = stripTrailingContext(value)
    .replace(/^(?:del?\s+)?cliente\s+/i, '')
    .replace(/^cliente\s+/i, '')
    .trim();
  return clean || null;
}

function cleanProveedorContactTarget(value: string): string | null {
  const clean = stripTrailingContext(value)
    .replace(/^(?:del?\s+)?proveedor\s+/i, '')
    .replace(/^proveedor\s+/i, '')
    .trim();
  return clean || null;
}

function extractProveedorContactTarget(text: string): string | null {
  const patterns = [
    /(?:datos?\s+de\s+contacto|contacto)\s+(?:del?\s+proveedor\s+|de\s+proveedor\s+)(.+)/,
    /(?:numero\s+de\s+telefono|nro\s+de\s+telefono|telefono|tel|celular|whatsapp|numero|nro)\s+(?:del?\s+proveedor\s+|de\s+proveedor\s+|proveedor\s+)(.+)/,
    /(?:mail|email|e-mail|correo)\s+(?:del?\s+proveedor\s+|de\s+proveedor\s+|proveedor\s+)(.+)/,
    /(?:direccion|domicilio)\s+(?:del?\s+proveedor\s+|de\s+proveedor\s+|proveedor\s+)(.+)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const target = cleanProveedorContactTarget(match?.[1] ?? '');
    if (target) return target;
  }
  return null;
}

function extractClienteContactTarget(text: string): string | null {
  const patterns = [
    /(?:datos?\s+de\s+contacto|contacto)\s+(?:del?\s+cliente\s+|de\s+cliente\s+|del?\s+|de\s+)?(.+)/,
    /(?:numero\s+de\s+telefono|nro\s+de\s+telefono|telefono|tel|celular|whatsapp|numero|nro)\s+(?:del?\s+cliente\s+|de\s+cliente\s+|del?\s+|de\s+)?(.+)/,
    /(?:mail|email|e-mail|correo)\s+(?:del?\s+cliente\s+|de\s+cliente\s+|del?\s+|de\s+)?(.+)/,
    /(?:direccion|domicilio)\s+(?:del?\s+cliente\s+|de\s+cliente\s+|del?\s+|de\s+)?(.+)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const target = cleanClienteContactTarget(match?.[1] ?? '');
    if (target) return target;
  }
  return null;
}

const SALES_MONTHS = [
  { names: ['enero', 'ene'], month: 1, label: 'Enero' },
  { names: ['febrero', 'feb'], month: 2, label: 'Febrero' },
  { names: ['marzo', 'mar'], month: 3, label: 'Marzo' },
  { names: ['abril', 'abr'], month: 4, label: 'Abril' },
  { names: ['mayo', 'may'], month: 5, label: 'Mayo' },
  { names: ['junio', 'jun'], month: 6, label: 'Junio' },
  { names: ['julio', 'jul'], month: 7, label: 'Julio' },
  { names: ['agosto', 'ago'], month: 8, label: 'Agosto' },
  { names: ['septiembre', 'setiembre', 'sep', 'set'], month: 9, label: 'Septiembre' },
  { names: ['octubre', 'oct'], month: 10, label: 'Octubre' },
  { names: ['noviembre', 'nov'], month: 11, label: 'Noviembre' },
  { names: ['diciembre', 'dic'], month: 12, label: 'Diciembre' },
] as const;

const SALES_MONTH_PATTERN = SALES_MONTHS.flatMap((item) => item.names).join('|');

function stripPeriodSuffixFromTarget(value: string): string {
  let out = value.trim();
  out = out.replace(
    new RegExp(`\\s+(?:del?|en|de)?\\s*(?:mes\\s+)?(?:${SALES_MONTH_PATTERN})(?:\\s+\\d{4})?\\s*$`, 'i'),
    '',
  );
  out = out.replace(/\s+(?:hoy|ayer|esta\s+semana|mes\s+anterior|mes\s+pasado)\s*$/i, '');
  return out.trim();
}

function detectSalesNamedMonth(text: string): Extract<SalesReportPeriodRequest, { kind: 'named_month' }> | null {
  const match = text.match(new RegExp(`\\b(${SALES_MONTH_PATTERN})\\b(?:\\s+(\\d{4}))?`));
  if (!match?.[1]) return null;

  const monthConfig = SALES_MONTHS.find((item) => item.names.some((name) => name === match[1]));
  if (!monthConfig) return null;

  const hoy = ymdArgentina();
  const currentYear = Number(hoy.slice(0, 4));
  const currentMonth = Number(hoy.slice(5, 7));
  const explicitYear = match[2] ? Number(match[2]) : null;
  const year = explicitYear ?? (monthConfig.month > currentMonth ? currentYear - 1 : currentYear);

  return {
    kind: 'named_month',
    month: monthConfig.month,
    year,
    label: `${monthConfig.label} ${year}`,
  };
}

function detectSalesReportPeriodRequest(text: string): SalesReportPeriodRequest {
  const namedMonth = detectSalesNamedMonth(text);
  if (namedMonth) return namedMonth;
  if (/\bayer\b/.test(text)) return 'ayer';
  if (/\b(semana|semanal)\b/.test(text)) return 'semana';
  if (/\bmes\s+(?:anterior|pasado)\b/.test(text)) return 'mes_anterior';
  if (/\b(mes|mensual)\b/.test(text)) return 'mes';
  if (/\bvendimos\b/.test(text) && !/\b(hoy|ayer|semana|semanal)\b/.test(text)) return 'mes';
  return 'hoy';
}

function detectSalesProductsReportPeriodRequest(text: string): SalesReportPeriodRequest {
  const namedMonth = detectSalesNamedMonth(text);
  if (namedMonth) return namedMonth;
  if (/\bhoy\b/.test(text)) return 'hoy';
  if (/\bayer\b/.test(text)) return 'ayer';
  if (/\b(semana|semanal)\b/.test(text)) return 'semana';
  if (/\bmes\s+(?:anterior|pasado)\b/.test(text)) return 'mes_anterior';
  return 'mes';
}

function isVentasArticuloReportRequest(text: string): boolean {
  if (/\b(ventas?\s+por\s+articulo|ventas?\s+por\s+sku|ranking\s+sku|top\s+sku)\b/.test(text)) return true;
  if (/\b(articulos?\s+vendidos?\s+con\s+margen|margen\s+por\s+articulo|rentabilidad\s+por\s+sku)\b/.test(text)) return true;
  if (/\breporte\s+ventas?\s+articulo\b/.test(text)) return true;
  if (/\b(sku|articulos?)\b/.test(text) && /\b(margen|rentabilidad|costo)\b/.test(text) && /\b(vendidos?|ventas?)\b/.test(text)) {
    return true;
  }
  return false;
}

function isSalesProductsReportRequest(text: string): boolean {
  const productScope = /\b(productos?|articulos?|items?|mercaderia|sku)\b/.test(text);
  const salesScope = /\b(vendidos?|vendio|vendi|vendimos|ventas?)\b/.test(text);
  const rankingScope = /\b(mas|top|ranking|rank|mejores|principales|mayor)\b/.test(text);
  if (productScope && salesScope && rankingScope) return true;
  if (/\b(?:que|cual|cuales)\s+productos?\s+(?:se\s+)?vend(?:i|io|ieron|imos)\s+mas\b/.test(text)) return true;
  if (/\bproductos?\s+mas\s+vendidos?\b/.test(text)) return true;
  if (/\barticulos?\s+mas\s+vendidos?\b/.test(text)) return true;
  if (/\branking\s+(?:de\s+)?(?:ventas\s+por\s+)?(?:productos?|articulos?)\b/.test(text)) return true;
  return false;
}

function isSalesCustomersReportRequest(text: string): boolean {
  if (/\b(clientes?)\b/.test(text) && /\b(mas|top|ranking|mejores|principales|mayor)\b/.test(text) && /\b(compraron|compras|ventas?|facturacion|facturado)\b/.test(text)) return true;
  if (/\bventas?\s+por\s+clientes?\b/.test(text)) return true;
  if (/\bclientes?\s+que\s+mas\s+(?:compraron|compran|facturaron)\b/.test(text)) return true;
  if (/\bmejores\s+clientes?\b/.test(text)) return true;
  return false;
}

function isProfitReportRequest(text: string): boolean {
  return /\b(ganancia|ganancias|margen|rentabilidad|utilidad|utilidades)\b/.test(text);
}

function isPaymentMethodsReportRequest(text: string): boolean {
  if (/\b(medios?|metodos?|formas?)\s+de\s+pago\b/.test(text)) return true;
  if (/\bventas?\s+por\s+(?:medio|metodo|forma)\s+de\s+pago\b/.test(text)) return true;
  if (/\b(cuanto|total)\s+(?:cobre|cobramos|vendimos|entro)\s+por\s+(?:efectivo|tarjeta|transferencia)\b/.test(text)) return true;
  return false;
}

function isComparativoVentasRequest(text: string): boolean {
  if (/\b(vs|versus|contra|frente\s+a)\b/.test(text) && /\b(mes\s+(?:anterior|pasado)|periodo\s+anterior)\b/.test(text)) {
    return true;
  }
  if (/\bcomo\s+(?:venimos|andamos)\b/.test(text) && /\b(vs|mes\s+(?:anterior|pasado))\b/.test(text)) {
    return true;
  }
  if (/\bcomparativ[oa]\b/.test(text) && /\b(ventas?|ingresos?|facturacion)\b/.test(text)) return true;
  if (/\bventas?\s+vs\s+mes\b/.test(text)) return true;
  if (/\bvariacion\s+(?:de\s+)?ventas\b/.test(text)) return true;
  return false;
}

function isResumenReportRequest(text: string): boolean {
  if (isComparativoVentasRequest(text)) return false;
  if (/\b(libro\s+iva|iva\s+fiscal)\b/.test(text)) return false;
  if (/\b(deuda)\b/.test(text) && !/\b(ingresos?|ventas?|facturacion)\b/.test(text)) return false;
  if (/\b(resumen\s+general|resumen\s+del\s+negocio|resumen\s+comercial|kpi|como\s+venimos)\b/.test(text)) return true;
  if (/\b(armame|pasame|quiero|necesito)\s+(?:un\s+)?resumen\b/.test(text)) return true;
  if (/\b(resumen|informe)\b/.test(text) && /\b(negocio|comercial|ingresos?|facturacion|del\s+mes)\b/.test(text)) return true;
  if (/^resumen(?:\s+(?:de\s+)?(?:hoy|ayer|mes|semana))?$/.test(text)) return true;
  return false;
}

function isVencimientosReportRequest(text: string): boolean {
  return (
    /\b(vencimientos?|vencen|por\s+vencer|proximos?\s+a\s+vencer|alertas?\s+de\s+vencimiento)\b/.test(text) &&
    !/\bcliente\b/.test(text)
  );
}

function isPosSalesReportRequest(text: string): boolean {
  if (/\b(pos|tickets?\s+pos|ventas?\s+pos|caja\s+registradora)\b/.test(text)) return true;
  if (/\bventas?\s+(?:por\s+)?tickets?\b/.test(text) && !/\bproducto\b/.test(text)) return true;
  if (
    /\b(?:ventas?|tickets?)\b/.test(text) &&
    /\b(?:operador|cajero|vendedor)\b/.test(text) &&
    !/\b(cierre|arqueo|turno)\b/.test(text)
  ) {
    return true;
  }
  if (/\b(?:ventas?|tickets?)\s+(?:pos\s+)?(?:de\s+la\s+)?caja\b/.test(text) && !/\b(cierre|arqueo)\b/.test(text)) {
    return true;
  }
  return false;
}

function isRecibosReportRequest(text: string): boolean {
  return /\b(recibos?|cobranzas?\s+con\s+recibo)\b/.test(text) && !/\bregistrar\s+cobro\b/.test(text);
}

function isLibroIvaReportRequest(text: string): boolean {
  return /\b(libro\s+iva|iva\s+ventas|resumen\s+de\s+iva|iva\s+fiscal)\b/.test(text);
}

function isGastoProveedoresReportRequest(text: string): boolean {
  return (
    /\b(gasto\s+por\s+proveedor|gastos?\s+proveedores?|ranking\s+proveedores?|cuanto\s+gaste\s+en\s+proveedores?)\b/.test(
      text,
    ) && !/\b(deuda|debo|le\s+debo)\b/.test(text)
  );
}

function isCierreCajaReportRequest(text: string): boolean {
  if (/\b(cierre\s+z|cierre\s+de\s+caja|cierre\s+caja)\b/.test(text)) return true;
  if (/\barqueo\b/.test(text) && /\b(caja|efectivo|gaveta|turno|hoy|ayer)\b/.test(text)) return true;
  if (/^arqueo(?:\s+(?:de\s+)?caja)?$/.test(text.trim())) return true;
  if (/\b(estado\s+del\s+turno|turno\s+de\s+caja|turno\s+abierto)\b/.test(text)) return true;
  if (/\b(efectivo\s+sistema|efectivo\s+en\s+caja)\b/.test(text)) return true;
  if (/\bcomo\s+va\s+la\s+caja\b/.test(text)) return true;
  return false;
}

function isSalesReportRequest(text: string): boolean {
  const hasNamedMonth = Boolean(detectSalesNamedMonth(text));
  if (/^(ventas|reporte\s+(?:de\s+)?ventas|resumen\s+(?:de\s+)?ventas)$/.test(text)) return true;
  if (/\b(?:cuanto\s+)?vend(?:i|imos|io|ieron)\b/.test(text)) return true;
  if (/\bventas?\b/.test(text) && /\b(tuvimos|hubo|hicimos|realizamos)\b/.test(text)) return true;
  if (/\bventas\b/.test(text) && (hasNamedMonth || /\b(hoy|ayer|semana|semanal|mes|mensual|periodo|dia)\b/.test(text))) return true;
  if (
    /\b(reporte|resumen|informe|total|monto)\b/.test(text) &&
    /\b(ventas?|facturado|facturacion|recaudacion|ingresos?)\b/.test(text)
  ) {
    return true;
  }
  if (/\b(facturado|facturacion|recaudacion|ingresos?)\b/.test(text) && (hasNamedMonth || /\b(hoy|ayer|semana|mes)\b/.test(text))) {
    return true;
  }
  return false;
}

function isLowStockReportRequest(text: string): boolean {
  if (
    /^(?:stock bajo|bajo stock|stock critico|stock en rojo|faltantes?|productos faltantes|reposicion|reposicion de stock)$/.test(
      text,
    )
  ) {
    return true;
  }
  if (/\bstock\s+criticos?\b/.test(text)) return true;
  if (/\bcriticos?\s+(?:de|por)\s+stock\b/.test(text)) return true;
  if (
    (text.includes('reporte') || text.includes('resumen') || text.includes('informe')) &&
    (text.includes('stock bajo') ||
      text.includes('stock critico') ||
      text.includes('faltante') ||
      text.includes('reposicion'))
  ) {
    return true;
  }
  return false;
}

function detectAssistantMetaIntent(text: string): IntentDetection | null {
  if (/^(hola|hey|buenas|buen\s*dia|buenos\s*dias|buenas\s*tardes|buenas\s*noches)\b/.test(text)) {
    return { intent: 'assistant_greeting', targetName: null, confidence: 0.94 };
  }
  if (
    /\b(ayuda|help|menu|comandos|capacidades|que\s+podes?\s+hacer|que\s+puedo\s+hacer|que\s+sabes?\s+hacer)\b/.test(
      text,
    )
  ) {
    return { intent: 'assistant_help', targetName: null, confidence: 0.94 };
  }
  if (/\b(ejemplos|que\s+puedo\s+preguntar|que\s+puedo\s+consultar|dame\s+ejemplos)\b/.test(text)) {
    return { intent: 'assistant_examples', targetName: null, confidence: 0.92 };
  }
  return null;
}

function detectIntentByRules(rawText: string): IntentDetection {
  const text = normalizeText(rawText);
  if (!text) return { intent: 'unknown', targetName: null, confidence: 0.3, fallbackReason: 'empty' };

  const assistantMeta = detectAssistantMetaIntent(text);
  if (assistantMeta) return assistantMeta;

  if (ACTION_KEYWORDS.some((k) => text.includes(k))) {
    const actionKind = classifyActionPhrase(rawText);
    return {
      intent: 'unsupported_action',
      targetName: null,
      confidence: 0.95,
      fallbackReason: actionKind ? `action_hint_${actionKind}` : 'outside_read_only_catalog',
    };
  }

  const quoted = extractQuoted(rawText);

  const contactField = detectClienteContactField(text);
  if (contactField) {
    const quotedTarget = quoted ? stripTrailingContext(quoted) : '';
    const proveedorTarget = cleanProveedorContactTarget(
      quotedTarget || extractProveedorContactTarget(text) || '',
    );
    const clienteTarget = cleanClienteContactTarget(
      quotedTarget || extractClienteContactTarget(text) || '',
    );
    const hasProveedorKw = /\bproveedor(?:es)?\b/.test(text);
    const hasClienteKw = /\bcliente(?:s)?\b/.test(text);

    if (hasProveedorKw || (proveedorTarget && !hasClienteKw)) {
      return {
        intent: 'proveedor_contacto',
        targetName: proveedorTarget || null,
        confidence: 0.9,
        fallbackReason: proveedorTarget ? undefined : 'missing_target_name',
        contactField,
      };
    }

    return {
      intent: 'cliente_contacto',
      targetName: clienteTarget || null,
      confidence: 0.9,
      fallbackReason: clienteTarget ? undefined : 'missing_target_name',
      contactField,
    };
  }

  const deudaProveedorMatch =
    text.match(/(?:cuanto|cuanto)\s+le\s+debo\s+a\s+(.+)/) ||
    text.match(/deuda\s+del?\s+proveedor\s+(.+)/) ||
    text.match(/debo\s+al?\s+proveedor\s+(.+)/);
  if (deudaProveedorMatch) {
    const target = stripTrailingContext(quoted ?? deudaProveedorMatch[1] ?? '')
      .replace(/^(?:del?\s+)?proveedor\s+/i, '')
      .trim();
    return { intent: 'proveedor_deuda', targetName: target || null, confidence: 0.9 };
  }

  const extractoCcMatch =
    text.match(/\bextracto\s+(?:de\s+)?(?:la\s+)?cuenta\s+corriente\s+(?:del?\s+)?(?:cliente\s+)?(.+)/) ||
    text.match(/\bmovimientos?\s+(?:de\s+)?(?:la\s+)?cuenta\s+corriente\s+(?:del?\s+)?(?:cliente\s+)?(.+)/) ||
    text.match(/\bhistorial\s+(?:de\s+)?(?:la\s+)?(?:cc|cuenta\s+corriente)\s+(?:del?\s+)?(?:cliente\s+)?(.+)/) ||
    text.match(/\bextracto\s+cc\s+(?:del?\s+)?(?:cliente\s+)?(.+)/) ||
    text.match(/\bcuenta\s+corriente\s+de\s+(?!cliente\b)(.+)/);
  if (extractoCcMatch) {
    const target = stripPeriodSuffixFromTarget(
      stripTrailingContext(quoted ?? extractoCcMatch[1] ?? ''),
    );
    return {
      intent: 'cliente_extracto_cc',
      targetName: target || null,
      confidence: 0.9,
      fallbackReason: target ? undefined : 'missing_target_name',
    };
  }

  const deudaClienteMatch =
    text.match(/(?:cuanto|cuanto)\s+me\s+debe\s+(?:el\s+cliente\s+)?(.+)/) ||
    text.match(/deuda\s+del?\s+cliente\s+(.+)/) ||
    text.match(/cuenta\s+corriente\s+del?\s+cliente\s+(.+)/);
  if (deudaClienteMatch) {
    const target = stripTrailingContext(quoted ?? deudaClienteMatch[1] ?? '')
      .replace(/^(?:del?\s+)?cliente\s+/i, '')
      .trim();
    return { intent: 'cliente_deuda', targetName: target || null, confidence: 0.9 };
  }

  const deudaSinScopeMatch =
    text.match(/(?:pasame|decime|dime)?\s*(?:la\s+)?deuda\s+de\s+(.+)/) ||
    text.match(/saldo\s+de\s+(.+)/);
  if (deudaSinScopeMatch && !text.includes('cliente') && !text.includes('proveedor')) {
    const target = stripTrailingContext(quoted ?? deudaSinScopeMatch[1] ?? '');
    return {
      intent: 'unknown',
      targetName: target || null,
      confidence: 0.8,
      fallbackReason: 'ambiguous_debt_scope',
    };
  }

  if ((text.includes('deuda') || text.includes('debo')) && text.includes('proveedores')) {
    return { intent: 'reporte_deuda_proveedores', targetName: null, confidence: 0.86 };
  }

  if (
    (text.includes('reporte') || text.includes('resumen') || text.includes('informe')) &&
    text.includes('deuda') &&
    (text.includes('proveedor') || text.includes('proveedores'))
  ) {
    return { intent: 'reporte_deuda_proveedores', targetName: null, confidence: 0.86 };
  }

  if (
    (text.includes('reporte') || text.includes('resumen') || text.includes('informe')) &&
    (text.includes('cliente') || text.includes('deuda'))
  ) {
    return { intent: 'reporte_deuda_clientes', targetName: null, confidence: 0.85 };
  }

  if (
    (text.includes('lista') || text.includes('reporte') || text.includes('resumen') || text.includes('informe')) &&
    text.includes('deuda') &&
    !text.includes('cliente') &&
    !text.includes('proveedor')
  ) {
    return { intent: 'unknown', targetName: null, confidence: 0.75, fallbackReason: 'ambiguous_debt_scope' };
  }

  if (isVencimientosReportRequest(text)) {
    return { intent: 'reporte_vencimientos', targetName: null, confidence: 0.9 };
  }

  if (isLibroIvaReportRequest(text)) {
    return { intent: 'reporte_libro_iva', targetName: null, confidence: 0.9 };
  }

  if (isPosSalesReportRequest(text)) {
    return { intent: 'reporte_ventas_pos', targetName: null, confidence: 0.9 };
  }

  if (isRecibosReportRequest(text)) {
    return { intent: 'reporte_recibos', targetName: null, confidence: 0.9 };
  }

  if (isGastoProveedoresReportRequest(text)) {
    return { intent: 'reporte_gasto_proveedores', targetName: null, confidence: 0.9 };
  }

  if (isCierreCajaReportRequest(text)) {
    return { intent: 'reporte_cierre_caja', targetName: null, confidence: 0.9 };
  }

  if (isComparativoVentasRequest(text)) {
    return { intent: 'reporte_comparativo_ventas', targetName: null, confidence: 0.92 };
  }

  if (/\b(informe\s+comercial|tablero\s+comercial|como\s+andamos)\b/.test(text)) {
    return { intent: 'reporte_resumen', targetName: null, confidence: 0.9 };
  }

  if (/\bfacturacion\s+del\s+mes\b/.test(text)) {
    return { intent: 'reporte_ventas', targetName: null, confidence: 0.9 };
  }

  if (
    /^(?:me\s+)?deben\b/.test(text) ||
    (/\bdeben\b/.test(text) && /\b(clientes?|cobrar|plata)\b/.test(text) && !text.includes('proveedor'))
  ) {
    return { intent: 'reporte_deuda_clientes', targetName: null, confidence: 0.9 };
  }

  if (
    /^(?:yo\s+)?debo\b/.test(text) ||
    /\bles\s+debo\b/.test(text) ||
    (/\bdebo\b/.test(text) && /\b(proveedores?|pagar|plata)\b/.test(text) && !text.includes('cliente'))
  ) {
    const hasNamedProveedor =
      /\bproveedor\s+[a-z0-9]/i.test(rawText) ||
      /\bdebo\s+al?\s+proveedor\s+/i.test(rawText) ||
      /\bdebo\s+a\s+[a-z0-9]/i.test(rawText);
    if (!hasNamedProveedor) {
      return { intent: 'reporte_deuda_proveedores', targetName: null, confidence: 0.9 };
    }
  }

  if (isResumenReportRequest(text)) {
    return { intent: 'reporte_resumen', targetName: null, confidence: 0.9 };
  }

  if (isVentasArticuloReportRequest(text)) {
    return { intent: 'reporte_ventas_articulo', targetName: null, confidence: 0.9 };
  }

  if (isSalesProductsReportRequest(text)) {
    return { intent: 'reporte_ventas_productos', targetName: null, confidence: 0.9 };
  }

  if (isSalesCustomersReportRequest(text)) {
    return { intent: 'reporte_ventas_clientes', targetName: null, confidence: 0.9 };
  }

  if (isProfitReportRequest(text)) {
    return { intent: 'reporte_ganancias', targetName: null, confidence: 0.9 };
  }

  if (isPaymentMethodsReportRequest(text)) {
    return { intent: 'reporte_medios_pago', targetName: null, confidence: 0.9 };
  }

  if (isSalesReportRequest(text)) {
    return { intent: 'reporte_ventas', targetName: null, confidence: 0.9 };
  }

  if (isLowStockReportRequest(text)) {
    return { intent: 'reporte_stock_bajo', targetName: null, confidence: 0.88 };
  }

  if (
    /(?:stock\s+(?:mas|más)\s+bajo|menos\s+stock|producto\s+con\s+menos\s+stock|producto\s+que\s+menos\s+tengo)/.test(
      text,
    ) &&
    !text.includes('stock minimo') &&
    !text.includes('stock mínimo')
  ) {
    return { intent: 'stock_mas_bajo', targetName: null, confidence: 0.9 };
  }

  if (
    (text.includes('reporte') || text.includes('informe')) &&
    !text.includes('deuda') &&
    !text.includes('stock') &&
    !text.includes('resumen')
  ) {
    return {
      intent: 'unknown',
      targetName: null,
      confidence: 0.7,
      fallbackReason: 'report_requested_without_scope',
    };
  }

  if (
    (text.includes('stock') || text.includes('inventario') || text.includes('existencia')) &&
    !text.includes('stock bajo') &&
    !text.includes('faltante') &&
    !text.includes('reposicion') &&
    !/stock(?:\s+de)?\s+[a-z0-9]/.test(text)
  ) {
    return { intent: 'reporte_stock_general', targetName: null, confidence: 0.86 };
  }

  if (/\bstock\s+de\s+deuda\b/.test(text) || (/\bstock\b/.test(text) && /\bdeuda\b/.test(text) && !/\bdeuda\s+(?:de|del|de la)\b/.test(text))) {
    return { intent: 'reporte_stock_general', targetName: null, confidence: 0.88 };
  }

  const stockMatch =
    !/\breporte\b/.test(text) &&
    (text.match(/(?:cuanto|cuanto)\s+(?:stock\s+)?tengo(?:\s+de)?\s+(.+)/) ||
      text.match(/stock(?:\s+de)?\s+(.+)/) ||
      text.match(/inventario(?:\s+de)?\s+(.+)/));
  if (/\bstock\s+general\b/.test(text) && /\bpagina\s+\d+/.test(text)) {
    return { intent: 'reporte_stock_general', targetName: null, confidence: 0.92 };
  }
  if (/\bstock\s+bajo\b/.test(text) && /\bpagina\s+\d+/.test(text)) {
    return { intent: 'reporte_stock_bajo', targetName: null, confidence: 0.92 };
  }
  if (/\bdeuda\s+clientes\b/.test(text) && /\bpagina\s+\d+/.test(text)) {
    return { intent: 'reporte_deuda_clientes', targetName: null, confidence: 0.92 };
  }
  if (/\bdeuda\s+proveedores\b/.test(text) && /\bpagina\s+\d+/.test(text)) {
    return { intent: 'reporte_deuda_proveedores', targetName: null, confidence: 0.92 };
  }
  if (stockMatch) {
    const target = stripTrailingContext(quoted ?? stockMatch[1] ?? '');
    return { intent: 'stock_producto', targetName: target || null, confidence: 0.85 };
  }

  if (/^(todos?\s+son\s+iguales?|cualquiera|da\s+igual|el\s+primero|la\s+primera)$/i.test(text)) {
    return {
      intent: 'unknown',
      targetName: null,
      confidence: 0.5,
      fallbackReason: 'ambiguous_product_selection',
    };
  }

  return { intent: 'unknown', targetName: null, confidence: 0.4, fallbackReason: 'not_in_catalog' };
}

async function detectIntent(
  rawText: string,
  conversationState?: WhatsAppConversationState | null,
): Promise<IntentDetection> {
  const resolved = resolveConversationMessage({ text: rawText, state: conversationState ?? null });
  const textForClassification = resolved.message;
  const intentContext = conversationStateToIntentContext(conversationState);

  const rules = detectIntentByRules(textForClassification);
  if (rules.intent === 'unsupported_action') return rules;
  if (!shouldInvokeIntentLlmAfterRules(rules)) return rules;

  const llm = await classifyIntentWithLlm(textForClassification, intentContext);
  if (!llm) return rules;

  if (rules.intent !== 'unknown' && llm.intent === 'unknown') return rules;
  if (llm.intent !== 'unknown' && !llm.targetName && rules.targetName) {
    llm.targetName = rules.targetName;
  }

  if (llm.intent === 'unknown' && rules.fallbackReason && !llm.fallbackReason) {
    llm.fallbackReason = rules.fallbackReason;
  }

  if (rules.intent !== 'unknown' && llm.intent !== rules.intent && rules.confidence >= llm.confidence + 0.2) {
    return rules;
  }

  return llm;
}

function applyDetectionGuardrails(detection: IntentDetection): IntentDetection {
  if (detection.intent === 'stock_producto' && isGenericTargetName('stock_producto', detection.targetName)) {
    return {
      intent: 'reporte_stock_general',
      targetName: null,
      confidence: Math.min(detection.confidence, 0.93),
      fallbackReason: 'generic_stock_scope',
    };
  }

  if (
    (detection.intent === 'cliente_deuda' ||
      detection.intent === 'cliente_extracto_cc' ||
      detection.intent === 'cliente_contacto' ||
      detection.intent === 'proveedor_contacto' ||
      detection.intent === 'proveedor_deuda') &&
    isGenericTargetName(detection.intent, detection.targetName)
  ) {
    return {
      ...detection,
      targetName: null,
      confidence: Math.min(detection.confidence, 0.92),
      fallbackReason: 'generic_target_name',
    };
  }

  return detection;
}

async function buildCapabilitiesCatalogForTenant(params: {
  db: any;
  tenantId: string;
  rolWhatsapp?: string | null;
  channel?: WhatsAppCapabilityChannel;
}) {
  const modules = await getModuleConfig(params.db, params.tenantId);
  return buildWhatsAppCapabilitiesCatalog({
    modules: {
      facturador_simple: Boolean(modules.facturador_simple),
      stock: Boolean(modules.stock),
      facturador_pos: Boolean(modules.facturador_pos),
      analizador_rentabilidad: Boolean(modules.analizador_rentabilidad),
      lector_facturas: Boolean(modules.lector_facturas),
      importador_excel: Boolean(modules.importador_excel),
    },
    rolWhatsapp: params.rolWhatsapp ?? 'operador',
    channel: params.channel ?? 'live',
  });
}

async function getModuleConfig(db: any, tenantId: string): Promise<Record<string, unknown>> {
  const { data, error } = await db
    .from('modulo_config')
    .select('stock, facturador_simple, facturador_pos, analizador_rentabilidad')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, unknown>;
}

async function resolveProveedor(db: any, tenantId: string, targetName: string) {
  const like = sanitizeLike(targetName);
  const { data, error } = await db
    .from('proveedor')
    .select('id, nombre, telefono, email, direccion')
    .eq('tenant_id', tenantId)
    .ilike('nombre', `%${like}%`)
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: string;
    nombre: string;
    telefono: string | null;
    email: string | null;
    direccion: string | null;
  }>;
}

async function resolveCliente(db: any, tenantId: string, targetName: string) {
  const like = sanitizeLike(targetName);
  const { data, error } = await db
    .from('cliente')
    .select('id, nombre, razon_social, telefono, email, direccion')
    .eq('tenant_id', tenantId)
    .or(`nombre.ilike.%${like}%,razon_social.ilike.%${like}%`)
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: string;
    nombre: string;
    razon_social: string | null;
    telefono: string | null;
    email: string | null;
    direccion: string | null;
  }>;
}

async function resolveProducto(db: any, tenantId: string, targetName: string) {
  const like = sanitizeLike(targetName);
  const { data, error } = await db
    .from('producto')
    .select('id, nombre, codigo, stock_actual, activo')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .or(`nombre.ilike.%${like}%,codigo.ilike.%${like}%`)
    .limit(5);
  if (error) throw new Error(error.message);
  return (
    (data ?? []) as Array<{ id: string; nombre: string; codigo: string; stock_actual: number; activo: boolean }>
  ).filter((p) => p.activo);
}

async function runProveedorDebtTool(db: any, tenantId: string, targetName: string): Promise<string> {
  const proveedores = await resolveProveedor(db, tenantId, targetName);
  if (proveedores.length === 0) {
    return `No encontré un proveedor con “${targetName}”. Decime el nombre exacto para buscarlo mejor.`;
  }
  if (proveedores.length > 1) {
    const uniqueProveedores = uniqueBy(proveedores, (p) => normalizeText(p.nombre));
    const options = uniqueProveedores.map((p, i) => `${i + 1}) ${p.nombre}`).join('\n');
    return [
      'Encontré varios proveedores parecidos:',
      options,
      'Respondé con el número (ej: 1) o con el nombre exacto y te paso la deuda.',
    ].join('\n');
  }

  const proveedor = proveedores[0];
  const { data: cuenta, error } = await db
    .from('cuenta_corriente')
    .select('saldo')
    .eq('tenant_id', tenantId)
    .eq('proveedor_id', proveedor.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const saldo = Number(cuenta?.saldo ?? 0);
  if (saldo > 0) {
    return `Le debés ${formatAmount(saldo)} al proveedor ${proveedor.nombre}.`;
  }
  if (saldo < 0) {
    return `Tenés saldo a favor de ${formatAmount(Math.abs(saldo))} con ${proveedor.nombre}.`;
  }
  return `No tenés deuda con ${proveedor.nombre}.`;
}

async function runClienteDebtTool(db: any, tenantId: string, targetName: string): Promise<string> {
  const clientes = await resolveCliente(db, tenantId, targetName);
  if (clientes.length === 0) {
    return `No encontré un cliente con “${targetName}”. Decime el nombre exacto y lo vuelvo a buscar.`;
  }
  if (clientes.length > 1) {
    const uniqueClientes = uniqueBy(
      clientes,
      (c) => `${normalizeText(c.razon_social || '')}|${normalizeText(c.nombre || '')}`,
    );
    const options = uniqueClientes
      .map((c, i) => `${i + 1}) ${c.razon_social || `${c.nombre}`}`)
      .slice(0, 5)
      .join('\n');
    return [
      'Encontré varios clientes parecidos:',
      options,
      'Respondé con el número (ej: 2) o con el nombre exacto y te paso la deuda de cuenta corriente.',
    ].join('\n');
  }

  const cliente = clientes[0];
  const etiqueta = cliente.razon_social || cliente.nombre;
  const { data: cuenta, error } = await db
    .from('cuenta_corriente')
    .select('saldo')
    .eq('tenant_id', tenantId)
    .eq('cliente_id', cliente.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const saldo = Number(cuenta?.saldo ?? 0);
  if (saldo > 0) {
    return `${etiqueta} te debe ${formatAmount(saldo)} en cuenta corriente.`;
  }
  if (saldo < 0) {
    return `${etiqueta} tiene saldo a favor por ${formatAmount(Math.abs(saldo))}.`;
  }
  return `${etiqueta} no tiene deuda pendiente en cuenta corriente.`;
}

function entityContactFieldLabel(field: EntityContactField): string {
  if (field === 'telefono') return 'telefono';
  if (field === 'email') return 'email';
  if (field === 'direccion') return 'direccion';
  return 'datos de contacto';
}

async function runClienteContactTool(
  db: any,
  tenantId: string,
  targetName: string,
  field: ClienteContactField,
): Promise<{ reply: string; resolvedName: string | null }> {
  const clientes = await resolveCliente(db, tenantId, targetName);
  if (clientes.length === 0) {
    return {
      reply: `No encontre un cliente con "${targetName}". Decime el nombre exacto y busco sus datos de contacto.`,
      resolvedName: null,
    };
  }
  if (clientes.length > 1) {
    const uniqueClientes = uniqueBy(
      clientes,
      (c) => `${normalizeText(c.razon_social || '')}|${normalizeText(c.nombre || '')}`,
    );
    const options = uniqueClientes
      .map((c, i) => `${i + 1}) ${c.razon_social || `${c.nombre}`}`)
      .slice(0, 5)
      .join('\n');
    return {
      reply: [
        'Encontre varios clientes parecidos:',
        options,
        `Responde con el numero (ej: 1) o con el nombre exacto y te paso ${entityContactFieldLabel(field)}.`,
      ].join('\n'),
      resolvedName: null,
    };
  }

  const cliente = clientes[0];
  const etiqueta = cliente.razon_social || cliente.nombre;
  const telefono = String(cliente.telefono ?? '').trim();
  const email = String(cliente.email ?? '').trim();
  const direccion = String(cliente.direccion ?? '').trim();

  if (field === 'telefono') {
    return {
      reply: telefono ? `El telefono de ${etiqueta} es ${telefono}.` : `${etiqueta} no tiene telefono cargado.`,
      resolvedName: etiqueta,
    };
  }
  if (field === 'email') {
    return {
      reply: email ? `El email de ${etiqueta} es ${email}.` : `${etiqueta} no tiene email cargado.`,
      resolvedName: etiqueta,
    };
  }
  if (field === 'direccion') {
    return {
      reply: direccion ? `La direccion de ${etiqueta} es ${direccion}.` : `${etiqueta} no tiene direccion cargada.`,
      resolvedName: etiqueta,
    };
  }

  if (!telefono && !email && !direccion) {
    return {
      reply: `${etiqueta} no tiene telefono, email ni direccion cargados.`,
      resolvedName: etiqueta,
    };
  }

  return {
    reply: [
      `Datos de contacto de ${etiqueta}:`,
      `- Telefono: ${telefono || 'sin telefono cargado'}`,
      `- Email: ${email || 'sin email cargado'}`,
      `- Direccion: ${direccion || 'sin direccion cargada'}`,
    ].join('\n'),
    resolvedName: etiqueta,
  };
}

async function runProveedorContactTool(
  db: any,
  tenantId: string,
  targetName: string,
  field: EntityContactField,
): Promise<{ reply: string; resolvedName: string | null }> {
  const proveedores = await resolveProveedor(db, tenantId, targetName);
  if (proveedores.length === 0) {
    return {
      reply: `No encontre un proveedor con "${targetName}". Decime el nombre exacto y busco sus datos de contacto.`,
      resolvedName: null,
    };
  }
  if (proveedores.length > 1) {
    const uniqueProveedores = uniqueBy(proveedores, (p) => normalizeText(p.nombre));
    const options = uniqueProveedores.map((p, i) => `${i + 1}) ${p.nombre}`).slice(0, 5).join('\n');
    return {
      reply: [
        'Encontre varios proveedores parecidos:',
        options,
        `Responde con el numero (ej: 1) o con el nombre exacto y te paso ${entityContactFieldLabel(field)}.`,
      ].join('\n'),
      resolvedName: null,
    };
  }

  const proveedor = proveedores[0];
  const etiqueta = proveedor.nombre;
  const telefono = String(proveedor.telefono ?? '').trim();
  const email = String(proveedor.email ?? '').trim();
  const direccion = String(proveedor.direccion ?? '').trim();

  if (field === 'telefono') {
    return {
      reply: telefono ? `El telefono de ${etiqueta} es ${telefono}.` : `${etiqueta} no tiene telefono cargado.`,
      resolvedName: etiqueta,
    };
  }
  if (field === 'email') {
    return {
      reply: email ? `El email de ${etiqueta} es ${email}.` : `${etiqueta} no tiene email cargado.`,
      resolvedName: etiqueta,
    };
  }
  if (field === 'direccion') {
    return {
      reply: direccion ? `La direccion de ${etiqueta} es ${direccion}.` : `${etiqueta} no tiene direccion cargada.`,
      resolvedName: etiqueta,
    };
  }

  if (!telefono && !email && !direccion) {
    return {
      reply: `${etiqueta} no tiene telefono, email ni direccion cargados.`,
      resolvedName: etiqueta,
    };
  }

  return {
    reply: [
      `Datos de contacto de ${etiqueta}:`,
      `- Telefono: ${telefono || 'sin telefono cargado'}`,
      `- Email: ${email || 'sin email cargado'}`,
      `- Direccion: ${direccion || 'sin direccion cargada'}`,
    ].join('\n'),
    resolvedName: etiqueta,
  };
}

async function runStockProductoTool(db: any, tenantId: string, targetName: string): Promise<string> {
  const productos = await resolveProducto(db, tenantId, targetName);
  if (productos.length === 0) {
    return `No encontré un producto con “${targetName}”. Pasame nombre o código exacto.`;
  }
  const uniqueProductos = uniqueBy(
    productos,
    (p) => `${normalizeText(p.nombre)}|${normalizeText(String(p.codigo ?? ''))}`,
  );
  if (uniqueProductos.length > 1) {
    const options = uniqueProductos.map((p, i) => `${i + 1}) ${p.nombre} (${p.codigo})`).join('\n');
    return [
      'Encontré varios productos parecidos:',
      options,
      'Respondé con el número (ej: 1) o con nombre/código exacto.',
    ].join('\n');
  }

  const producto = uniqueProductos[0];
  const { data: stocks, error } = await db
    .from('stock_sucursal')
    .select('stock_actual, sucursal:sucursal_id(codigo, nombre)')
    .eq('tenant_id', tenantId)
    .eq('producto_id', producto.id);
  if (error) throw new Error(error.message);

  if (!stocks || stocks.length === 0) {
    const fallback = Number(producto.stock_actual ?? 0);
    return `Stock de ${producto.nombre}: ${formatStockQty(fallback)} unidades (sin desglose por sucursal todavía).`;
  }

  let total = 0;
  const detailLines = (stocks as Array<{ stock_actual: number; sucursal: any }>)
    .map((row) => {
      const sa = Number(row.stock_actual ?? 0);
      total += sa;
      const suc = Array.isArray(row.sucursal) ? row.sucursal[0] : row.sucursal;
      const nombreSucursal = suc?.codigo ? `${suc.codigo} · ${suc.nombre}` : suc?.nombre || 'Sucursal';
      return `- ${nombreSucursal}: ${formatStockQty(sa)}`;
    })
    .slice(0, 5);

  return [`Stock total de ${producto.nombre}: ${formatStockQty(total)}.`, ...detailLines].join('\n');
}

async function runStockMasBajoTool(db: any, tenantId: string): Promise<string> {
  const { data, error } = await db
    .from('stock_sucursal')
    .select('stock_actual, producto:producto_id(id, nombre, codigo, activo)')
    .eq('tenant_id', tenantId);
  if (error) throw new Error(error.message);

  const totals = new Map<string, { nombre: string; codigo: string; total: number }>();
  for (const row of (data ?? []) as Array<{ stock_actual: number; producto: any }>) {
    const prod = Array.isArray(row.producto) ? row.producto[0] : row.producto;
    if (!prod?.id || !prod?.activo) continue;

    const id = String(prod.id);
    const current = totals.get(id) ?? {
      nombre: String(prod.nombre || 'Producto'),
      codigo: String(prod.codigo || '-'),
      total: 0,
    };
    current.total += Number(row.stock_actual ?? 0);
    totals.set(id, current);
  }

  const items = Array.from(totals.values())
    .filter((x) => Number.isFinite(x.total))
    .sort((a, b) => a.total - b.total);

  if (items.length === 0) {
    return 'No encontré datos de stock para calcular el producto con menor stock.';
  }

  const first = items[0];
  const extra = items
    .slice(1, 5)
    .map((row) => `- ${row.nombre} (${row.codigo}): ${formatStockQty(row.total)}`);

  return [
    `Hoy, el producto con menor stock es ${first.nombre} (${first.codigo}) con ${formatStockQty(first.total)} unidades.`,
    extra.length > 0 ? 'Después le siguen:' : null,
    ...extra,
    'Si querés, te paso también el reporte de stock bajo por mínimo configurado.',
  ]
    .filter(Boolean)
    .join('\n');
}

type SalesReportPeriod = {
  key: SalesReportPeriodKey | 'named_month';
  label: string;
  desde: string;
  hasta: string;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function weekdayFromYmd(ymd: string): number {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function ymdFromParts(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

function resolveSalesReportPeriod(request: SalesReportPeriodRequest): SalesReportPeriod {
  const hoy = ymdArgentina();
  if (typeof request === 'object') {
    const currentYear = Number(hoy.slice(0, 4));
    const currentMonth = Number(hoy.slice(5, 7));
    const desde = ymdFromParts(request.year, request.month, 1);
    const hasta =
      request.year === currentYear && request.month === currentMonth
        ? hoy
        : ymdFromParts(request.year, request.month, lastDayOfMonth(request.year, request.month));
    return { key: 'named_month', label: request.label, desde, hasta };
  }
  if (request === 'ayer') {
    const ayer = sumarDiasYmd(hoy, -1);
    return { key: request, label: 'Ayer', desde: ayer, hasta: ayer };
  }
  if (request === 'semana') {
    const weekday = weekdayFromYmd(hoy);
    const diffLunes = weekday === 0 ? 6 : weekday - 1;
    return { key: request, label: 'Semana actual', desde: sumarDiasYmd(hoy, -diffLunes), hasta: hoy };
  }
  if (request === 'mes') {
    return { key: request, label: 'Mes actual', desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
  }
  if (request === 'mes_anterior') {
    const prevLast = sumarDiasYmd(`${hoy.slice(0, 8)}01`, -1);
    return { key: request, label: 'Mes anterior', desde: `${prevLast.slice(0, 8)}01`, hasta: prevLast };
  }
  return { key: 'hoy', label: 'Hoy', desde: hoy, hasta: hoy };
}

function formatSalesPeriodRange(period: SalesReportPeriod): string {
  return period.desde === period.hasta ? `(${period.desde})` : `(${period.desde} a ${period.hasta})`;
}

function isSalesReceiptType(tipo: string): boolean {
  return tipo === 'ticket' || tipo.startsWith('factura_');
}

function isCreditNoteType(tipo: string): boolean {
  return tipo.startsWith('nota_credito_');
}

function salesSignForType(tipo: string): number {
  return isCreditNoteType(tipo) ? -1 : 1;
}

function isReportableSalesType(tipo: string): boolean {
  return isSalesReceiptType(tipo) || isCreditNoteType(tipo);
}

async function runReporteVentasTool(
  db: any,
  tenantId: string,
  periodRequest: SalesReportPeriodRequest,
): Promise<string> {
  const period = resolveSalesReportPeriod(periodRequest);
  const { data, error } = await db
    .from('comprobante')
    .select('id, fecha, total, tipo, numero_orden')
    .eq('tenant_id', tenantId)
    .eq('estado', 'emitido')
    .gte('fecha', period.desde)
    .lte('fecha', period.hasta);
  if (error) throw new Error(error.message);

  const rows = aplanarRepresentativosVentaPorOrden(
    ((data ?? []) as Array<{
      id: string;
      fecha?: string | null;
      total: number | string | null;
      tipo: string | null;
      numero_orden?: number | null;
    }>).map((row) => ({
      ...row,
      tipo: String(row.tipo ?? ''),
    })),
  );

  let ventasNetas = 0;
  let montoFacturas = 0;
  let montoTickets = 0;
  let montoNotasCredito = 0;
  let comprobantesFactura = 0;
  let comprobantesTicket = 0;
  let notasCredito = 0;
  let comprobantesVenta = 0;

  for (const row of rows) {
    const tipo = String(row.tipo ?? '');
    const total = Number(row.total ?? 0);
    if (!Number.isFinite(total)) continue;

    if (isCreditNoteType(tipo)) {
      ventasNetas -= total;
      montoNotasCredito += total;
      notasCredito += 1;
      continue;
    }

    if (!isSalesReceiptType(tipo)) continue;

    ventasNetas += total;
    comprobantesVenta += 1;
    if (tipo.startsWith('factura_')) {
      montoFacturas += total;
      comprobantesFactura += 1;
    } else if (tipo === 'ticket') {
      montoTickets += total;
      comprobantesTicket += 1;
    }
  }

  const periodRange = formatSalesPeriodRange(period);
  if (comprobantesVenta === 0 && notasCredito === 0) {
    return `No encontre ventas emitidas para ${period.label.toLowerCase()} ${periodRange}.`;
  }

  const lines = [
    `Ventas ${period.label} ${periodRange}: ${formatAmount(roundMoney(ventasNetas))}`,
    `- Comprobantes de venta: ${comprobantesVenta}`,
    `- Facturas: ${formatAmount(roundMoney(montoFacturas))} (${comprobantesFactura})`,
    `- Tickets POS: ${formatAmount(roundMoney(montoTickets))} (${comprobantesTicket})`,
  ];

  if (notasCredito > 0) {
    lines.push(`- Notas de credito: -${formatAmount(roundMoney(montoNotasCredito))} (${notasCredito})`);
  }

  if (comprobantesVenta > 0) {
    lines.push(`Ticket promedio: ${formatAmount(roundMoney(ventasNetas / comprobantesVenta))}.`);
  }

  return lines.join('\n');
}

async function runReporteVentasProductosTool(
  db: any,
  tenantId: string,
  periodRequest: SalesReportPeriodRequest,
): Promise<{ reply: string; memoryOptions?: string[] }> {
  const period = resolveSalesReportPeriod(periodRequest);
  const { data, error } = await db
    .from('comprobante_item')
    .select(
      `
      cantidad,
      precio_costo,
      subtotal,
      producto_id,
      comprobante:comprobante_id!inner (id, tenant_id, fecha, tipo, estado, fiscalizado_por_id, total),
      producto:producto_id (id, codigo, nombre)
    `,
    )
    .eq('comprobante.tenant_id', tenantId)
    .eq('comprobante.estado', 'emitido')
    .gte('comprobante.fecha', period.desde)
    .lte('comprobante.fecha', period.hasta);
  if (error) throw new Error(error.message);

  type ItemRow = {
    cantidad: number | string | null;
    precio_costo?: number | string | null;
    subtotal: number | string | null;
    producto_id: string | null;
    comprobante: any;
    producto: any;
  };

  const rows = ((data ?? []) as ItemRow[])
    .map((raw) => {
      const comp = Array.isArray(raw.comprobante) ? raw.comprobante[0] : raw.comprobante;
      const prod = Array.isArray(raw.producto) ? raw.producto[0] : raw.producto;
      return { raw, comp, prod };
    })
    .filter(({ raw, comp, prod }) => {
      if (!comp || !prod) return false;
      if (String(comp.tenant_id ?? tenantId) !== tenantId) return false;
      if (String(comp.estado ?? '') !== 'emitido') return false;
      if (String(comp.fecha ?? '') < period.desde || String(comp.fecha ?? '') > period.hasta) return false;
      const tipo = String(comp.tipo ?? '');
      if (!isSalesReceiptType(tipo) && !isCreditNoteType(tipo)) return false;
      if (tipo === 'ticket' && comp.fiscalizado_por_id) return false;
      return Boolean(raw.producto_id || prod.id);
    });

  const sumaLineasPorComp = new Map<string, number>();
  const totalPorComp = new Map<string, number>();
  for (const { raw, comp } of rows) {
    const compId = String(comp.id ?? '');
    const subtotal = Number(raw.subtotal ?? 0);
    if (!compId || !Number.isFinite(subtotal)) continue;
    sumaLineasPorComp.set(compId, (sumaLineasPorComp.get(compId) ?? 0) + subtotal);
    totalPorComp.set(compId, Number(comp.total ?? subtotal));
  }

  const factorPorComp = new Map<string, number>();
  for (const [compId, sumaLineas] of sumaLineasPorComp) {
    const totalComp = totalPorComp.get(compId) ?? sumaLineas;
    factorPorComp.set(compId, factorLineasVsTotalComprobante(totalComp, sumaLineas));
  }

  const agg = new Map<
    string,
    {
      nombre: string;
      codigo: string;
      unidades: number;
      importe: number;
      tickets: Set<string>;
    }
  >();

  for (const { raw, comp, prod } of rows) {
    const tipo = String(comp.tipo ?? '');
    const sign = isCreditNoteType(tipo) ? -1 : 1;
    const compId = String(comp.id ?? '');
    const productId = String(raw.producto_id ?? prod.id ?? '');
    if (!productId || !compId) continue;

    const factor = factorPorComp.get(compId) ?? 1;
    const unidades = Number(raw.cantidad ?? 0) * sign;
    const importe = roundMoney(Number(raw.subtotal ?? 0) * factor) * sign;
    if (!Number.isFinite(unidades) || !Number.isFinite(importe)) continue;

    const prev = agg.get(productId) ?? {
      nombre: String(prod.nombre ?? 'Producto'),
      codigo: String(prod.codigo ?? '-'),
      unidades: 0,
      importe: 0,
      tickets: new Set<string>(),
    };
    prev.unidades += unidades;
    prev.importe += importe;
    prev.tickets.add(compId);
    agg.set(productId, prev);
  }

  const items = Array.from(agg.values())
    .filter((row) => row.unidades > 0 || row.importe > 0)
    .sort((a, b) => {
      if (b.unidades !== a.unidades) return b.unidades - a.unidades;
      return b.importe - a.importe;
    });

  const periodRange = formatSalesPeriodRange(period);
  if (items.length === 0) {
    return {
      reply: `No encontre productos vendidos para ${period.label.toLowerCase()} ${periodRange}.`,
    };
  }

  const totalUnidades = items.reduce((acc, row) => acc + row.unidades, 0);
  const totalImporte = items.reduce((acc, row) => acc + row.importe, 0);
  const top = items.slice(0, 5);
  const lines = [
    `Productos mas vendidos · ${period.label} ${periodRange}`,
    ...top.map(
      (row, idx) =>
        `${idx + 1}) ${row.nombre} (${row.codigo}): ${formatStockQty(row.unidades)} unidades · ${formatAmount(
          roundMoney(row.importe),
        )}`,
    ),
    `Total periodo: ${formatStockQty(totalUnidades)} unidades · ${formatAmount(roundMoney(totalImporte))}`,
  ];

  return {
    reply: lines.join('\n'),
    memoryOptions: top.map((row) => row.nombre),
  };
}

async function runReporteVentasClientesTool(
  db: any,
  tenantId: string,
  periodRequest: SalesReportPeriodRequest,
): Promise<{ reply: string; memoryOptions?: string[] }> {
  const period = resolveSalesReportPeriod(periodRequest);
  const { data, error } = await db
    .from('comprobante')
    .select('id, fecha, total, tipo, numero_orden, cliente_id, cliente:cliente_id(nombre, razon_social)')
    .eq('tenant_id', tenantId)
    .eq('estado', 'emitido')
    .gte('fecha', period.desde)
    .lte('fecha', period.hasta);
  if (error) throw new Error(error.message);

  const rows = aplanarRepresentativosVentaPorOrden(
    ((data ?? []) as Array<{
      id: string;
      fecha?: string | null;
      total: number | string | null;
      tipo: string | null;
      numero_orden?: number | null;
      cliente_id?: string | null;
      cliente?: any;
    }>).map((row) => ({
      ...row,
      tipo: String(row.tipo ?? ''),
    })),
  );

  const agg = new Map<string, { nombre: string; total: number; comprobantes: number }>();
  for (const row of rows) {
    const tipo = String(row.tipo ?? '');
    if (!isReportableSalesType(tipo)) continue;
    const cliente = Array.isArray(row.cliente) ? row.cliente[0] : row.cliente;
    const key = String(row.cliente_id ?? 'consumidor-final');
    const nombre = cliente?.razon_social || cliente?.nombre || 'Consumidor final';
    const prev = agg.get(key) ?? { nombre, total: 0, comprobantes: 0 };
    prev.total += Number(row.total ?? 0) * salesSignForType(tipo);
    if (isSalesReceiptType(tipo)) prev.comprobantes += 1;
    agg.set(key, prev);
  }

  const items = Array.from(agg.values())
    .filter((row) => row.total > 0 || row.comprobantes > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const periodRange = formatSalesPeriodRange(period);
  if (items.length === 0) {
    return { reply: `No encontre ventas por cliente para ${period.label.toLowerCase()} ${periodRange}.` };
  }

  const totalPeriodo = Array.from(agg.values()).reduce((acc, row) => acc + row.total, 0);
  const lines = [
    `Clientes que mas compraron · ${period.label} ${periodRange}`,
    ...items.map(
      (row, idx) => `${idx + 1}) ${row.nombre}: ${formatAmount(roundMoney(row.total))} (${row.comprobantes})`,
    ),
    `Total periodo: ${formatAmount(roundMoney(totalPeriodo))}`,
  ];

  return { reply: lines.join('\n'), memoryOptions: items.map((row) => row.nombre) };
}

async function runReporteGananciasTool(
  db: any,
  tenantId: string,
  periodRequest: SalesReportPeriodRequest,
): Promise<string> {
  const period = resolveSalesReportPeriod(periodRequest);
  const [comprobantesQ, costoQ] = await Promise.all([
    db
      .from('comprobante')
      .select('id, fecha, total, tipo, numero_orden')
      .eq('tenant_id', tenantId)
      .eq('estado', 'emitido')
      .gte('fecha', period.desde)
      .lte('fecha', period.hasta),
    db
      .from('comprobante_item')
      .select(
        `
        cantidad,
        precio_costo,
        comprobante:comprobante_id!inner (tenant_id, fecha, tipo, estado, fiscalizado_por_id)
      `,
      )
      .eq('comprobante.tenant_id', tenantId)
      .eq('comprobante.estado', 'emitido')
      .gte('comprobante.fecha', period.desde)
      .lte('comprobante.fecha', period.hasta),
  ]);
  if (comprobantesQ.error) throw new Error(comprobantesQ.error.message);
  if (costoQ.error) throw new Error(costoQ.error.message);

  let ventasNetas = 0;
  const comprobantesNetos = aplanarRepresentativosVentaPorOrden(
    ((comprobantesQ.data ?? []) as Array<{
      id: string;
      fecha?: string | null;
      total: number | string | null;
      tipo: string | null;
      numero_orden?: number | null;
    }>).map((row) => ({ ...row, tipo: String(row.tipo ?? '') })),
  );
  for (const row of comprobantesNetos) {
    const tipo = String(row.tipo ?? '');
    if (!isReportableSalesType(tipo)) continue;
    ventasNetas += Number(row.total ?? 0) * salesSignForType(tipo);
  }

  let costoMercaderia = 0;
  for (const row of (costoQ.data ?? []) as Array<{ cantidad: number; precio_costo: number; comprobante: any }>) {
    const comp = Array.isArray(row.comprobante) ? row.comprobante[0] : row.comprobante;
    if (!comp) continue;
    if (String(comp.tenant_id ?? tenantId) !== tenantId) continue;
    const tipo = String(comp.tipo ?? '');
    if (!isReportableSalesType(tipo)) continue;
    if (tipo === 'ticket' && comp.fiscalizado_por_id) continue;
    costoMercaderia += Number(row.precio_costo ?? 0) * Number(row.cantidad ?? 0) * salesSignForType(tipo);
  }

  const margenBruto = ventasNetas - costoMercaderia;
  const margenPct = ventasNetas === 0 ? null : roundMoney((margenBruto / ventasNetas) * 100);
  const periodRange = formatSalesPeriodRange(period);
  return [
    `Ganancia · ${period.label} ${periodRange}`,
    `- Ventas netas: ${formatAmount(roundMoney(ventasNetas))}`,
    `- Costo mercaderia: ${formatAmount(roundMoney(costoMercaderia))}`,
    `- Margen bruto: ${formatAmount(roundMoney(margenBruto))}`,
    margenPct == null ? '- Margen: sin ventas para calcular porcentaje' : `- Margen: ${margenPct.toLocaleString('es-AR')}%`,
  ].join('\n');
}

function paymentMethodLabel(value: unknown): string {
  const raw = normalizeText(String(value ?? ''));
  if (!raw) return 'Sin especificar';
  if (raw === 'cuenta_corriente') return 'Cuenta corriente';
  if (raw === 'tarjeta_credito') return 'Tarjeta credito';
  if (raw === 'tarjeta_debito') return 'Tarjeta debito';
  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

async function runReporteMediosPagoTool(
  db: any,
  tenantId: string,
  periodRequest: SalesReportPeriodRequest,
): Promise<string> {
  const period = resolveSalesReportPeriod(periodRequest);
  const { data, error } = await db
    .from('comprobante')
    .select('id, fecha, total, tipo, numero_orden, metodo_pago')
    .eq('tenant_id', tenantId)
    .eq('estado', 'emitido')
    .gte('fecha', period.desde)
    .lte('fecha', period.hasta);
  if (error) throw new Error(error.message);

  const rows = aplanarRepresentativosVentaPorOrden(
    ((data ?? []) as Array<{
      id: string;
      fecha?: string | null;
      total: number | string | null;
      tipo: string | null;
      numero_orden?: number | null;
      metodo_pago?: string | null;
    }>).map((row) => ({
      ...row,
      tipo: String(row.tipo ?? ''),
    })),
  );

  const agg = new Map<string, { label: string; total: number; comprobantes: number }>();
  for (const row of rows) {
    const tipo = String(row.tipo ?? '');
    if (!isReportableSalesType(tipo)) continue;
    const label = paymentMethodLabel(row.metodo_pago);
    const prev = agg.get(label) ?? { label, total: 0, comprobantes: 0 };
    prev.total += Number(row.total ?? 0) * salesSignForType(tipo);
    if (isSalesReceiptType(tipo)) prev.comprobantes += 1;
    agg.set(label, prev);
  }

  const items = Array.from(agg.values())
    .filter((row) => row.total !== 0 || row.comprobantes > 0)
    .sort((a, b) => b.total - a.total);

  const periodRange = formatSalesPeriodRange(period);
  if (items.length === 0) {
    return `No encontre ventas con medio de pago para ${period.label.toLowerCase()} ${periodRange}.`;
  }

  const totalPeriodo = items.reduce((acc, row) => acc + row.total, 0);
  return [
    `Medios de pago · ${period.label} ${periodRange}`,
    ...items
      .slice(0, 6)
      .map((row) => `- ${row.label}: ${formatAmount(roundMoney(row.total))} (${row.comprobantes})`),
    `Total periodo: ${formatAmount(roundMoney(totalPeriodo))}`,
  ].join('\n');
}

type ReportToolOutput = {
  reply: string;
  context: {
    key: 'stock_general' | 'stock_bajo' | 'deuda_clientes' | 'deuda_proveedores';
    page: number;
    hasMore: boolean;
  };
  memoryOptions?: string[];
};

async function runReporteDeudaClientesTool(db: any, tenantId: string, page: number): Promise<ReportToolOutput> {
  const { data, error } = await db
    .from('cuenta_corriente')
    .select('saldo, cliente:cliente_id(nombre, razon_social)')
    .eq('tenant_id', tenantId)
    .not('cliente_id', 'is', null)
    .gt('saldo', 0)
    .order('saldo', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{ saldo: number; cliente: any }>;
  if (rows.length === 0) {
    return {
      reply: 'No hay clientes con deuda pendiente en cuenta corriente.',
      context: { key: 'deuda_clientes', page: 1, hasMore: false },
    };
  }

  const total = rows.reduce((acc, row) => acc + Number(row.saldo ?? 0), 0);
  const normalizedRows = rows.map((row) => {
    const cli = Array.isArray(row.cliente) ? row.cliente[0] : row.cliente;
    return {
      nombre: String(cli?.razon_social || cli?.nombre || 'Cliente'),
      saldo: Number(row.saldo ?? 0),
    };
  });
  const safePage = Math.max(1, page);
  const paginated = paginateRows(normalizedRows, safePage);
  const currentPage = Math.min(safePage, paginated.totalPages);
  const lines = paginated.pageRows.map((row) => `- ${row.nombre}: ${formatAmount(row.saldo)}`);

  return {
    reply: [
      `Reporte deuda clientes · Página ${currentPage}/${paginated.totalPages}`,
      ...lines,
      `Total deuda clientes: ${formatAmount(total)}`,
      paginated.hasMore ? 'Si querés más resultados, escribí: "seguí".' : 'No hay más páginas para este reporte.',
    ].join('\n'),
    context: { key: 'deuda_clientes', page: currentPage, hasMore: paginated.hasMore },
    memoryOptions: paginated.pageRows.map((row) => row.nombre),
  };
}

async function runReporteDeudaProveedoresTool(
  db: any,
  tenantId: string,
  page: number,
): Promise<ReportToolOutput> {
  const { data, error } = await db
    .from('cuenta_corriente')
    .select('saldo, proveedor:proveedor_id(nombre)')
    .eq('tenant_id', tenantId)
    .not('proveedor_id', 'is', null)
    .gt('saldo', 0)
    .order('saldo', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<{ saldo: number; proveedor: any }>;
  if (rows.length === 0) {
    return {
      reply: 'No hay deuda pendiente con proveedores en este momento.',
      context: { key: 'deuda_proveedores', page: 1, hasMore: false },
    };
  }

  const total = rows.reduce((acc, row) => acc + Number(row.saldo ?? 0), 0);
  const normalizedRows = rows.map((row) => {
    const prov = Array.isArray(row.proveedor) ? row.proveedor[0] : row.proveedor;
    return {
      nombre: String(prov?.nombre || 'Proveedor'),
      saldo: Number(row.saldo ?? 0),
    };
  });

  const safePage = Math.max(1, page);
  const paginated = paginateRows(normalizedRows, safePage);
  const currentPage = Math.min(safePage, paginated.totalPages);
  const preview = paginated.pageRows.map((row) => `- ${row.nombre}: ${formatAmount(row.saldo)}`);
  const pageSummary = [
    `Deuda proveedores · Página ${currentPage}/${paginated.totalPages}`,
    ...preview,
    `Total adeudado: ${formatAmount(total)}`,
    paginated.hasMore ? 'Si querés más resultados, escribí: "seguí".' : 'No hay más páginas para este reporte.',
  ].join('\n');

  if (currentPage > 1 || normalizedRows.length <= 40) {
    return {
      reply: pageSummary,
      context: { key: 'deuda_proveedores', page: currentPage, hasMore: paginated.hasMore },
    };
  }

  const pdfUrl = await generateAndUploadWhatsAppReportPdf({
    db,
    tenantId,
    reportKey: 'deuda-proveedores',
    title: 'Deuda con proveedores',
    subtitleLines: [
      `Generado: ${new Date().toLocaleString('es-AR')}`,
      `Total de proveedores con deuda: ${normalizedRows.length}`,
      `Monto total adeudado: ${formatAmount(total)}`,
    ],
    columns: ['Proveedor', 'Saldo'],
    rows: normalizedRows.map((row) => [row.nombre, formatAmount(row.saldo)]),
  });

  if (!pdfUrl) {
    return {
      reply: pageSummary,
      context: { key: 'deuda_proveedores', page: currentPage, hasMore: paginated.hasMore },
    };
  }

  return {
    reply: [pageSummary, `PDF completo: ${pdfUrl}`].join('\n'),
    context: { key: 'deuda_proveedores', page: currentPage, hasMore: paginated.hasMore },
  };
}

async function runReporteStockGeneralTool(db: any, tenantId: string, page: number): Promise<ReportToolOutput> {
  const { data, error } = await db
    .from('stock_sucursal')
    .select('stock_actual, producto:producto_id(id, nombre, codigo, activo)')
    .eq('tenant_id', tenantId);
  if (error) throw new Error(error.message);

  const totals = new Map<string, { nombre: string; codigo: string; total: number }>();
  for (const row of (data ?? []) as Array<{ stock_actual: number; producto: any }>) {
    const prod = Array.isArray(row.producto) ? row.producto[0] : row.producto;
    if (!prod?.id || !prod?.activo) continue;

    const id = String(prod.id);
    const current = totals.get(id) ?? {
      nombre: String(prod.nombre || 'Producto'),
      codigo: String(prod.codigo || '-'),
      total: 0,
    };
    current.total += Number(row.stock_actual ?? 0);
    totals.set(id, current);
  }

  const items = Array.from(totals.values())
    .sort((a, b) => b.total - a.total)
    .filter((x) => Number.isFinite(x.total));

  if (items.length === 0) {
    return {
      reply: 'No encontré stock cargado para productos activos en este negocio.',
      context: { key: 'stock_general', page: 1, hasMore: false },
    };
  }

  const totalUnidades = items.reduce((acc, row) => acc + row.total, 0);
  const safePage = Math.max(1, page);
  const paginated = paginateRows(items, safePage);
  const currentPage = Math.min(safePage, paginated.totalPages);
  const preview = paginated.pageRows.map(
    (row) => `- ${row.nombre} (${row.codigo}): ${formatStockQty(row.total)}`,
  );
  const pageSummary = [
    `Stock general · Página ${currentPage}/${paginated.totalPages} (${items.length} productos)`,
    ...preview,
    `Unidades totales: ${formatStockQty(totalUnidades)}`,
    paginated.hasMore ? 'Si querés seguir, escribí: "seguí".' : 'No hay más páginas para este reporte.',
  ].join('\n');

  if (currentPage > 1 || items.length <= 40) {
    return {
      reply: pageSummary,
      context: { key: 'stock_general', page: currentPage, hasMore: paginated.hasMore },
    };
  }

  const pdfUrl = await generateAndUploadWhatsAppReportPdf({
    db,
    tenantId,
    reportKey: 'stock-general',
    title: 'Stock general de productos',
    subtitleLines: [
      `Generado: ${new Date().toLocaleString('es-AR')}`,
      `Productos activos: ${items.length}`,
      `Unidades totales: ${formatStockQty(totalUnidades)}`,
    ],
    columns: ['Producto', 'Código', 'Stock'],
    rows: items.map((row) => [row.nombre, row.codigo, formatStockQty(row.total)]),
  });

  if (!pdfUrl) {
    return {
      reply: pageSummary,
      context: { key: 'stock_general', page: currentPage, hasMore: paginated.hasMore },
    };
  }

  return {
    reply: [pageSummary, `PDF completo: ${pdfUrl}`].join('\n'),
    context: { key: 'stock_general', page: currentPage, hasMore: paginated.hasMore },
  };
}

async function runReporteStockBajoTool(db: any, tenantId: string, page: number): Promise<ReportToolOutput> {
  const { data, error } = await db
    .from('stock_sucursal')
    .select('stock_actual, stock_minimo, producto:producto_id(nombre, activo)')
    .eq('tenant_id', tenantId)
    .gt('stock_minimo', 0);
  if (error) throw new Error(error.message);

  const low = ((data ?? []) as Array<{ stock_actual: number; stock_minimo: number; producto: unknown }>)
    .map((row: any) => {
      const prod = Array.isArray(row.producto) ? row.producto[0] : row.producto;
      const actual = Number(row.stock_actual ?? 0);
      const minimo = Number(row.stock_minimo ?? 0);
      return { prod, actual, minimo };
    })
    .filter(
      (row): row is { prod: { nombre: string; activo: boolean }; actual: number; minimo: number } =>
        Boolean(row.prod?.activo) && row.minimo > 0 && row.actual <= row.minimo,
    )
    .sort((a, b) => a.actual - b.actual);

  if (low.length === 0) {
    return {
      reply: 'No hay productos en estado de stock bajo en este momento.',
      context: { key: 'stock_bajo', page: 1, hasMore: false },
    };
  }

  const safePage = Math.max(1, page);
  const paginated = paginateRows(low, safePage);
  const currentPage = Math.min(safePage, paginated.totalPages);
  const lines = paginated.pageRows.map(
    (row) => `- ${row.prod.nombre}: stock ${formatStockQty(row.actual)} / mínimo ${formatStockQty(row.minimo)}`,
  );
  return {
    reply: [
      `Reporte stock bajo · Página ${currentPage}/${paginated.totalPages}`,
      ...lines,
      paginated.hasMore ? 'Si querés seguir, escribí: "seguí".' : 'No hay más páginas para este reporte.',
    ].join('\n'),
    context: { key: 'stock_bajo', page: currentPage, hasMore: paginated.hasMore },
  };
}

async function withOptionalReplyPolish(
  kind: ReplyPolishKind,
  templateReply: string,
  userMessage: string,
): Promise<string> {
  return composeReplyWithLlmPolish({ kind, templateReply, userMessage });
}

export async function runWhatsAppReadOnlyAgent(params: {
  db: any;
  tenantId: string;
  message: string;
  enableV2?: boolean;
  /** @deprecated Usar conversationState; se deriva intentContext internamente. */
  intentContext?: WhatsAppIntentClassifierContext;
  conversationState?: WhatsAppConversationState | null;
  rolWhatsapp?: string | null;
  channel?: WhatsAppCapabilityChannel;
}): Promise<ReadOnlyAgentResult> {
  const detection = applyDetectionGuardrails(
    await detectIntent(params.message, params.conversationState ?? null),
  );
  const useV2 = params.enableV2 ?? true;
  const requestedReportPage = useV2 ? reportPageFromMessage(params.message) : 1;
  const { db, tenantId } = params;

  if (
    detection.intent === 'assistant_greeting' ||
    detection.intent === 'assistant_help' ||
    detection.intent === 'assistant_examples'
  ) {
    const catalog = await buildCapabilitiesCatalogForTenant({
      db,
      tenantId,
      rolWhatsapp: params.rolWhatsapp,
      channel: params.channel,
    });
    const polishKind: ReplyPolishKind =
      detection.intent === 'assistant_greeting'
        ? 'assistant_greeting'
        : detection.intent === 'assistant_help'
          ? 'assistant_help'
          : 'assistant_examples';
    const templateReply =
      polishKind === 'assistant_greeting'
        ? composeGreetingReply(catalog)
        : polishKind === 'assistant_help'
          ? composeHelpReply(catalog)
          : composeExamplesReply(catalog);
    const reply = await withOptionalReplyPolish(polishKind, templateReply, params.message);
    return {
      reply,
      intent: detection.intent,
      confidence: detection.confidence,
      tool: null,
      fallbackReason: null,
    };
  }

  if (detection.intent === 'unsupported_action') {
    const actionIntent = await detectActionIntent(params.message);
    if (isHighConfidenceActionIntent(actionIntent) && actionIntent.fallbackReason !== 'missing_action_slots') {
      return {
        reply: composeActionHintReply(
          actionIntent.actionType === 'proveedor_pago_directo'
            ? 'proveedor_pago'
            : actionIntent.actionType === 'cliente_cobro_factura'
              ? 'cliente_cobro_factura'
              : actionIntent.actionType === 'cliente_cobro_directo'
                ? 'cliente_cobro'
                : 'stock_ajuste',
        ),
        intent: detection.intent,
        confidence: detection.confidence,
        tool: null,
        fallbackReason: detection.fallbackReason ?? null,
      };
    }
    const hintKind = detection.fallbackReason?.startsWith('action_hint_')
      ? (detection.fallbackReason.replace('action_hint_', '') as
          | 'proveedor_pago'
          | 'cliente_cobro'
          | 'cliente_cobro_factura'
          | 'stock_ajuste')
      : classifyActionPhrase(params.message);
    return {
      reply: hintKind
        ? composeActionHintReply(hintKind)
        : composeActionHintReply(null),
      intent: detection.intent,
      confidence: detection.confidence,
      tool: null,
      fallbackReason: detection.fallbackReason ?? null,
    };
  }

  if (detection.intent === 'unknown') {
    if (detection.fallbackReason === 'ambiguous_debt_scope') {
      return {
        reply: useV2
          ? composeAmbiguousDebtScopeReply(detection.targetName)
          : '¿Querés ver deuda de clientes (te deben) o deuda con proveedores (vos debés)? También puedo pasar reporte rápido de ambas.',
        intent: detection.intent,
        confidence: detection.confidence,
        tool: null,
        fallbackReason: detection.fallbackReason ?? null,
      };
    }
    if (detection.fallbackReason === 'ambiguous_product_selection') {
      return {
        reply:
          'Para evitar errores necesito el nombre o código exacto del producto. Ejemplo: "stock de Caja de Clavos (ABC-002)".',
        intent: detection.intent,
        confidence: detection.confidence,
        tool: null,
        fallbackReason: detection.fallbackReason ?? null,
      };
    }
    if (detection.fallbackReason === 'missing_target_name') {
      return {
        reply: useV2
          ? composeMissingTargetReply(String(detection.intent))
          : 'Me falta el nombre para ayudarte bien. Ejemplos: "cuánto le debo a proveedor Acme", "cuánto me debe cliente Juan", "stock de yerba Playadito".',
        intent: detection.intent,
        confidence: detection.confidence,
        tool: null,
        fallbackReason: detection.fallbackReason ?? null,
      };
    }
    if (detection.fallbackReason === 'generic_target_name') {
      return {
        reply: useV2
          ? composeGenericTargetReply(String(detection.intent))
          : 'Te entendí, pero me falta el dato clave para darte un número real. Decime el nombre o código exacto.',
        intent: detection.intent,
        confidence: detection.confidence,
        tool: null,
        fallbackReason: detection.fallbackReason ?? null,
      };
    }
    if (detection.fallbackReason === 'report_requested_without_scope') {
      return {
        reply: useV2
          ? composeReportScopeReply()
          : '¿Qué reporte querés? 1) ventas, 2) deuda de clientes, 3) deuda de proveedores, 4) stock general, 5) stock bajo.',
        intent: detection.intent,
        confidence: detection.confidence,
        tool: null,
        fallbackReason: detection.fallbackReason ?? null,
      };
    }
    const catalog = useV2
      ? await buildCapabilitiesCatalogForTenant({
          db,
          tenantId,
          rolWhatsapp: params.rolWhatsapp,
          channel: params.channel,
        })
      : undefined;
    const unknownTemplate = useV2
      ? composeUnknownCatalogReply(catalog)
      : 'Puedo ayudarte con: ventas, productos mas vendidos, deuda de proveedor, deuda de cliente, stock por producto, producto con menor stock y reportes (ventas, stock general, deuda clientes, deuda proveedores, stock bajo).';
    const reply = useV2
      ? await withOptionalReplyPolish('unknown_catalog', unknownTemplate, params.message)
      : unknownTemplate;
    return {
      reply,
      intent: detection.intent,
      confidence: detection.confidence,
      tool: null,
      fallbackReason: detection.fallbackReason ?? null,
    };
  }

  const modules = await getModuleConfig(db, tenantId);

  switch (detection.intent) {
    case 'proveedor_deuda': {
      if (!modules.stock) {
        return {
          reply: 'El módulo de stock/proveedores no está habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_stock',
        };
      }
      if (!detection.targetName) {
        const isGeneric = detection.fallbackReason === 'generic_target_name';
        return {
          reply: isGeneric
            ? composeGenericTargetReply('proveedor_deuda')
            : composeMissingTargetReply('proveedor_deuda'),
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: isGeneric ? 'generic_target_name' : 'missing_target_name',
        };
      }
      const target = validateEntityTargetName(detection.targetName, 'proveedor');
      if (!target.ok) {
        return {
          reply: target.error,
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'invalid_target_name',
        };
      }
      const tool = await runTracedTool('getProveedorDebt', { targetName: target.value }, () =>
        runProveedorDebtTool(db, tenantId, target.value),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getProveedorDebt',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'cliente_deuda': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El módulo de facturación/clientes no está habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      if (!detection.targetName) {
        const isGeneric = detection.fallbackReason === 'generic_target_name';
        return {
          reply: isGeneric
            ? composeGenericTargetReply('cliente_deuda')
            : composeMissingTargetReply('cliente_deuda'),
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: isGeneric ? 'generic_target_name' : 'missing_target_name',
        };
      }
      const target = validateEntityTargetName(detection.targetName, 'cliente');
      if (!target.ok) {
        return {
          reply: target.error,
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'invalid_target_name',
        };
      }
      const tool = await runTracedTool('getClienteDebt', { targetName: target.value }, () =>
        runClienteDebtTool(db, tenantId, target.value),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getClienteDebt',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'cliente_extracto_cc': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El modulo de facturacion/clientes no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      if (!detection.targetName) {
        const isGeneric = detection.fallbackReason === 'generic_target_name';
        return {
          reply: isGeneric
            ? composeGenericTargetReply('cliente_extracto_cc')
            : composeMissingTargetReply('cliente_extracto_cc'),
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: isGeneric ? 'generic_target_name' : 'missing_target_name',
        };
      }
      const target = validateEntityTargetName(detection.targetName, 'cliente');
      if (!target.ok) {
        return {
          reply: target.error,
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'invalid_target_name',
        };
      }
      const tool = await runTracedTool(
        'getClienteExtractoCc',
        { targetName: target.value, message: params.message },
        () => runClienteExtractoCcTool(db, tenantId, target.value, params.message),
      );
      const report = tool.value;
      return {
        reply: report.reply,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getClienteExtractoCc',
        toolTrace: tool.trace,
        fallbackReason: null,
        memoryOptions: report.memoryOptions,
      };
    }

    case 'cliente_contacto': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El modulo de facturacion/clientes no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      if (!detection.targetName) {
        const isGeneric = detection.fallbackReason === 'generic_target_name';
        return {
          reply: isGeneric
            ? composeGenericTargetReply('cliente_contacto')
            : composeMissingTargetReply('cliente_contacto'),
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: isGeneric ? 'generic_target_name' : 'missing_target_name',
        };
      }
      const target = validateEntityTargetName(detection.targetName, 'cliente');
      if (!target.ok) {
        return {
          reply: target.error,
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'invalid_target_name',
        };
      }
      const tool = await runTracedTool(
        'getClienteContact',
        { targetName: target.value, contactField: detection.contactField ?? 'contacto' },
        () => runClienteContactTool(db, tenantId, target.value, detection.contactField ?? 'contacto'),
      );
      const contact = tool.value;
      return {
        reply: contact.reply,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getClienteContact',
        toolTrace: tool.trace,
        fallbackReason: null,
        resolvedEntity: contact.resolvedName ? { type: 'cliente', name: contact.resolvedName } : null,
      };
    }

    case 'proveedor_contacto': {
      if (!modules.stock) {
        return {
          reply: 'El modulo de stock/proveedores no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_stock',
        };
      }
      if (!detection.targetName) {
        const isGeneric = detection.fallbackReason === 'generic_target_name';
        return {
          reply: isGeneric
            ? composeGenericTargetReply('proveedor_contacto')
            : composeMissingTargetReply('proveedor_contacto'),
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: isGeneric ? 'generic_target_name' : 'missing_target_name',
        };
      }
      const target = validateEntityTargetName(detection.targetName, 'proveedor');
      if (!target.ok) {
        return {
          reply: target.error,
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'invalid_target_name',
        };
      }
      const tool = await runTracedTool(
        'getProveedorContact',
        { targetName: target.value, contactField: detection.contactField ?? 'contacto' },
        () => runProveedorContactTool(db, tenantId, target.value, detection.contactField ?? 'contacto'),
      );
      const contact = tool.value;
      return {
        reply: contact.reply,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getProveedorContact',
        toolTrace: tool.trace,
        fallbackReason: null,
        resolvedEntity: contact.resolvedName ? { type: 'proveedor', name: contact.resolvedName } : null,
      };
    }

    case 'stock_producto': {
      if (!modules.stock) {
        return {
          reply: 'El módulo de stock no está habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_stock',
        };
      }
      if (!detection.targetName) {
        const isGeneric = detection.fallbackReason === 'generic_target_name';
        return {
          reply: isGeneric ? composeGenericTargetReply('stock_producto') : composeMissingTargetReply('stock_producto'),
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: isGeneric ? 'generic_target_name' : 'missing_target_name',
        };
      }
      const target = validateEntityTargetName(detection.targetName, 'producto');
      if (!target.ok) {
        return {
          reply: target.error,
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'invalid_target_name',
        };
      }
      const tool = await runTracedTool('getProductStock', { targetName: target.value }, () =>
        runStockProductoTool(db, tenantId, target.value),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getProductStock',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'stock_mas_bajo': {
      if (!modules.stock) {
        return {
          reply: 'El módulo de stock no está habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_stock',
        };
      }
      const tool = await runTracedTool('getProductLowestStock', {}, () => runStockMasBajoTool(db, tenantId));
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getProductLowestStock',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'reporte_ventas': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El modulo de facturacion/ventas no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      const periodRequest = detectSalesReportPeriodRequest(normalizeText(params.message));
      const tool = await runTracedTool('getReport:ventas', { periodRequest }, () =>
        runReporteVentasTool(db, tenantId, periodRequest),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:ventas',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'reporte_ventas_productos': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El modulo de facturacion/ventas no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      const periodRequest = detectSalesProductsReportPeriodRequest(normalizeText(params.message));
      const tool = await runTracedTool(
        'getReport:ventas_productos',
        { periodRequest },
        () => runReporteVentasProductosTool(db, tenantId, periodRequest),
      );
      const report = tool.value;
      return {
        reply: report.reply,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:ventas_productos',
        toolTrace: tool.trace,
        fallbackReason: null,
        memoryOptions: report.memoryOptions,
      };
    }

    case 'reporte_ventas_articulo': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El modulo de facturacion/ventas no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      if (!modules.analizador_rentabilidad) {
        return {
          reply:
            'El reporte de ventas por articulo (con margen estimado) requiere el modulo de analisis de rentabilidad.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_analizador',
        };
      }
      const tool = await runTracedTool('getReport:ventas_articulo', { message: params.message }, () =>
        runReporteVentasArticuloTool(db, tenantId, params.message),
      );
      const report = tool.value;
      return {
        reply: report.reply,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:ventas_articulo',
        toolTrace: tool.trace,
        fallbackReason: null,
        memoryOptions: report.memoryOptions,
      };
    }

    case 'reporte_ventas_clientes': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El modulo de facturacion/ventas no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      const periodRequest = detectSalesProductsReportPeriodRequest(normalizeText(params.message));
      const tool = await runTracedTool(
        'getReport:ventas_clientes',
        { periodRequest },
        () => runReporteVentasClientesTool(db, tenantId, periodRequest),
      );
      const report = tool.value;
      return {
        reply: report.reply,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:ventas_clientes',
        toolTrace: tool.trace,
        fallbackReason: null,
        memoryOptions: report.memoryOptions,
      };
    }

    case 'reporte_ganancias': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El modulo de facturacion/ventas no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      const periodRequest = detectSalesProductsReportPeriodRequest(normalizeText(params.message));
      const tool = await runTracedTool('getReport:ganancias', { periodRequest }, () =>
        runReporteGananciasTool(db, tenantId, periodRequest),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:ganancias',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'reporte_medios_pago': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El modulo de facturacion/ventas no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      const periodRequest = detectSalesReportPeriodRequest(normalizeText(params.message));
      const tool = await runTracedTool('getReport:medios_pago', { periodRequest }, () =>
        runReporteMediosPagoTool(db, tenantId, periodRequest),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:medios_pago',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'reporte_stock_general': {
      if (!modules.stock) {
        return {
          reply: 'El módulo de stock no está habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_stock',
        };
      }
      const tool = await runTracedTool('getReport:stock_general', { page: requestedReportPage }, () =>
        runReporteStockGeneralTool(db, tenantId, requestedReportPage),
      );
      const report = tool.value;
      return {
        reply: report.reply,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:stock_general',
        toolTrace: tool.trace,
        fallbackReason: null,
        reportContext: report.context,
      };
    }

    case 'reporte_deuda_clientes': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El módulo de facturación/clientes no está habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      const tool = await runTracedTool('getReport:clientes_deuda', { page: requestedReportPage }, () =>
        runReporteDeudaClientesTool(db, tenantId, requestedReportPage),
      );
      const report = tool.value;
      return {
        reply: report.reply,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:clientes_deuda',
        toolTrace: tool.trace,
        fallbackReason: null,
        reportContext: report.context,
        memoryOptions: report.memoryOptions,
      };
    }

    case 'reporte_deuda_proveedores': {
      if (!modules.stock) {
        return {
          reply: 'El módulo de stock/proveedores no está habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_stock',
        };
      }
      const tool = await runTracedTool('getReport:proveedores_deuda', { page: requestedReportPage }, () =>
        runReporteDeudaProveedoresTool(db, tenantId, requestedReportPage),
      );
      const report = tool.value;
      return {
        reply: report.reply,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:proveedores_deuda',
        toolTrace: tool.trace,
        fallbackReason: null,
        reportContext: report.context,
      };
    }

    case 'reporte_stock_bajo': {
      if (!modules.stock) {
        return {
          reply: 'El módulo de stock no está habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_stock',
        };
      }
      const tool = await runTracedTool('getReport:stock_bajo', { page: requestedReportPage }, () =>
        runReporteStockBajoTool(db, tenantId, requestedReportPage),
      );
      const report = tool.value;
      return {
        reply: report.reply,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:stock_bajo',
        toolTrace: tool.trace,
        fallbackReason: null,
        reportContext: report.context,
      };
    }

    case 'reporte_resumen': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El modulo de facturacion/ventas no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      const period = resolveWhatsAppReportPeriod(normalizeText(params.message), true);
      const tool = await runTracedTool('getReport:resumen', { period }, () =>
        runReporteResumenTool(db, tenantId, period),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:resumen',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'reporte_comparativo_ventas': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El modulo de facturacion/ventas no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      const periods = resolveWhatsAppComparativoPeriods(params.message);
      const tool = await runTracedTool('getReport:comparativo_ventas', { periods }, () =>
        runReporteComparativoVentasTool(db, tenantId, periods),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:comparativo_ventas',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'reporte_vencimientos': {
      if (!modules.stock) {
        return {
          reply: 'El módulo de stock no está habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_stock',
        };
      }
      const tool = await runTracedTool('getReport:vencimientos', {}, () =>
        runReporteVencimientosTool(db, tenantId),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:vencimientos',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'reporte_ventas_pos': {
      if (!modules.facturador_pos) {
        return {
          reply: 'El modulo POS no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_pos',
        };
      }
      const period = resolveWhatsAppReportPeriod(normalizeText(params.message));
      const parsedPosFilters = parseVentasPosReportFilters(params.message);
      let posFilters: VentasPosResolvedFilters = {};
      if (parsedPosFilters) {
        const resolvedPos = await resolveVentasPosReportFilters(db, tenantId, parsedPosFilters);
        if (!resolvedPos.ok) {
          return {
            reply: resolvedPos.reply,
            intent: detection.intent,
            confidence: detection.confidence,
            tool: null,
            fallbackReason: resolvedPos.fallbackReason,
          };
        }
        posFilters = resolvedPos.filters;
      }
      const tool = await runTracedTool(
        'getReport:ventas_consumidor',
        { period, filters: posFilters },
        () => runReporteVentasPosTool(db, tenantId, period, posFilters),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:ventas_consumidor',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'reporte_recibos': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El modulo de facturacion/ventas no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      const period = resolveWhatsAppReportPeriod(normalizeText(params.message), true);
      const tool = await runTracedTool('getReport:recibos', { period }, () =>
        runReporteRecibosTool(db, tenantId, period),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:recibos',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'reporte_libro_iva': {
      if (!modules.analizador_rentabilidad && !modules.facturador_simple) {
        return {
          reply: 'Los reportes fiscales no estan habilitados para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_analizador',
        };
      }
      const period = resolveWhatsAppReportPeriod(normalizeText(params.message), true);
      const tool = await runTracedTool('getReport:libro_iva', { period }, () =>
        runReporteLibroIvaTool(db, tenantId, period),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:libro_iva',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'reporte_gasto_proveedores': {
      if (!modules.analizador_rentabilidad && !modules.facturador_simple) {
        return {
          reply: 'Los reportes de rentabilidad no estan habilitados para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_analizador',
        };
      }
      const period = resolveWhatsAppReportPeriod(normalizeText(params.message), true);
      const tool = await runTracedTool('getReport:proveedores_gasto', { period }, () =>
        runReporteGastoProveedoresTool(db, tenantId, period),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:proveedores_gasto',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    case 'reporte_cierre_caja': {
      if (!modules.facturador_simple) {
        return {
          reply: 'El modulo de facturacion/ventas no esta habilitado para este negocio.',
          intent: detection.intent,
          confidence: detection.confidence,
          tool: null,
          fallbackReason: 'module_disabled_facturador_simple',
        };
      }
      const tool = await runTracedTool('getReport:cierre_caja', { message: params.message }, () =>
        runReporteCierreCajaTool(db, tenantId, params.message),
      );
      return {
        reply: tool.value,
        intent: detection.intent,
        confidence: detection.confidence,
        tool: 'getReport:cierre_caja',
        toolTrace: tool.trace,
        fallbackReason: null,
      };
    }

    default:
      return {
        reply:
          'Puedo ayudarte con ventas, productos mas vendidos, ventas por articulo (SKU/margen), deuda proveedor/cliente, extracto de cuenta corriente por cliente, datos de contacto de clientes, stock por producto, producto con menor stock, cierre de caja (arqueo) y reportes de stock general, deuda y stock bajo.',
        intent: 'unknown',
        confidence: 0.4,
        tool: null,
        fallbackReason: 'not_in_catalog',
      };
  }
}
