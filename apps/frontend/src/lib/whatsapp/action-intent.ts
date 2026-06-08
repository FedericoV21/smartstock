import { llamarGeminiTexto } from '@/lib/ia/gemini';
import { intentarParseObjetoJsonModelo } from '@/lib/ia/json-respuesta-ia';
import { llamarOpenRouterTexto, parseOpenRouterModelsList, tieneOpenRouterTextoConfigurado } from '@/lib/ia/openrouter';
import {
  classifyActionPhrase,
  parseClienteCobranzaFacturaRequest,
  parseClientePaymentRequest,
  parseProveedorPaymentRequest,
  parseStockAdjustmentRequest,
  type ClienteCobranzaFacturaRequest,
  type ClientePaymentRequest,
  type ProveedorPaymentRequest,
  type StockAdjustmentRequest,
} from '@/lib/whatsapp/action-parsers';
import { normalizeSafe } from '@/lib/whatsapp/tool-contracts';

export type ActionIntentType =
  | 'proveedor_pago_directo'
  | 'cliente_cobro_directo'
  | 'cliente_cobro_factura'
  | 'stock_ajuste_directo';

export type ActionIntentDetection = {
  actionType: ActionIntentType | null;
  proveedorNombre: string | null;
  clienteNombre: string | null;
  comprobanteRef: string | null;
  productoNombre: string | null;
  monto: number | null;
  cantidad: number | null;
  confidence: number;
  fallbackReason: string | null;
  source: 'rules' | 'llm' | 'none';
};

const LLM_TIMEOUT_MS = 8_000;

function normalizeText(input: string): string {
  return normalizeSafe(input);
}

