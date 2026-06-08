export type AgentIntent =
  | 'proveedor_deuda'
  | 'cliente_deuda'
  | 'stock_producto'
  | 'reporte_resumen'
  | 'reporte_deuda_clientes'
  | 'reporte_deuda_proveedores'
  | 'assistant_greeting'
  | 'assistant_help'
  | 'unsupported_action'
  | 'unknown';

export type IntentDetection = {
  intent: AgentIntent;
  targetName: string | null;
  confidence: number;
  fallbackReason?: string;
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

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
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
    .replace(/\b(hoy|ahora|por favor|gracias)\b/gi, '')
    .replace(/[?.!,:;]+$/g, '')
    .trim();
}

function isResumenReportRequest(text: string): boolean {
  return (
    /\b(resumen|tablero|como\s+andamos|informe\s+comercial|kpis?)\b/.test(text) ||
    /\bcomo\s+venimos\b/.test(text)
  );
}

export function detectIntentByRules(rawText: string): IntentDetection {
  const text = normalizeText(rawText);
  if (!text) return { intent: 'unknown', targetName: null, confidence: 0.3, fallbackReason: 'empty' };

  if (/^(hola|hey|buenas|buen\s*dia|buenos\s*dias|buenas\s*tardes|buenas\s*noches)\b/.test(text)) {
    return { intent: 'assistant_greeting', targetName: null, confidence: 0.94 };
  }
  if (/\b(ayuda|help|menu|comandos|capacidades|que\s+podes?\s+hacer|que\s+puedo\s+hacer)\b/.test(text)) {
    return { intent: 'assistant_help', targetName: null, confidence: 0.94 };
  }

  if (ACTION_KEYWORDS.some((k) => text.includes(k))) {
    return {
      intent: 'unsupported_action',
      targetName: null,
      confidence: 0.95,
      fallbackReason: 'outside_read_only_catalog',
    };
  }

  const quoted = extractQuoted(rawText);

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

  if ((text.includes('deuda') || text.includes('debo')) && text.includes('proveedores')) {
    return { intent: 'reporte_deuda_proveedores', targetName: null, confidence: 0.86 };
  }

  if (
    (text.includes('reporte') || text.includes('resumen') || text.includes('informe')) &&
    (text.includes('cliente') || text.includes('deuda'))
  ) {
    return { intent: 'reporte_deuda_clientes', targetName: null, confidence: 0.85 };
  }

  if (/\b(informe\s+comercial|tablero\s+comercial|como\s+andamos)\b/.test(text)) {
    return { intent: 'reporte_resumen', targetName: null, confidence: 0.9 };
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
    return { intent: 'reporte_deuda_proveedores', targetName: null, confidence: 0.9 };
  }

  if (isResumenReportRequest(text)) {
    return { intent: 'reporte_resumen', targetName: null, confidence: 0.9 };
  }

  const stockMatch =
    !/\breporte\b/.test(text) &&
    (text.match(/(?:cuanto|cuanto)\s+(?:stock\s+)?tengo(?:\s+de)?\s+(.+)/) ||
      text.match(/stock(?:\s+de)?\s+(.+)/) ||
      text.match(/inventario(?:\s+de)?\s+(.+)/));
  if (stockMatch) {
    const target = stripTrailingContext(quoted ?? stockMatch[1] ?? '');
    return { intent: 'stock_producto', targetName: target || null, confidence: 0.85 };
  }

  return { intent: 'unknown', targetName: null, confidence: 0.4, fallbackReason: 'not_in_catalog' };
}