function clampConfidence(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function shouldUseLlm(): boolean {
  const flag = normalizeText(process.env.WHATSAPP_AGENT_ACTION_INTENT_LLM ?? 'true');
  return !(flag === '0' || flag === 'false' || flag === 'no' || flag === 'off');
}

function resolveWhatsAppActionModels(): string[] | null {
  const single = process.env.WHATSAPP_AGENT_ACTION_INTENT_MODEL?.trim();
  if (single) return [single];
  const fromEnv = parseOpenRouterModelsList();
  return fromEnv.length > 0 ? fromEnv : null;
}

async function callOpenRouter(prompt: string): Promise<string | null> {
  return llamarOpenRouterTexto({
    messages: [{ role: 'user', content: prompt }],
    modelsOverride: resolveWhatsAppActionModels(),
    maxTokens: 300,
    timeoutMs: LLM_TIMEOUT_MS,
    jsonObject: true,
  });
}

function fromParsedRules(
  actionType: ActionIntentType,
  parsed:
    | ProveedorPaymentRequest
    | ClientePaymentRequest
    | ClienteCobranzaFacturaRequest
    | StockAdjustmentRequest,
): ActionIntentDetection {
  if ('proveedorNombre' in parsed) {
    return {
      actionType,
      proveedorNombre: parsed.proveedorNombre,
      clienteNombre: null,
      comprobanteRef: null,
      productoNombre: null,
      monto: parsed.monto,
      cantidad: null,
      confidence: 0.95,
      fallbackReason: null,
      source: 'rules',
    };
  }
  if ('comprobanteRef' in parsed) {
    return {
      actionType,
      proveedorNombre: null,
      clienteNombre: parsed.clienteNombre,
      comprobanteRef: parsed.comprobanteRef,
      productoNombre: null,
      monto: parsed.monto,
      cantidad: null,
      confidence: 0.95,
      fallbackReason: null,
      source: 'rules',
    };
  }
  if ('clienteNombre' in parsed) {
    return {
      actionType,
      proveedorNombre: null,
      clienteNombre: parsed.clienteNombre,
      comprobanteRef: null,
      productoNombre: null,
      monto: parsed.monto,
      cantidad: null,
      confidence: 0.95,
      fallbackReason: null,
      source: 'rules',
    };
  }
  return {
    actionType,
    proveedorNombre: null,
    clienteNombre: null,
    comprobanteRef: null,
    productoNombre: parsed.productoNombre,
    monto: null,
    cantidad: parsed.cantidad,
    confidence: 0.95,
    fallbackReason: null,
    source: 'rules',
  };
}

function detectByRules(rawText: string): ActionIntentDetection | null {
  const proveedor = parseProveedorPaymentRequest(rawText);
  if (proveedor) return fromParsedRules('proveedor_pago_directo', proveedor);

  const cobranzaFactura = parseClienteCobranzaFacturaRequest(rawText);
  if (cobranzaFactura) return fromParsedRules('cliente_cobro_factura', cobranzaFactura);

  const cliente = parseClientePaymentRequest(rawText);
  if (cliente) return fromParsedRules('cliente_cobro_directo', cliente);

  const stock = parseStockAdjustmentRequest(rawText);
  if (stock) return fromParsedRules('stock_ajuste_directo', stock);

  const text = normalizeText(rawText);
  const kind = classifyActionPhrase(rawText);
  if (!kind) return null;

  if (kind === 'proveedor_pago') {
    return {
      actionType: 'proveedor_pago_directo',
      proveedorNombre: null,
      clienteNombre: null,
      comprobanteRef: null,
      productoNombre: null,
      monto: null,
      cantidad: null,
      confidence: 0.72,
      fallbackReason: 'missing_action_slots',
      source: 'rules',
    };
  }
  if (kind === 'cliente_cobro_factura') {
    return {
      actionType: 'cliente_cobro_factura',
      proveedorNombre: null,
      clienteNombre: null,
      comprobanteRef: null,
      productoNombre: null,
      monto: null,
      cantidad: null,
      confidence: 0.72,
      fallbackReason: 'missing_action_slots',
      source: 'rules',
    };
  }
  if (kind === 'cliente_cobro') {
    return {
      actionType: 'cliente_cobro_directo',
      proveedorNombre: null,
      clienteNombre: null,
      comprobanteRef: null,
      productoNombre: null,
      monto: null,
      cantidad: null,
      confidence: 0.72,
      fallbackReason: 'missing_action_slots',
      source: 'rules',
    };
  }
  if (kind === 'stock_ajuste' && /\b(stock|inventario)\b/.test(text)) {
    return {
      actionType: 'stock_ajuste_directo',
      proveedorNombre: null,
      clienteNombre: null,
      comprobanteRef: null,
      productoNombre: null,
      monto: null,
      cantidad: null,
      confidence: 0.72,
      fallbackReason: 'missing_action_slots',
      source: 'rules',
    };
  }
  return null;
}

async function detectByLlm(rawText: string): Promise<ActionIntentDetection | null> {
  if (!shouldUseLlm()) return null;
  const prompt = [
    'Extraé la acción transaccional de WhatsApp para SmartStock.',
    'actionType permitidos: proveedor_pago_directo, cliente_cobro_directo, cliente_cobro_factura, stock_ajuste_directo, null.',
    'Campos: proveedorNombre, clienteNombre, comprobanteRef (numero o ultima), productoNombre, monto (numero positivo), cantidad (puede ser negativa para salida).',
    'Si falta entidad o monto/cantidad, dejá null y fallbackReason=missing_action_slots.',
    'Respondé solo JSON.',
    `Mensaje: """${rawText.trim()}"""`,
  ].join('\n');

  let raw: string | null = null;
  if (tieneOpenRouterTextoConfigurado()) {
    raw = await callOpenRouter(prompt);
  }
  if (!raw) {
    try {
      raw = await llamarGeminiTexto(prompt);
    } catch {
      raw = null;
    }
  }
  if (!raw && !tieneOpenRouterTextoConfigurado()) {
    raw = await callOpenRouter(prompt);
  }
  if (!raw) return null;

  const parsed = intentarParseObjetoJsonModelo(raw);
  if (!parsed || typeof parsed.data !== 'object' || parsed.data == null) return null;
  const obj = parsed.data as Record<string, unknown>;
  const actionRaw = normalizeText(String(obj.actionType ?? ''));
  let actionType: ActionIntentType | null = null;
  if (actionRaw === 'proveedor_pago_directo') actionType = 'proveedor_pago_directo';
  if (actionRaw === 'cliente_cobro_directo') actionType = 'cliente_cobro_directo';
  if (actionRaw === 'cliente_cobro_factura') actionType = 'cliente_cobro_factura';
  if (actionRaw === 'stock_ajuste_directo') actionType = 'stock_ajuste_directo';
  if (!actionType) return null;

  const monto = obj.monto != null ? Number(obj.monto) : null;
  const cantidad = obj.cantidad != null ? Number(obj.cantidad) : null;

  return {
    actionType,
    proveedorNombre: typeof obj.proveedorNombre === 'string' ? obj.proveedorNombre.trim() || null : null,
    clienteNombre: typeof obj.clienteNombre === 'string' ? obj.clienteNombre.trim() || null : null,
    comprobanteRef: typeof obj.comprobanteRef === 'string' ? obj.comprobanteRef.trim() || null : null,
    productoNombre: typeof obj.productoNombre === 'string' ? obj.productoNombre.trim() || null : null,
    monto: Number.isFinite(monto) && monto! > 0 ? Math.round(monto! * 100) / 100 : null,
    cantidad: Number.isFinite(cantidad) && cantidad !== 0 ? cantidad : null,
    confidence: clampConfidence(obj.confidence, 0.75),
    fallbackReason:
      typeof obj.fallbackReason === 'string' ? normalizeText(obj.fallbackReason).replace(/[^a-z0-9_]/g, '_') : null,
    source: 'llm',
  };
}

export async function detectActionIntent(rawText: string): Promise<ActionIntentDetection> {
  const rules = detectByRules(rawText);
  if (rules && rules.confidence >= 0.9 && !rules.fallbackReason) return rules;

  const llm = await detectByLlm(rawText);
  if (llm && llm.actionType) {
    if (rules && rules.actionType === llm.actionType && rules.confidence >= llm.confidence) {
      return rules;
    }
    return llm;
  }

  if (rules) return rules;

  return {
    actionType: null,
    proveedorNombre: null,
    clienteNombre: null,
    comprobanteRef: null,
    productoNombre: null,
    monto: null,
    cantidad: null,
    confidence: 0,
    fallbackReason: null,
    source: 'none',
  };
}

export function isHighConfidenceActionIntent(detection: ActionIntentDetection): boolean {
  return Boolean(detection.actionType && detection.confidence >= 0.7);
}
