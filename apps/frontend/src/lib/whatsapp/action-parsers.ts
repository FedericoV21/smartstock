import { normalizeSafe } from '@/lib/whatsapp/tool-contracts';

export type ProveedorPaymentRequest = { proveedorNombre: string; monto: number };
export type ClientePaymentRequest = { clienteNombre: string; monto: number };
export type ClienteCobranzaFacturaRequest = {
  clienteNombre: string;
  monto: number;
  comprobanteRef: string;
};
export type StockAdjustmentModo = 'delta' | 'fijar';

export type StockAdjustmentRequest = {
  productoNombre: string;
  cantidad: number;
  modo?: StockAdjustmentModo;
};

export type ParsedActionKind =
  | 'proveedor_pago'
  | 'cliente_cobro'
  | 'cliente_cobro_factura'
  | 'stock_ajuste'
  | null;

function normalizeText(input: string): string {
  return normalizeSafe(input);
}

export function parseAmount(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^\d.,+-]/g, '')
    .replace(/\.(?=\d{3}(?:[,.]|$))/g, '')
    .replace(',', '.');
  const negative = cleaned.startsWith('-');
  const positive = cleaned.replace(/^[-+]/, '');
  const n = Number(positive);
  if (!Number.isFinite(n) || n <= 0) return null;
  const value = Math.round(n * 100) / 100;
  return negative ? -value : value;
}

function cleanEntityName(value: string): string {
  return value.replace(/^["']|["']$/g, '').trim();
}

const AMOUNT_TAIL = String.raw`(\$?\s*[\d][\d.,\s]*(?:\s*(?:mil|k|lucas?|pesos?))?)\s*$`;
const AMOUNT_INLINE = String.raw`(\$?\s*[\d][\d.,\s]*(?:\s*(?:mil|k|lucas?|pesos?))?)`;

function parseAmountFlexible(raw: string): number | null {
  const lower = normalizeText(raw);
  if (/\b(?:lucas?|k)\b/.test(lower)) {
    const lucas = lower.match(/(\d+(?:[.,]\d+)?)/);
    if (lucas) {
      const n = parseAmount(lucas[1]);
      if (n != null) return n * 1000;
    }
  }
  if (/\bmil\b/.test(lower)) {
    const mil = lower.match(/(\d+(?:[.,]\d+)?)/);
    if (mil) {
      const n = parseAmount(mil[1]);
      if (n != null) return n * 1000;
    }
  }
  const n = parseAmount(raw);
  if (n != null) return n;
  return null;
}

function tryProveedorPatterns(rawText: string): ProveedorPaymentRequest | null {
  const text = rawText.trim();
  const entityThenAmount: RegExp[] = [
    new RegExp(
      String.raw`(?:registrar\s+pago|pagar|pague|abone|abonar|transferi|transferir)\s+(?:al?\s+)?proveedor\s+(.+?)\s+${AMOUNT_TAIL}`,
      'i',
    ),
    new RegExp(String.raw`pago\s+(?:al?\s+)?proveedor\s+(.+?)\s+${AMOUNT_TAIL}`, 'i'),
  ];
  for (const re of entityThenAmount) {
    const match = text.match(re);
    if (!match) continue;
    const proveedorNombre = cleanEntityName(match[1]);
    const monto = parseAmountFlexible(String(match[2]));
    if (proveedorNombre && monto != null && monto > 0) {
      return { proveedorNombre, monto };
    }
  }
  const amountThenEntity: RegExp[] = [
    new RegExp(
      String.raw`(?:registrar\s+pago|pagar|pague|abone|abonar)\s+${AMOUNT_INLINE}\s+(?:al?\s+)?proveedor\s+(.+?)\s*$`,
      'i',
    ),
    new RegExp(String.raw`(?:le\s+)?pague\s+${AMOUNT_INLINE}\s+(?:al?\s+)?proveedor\s+(.+?)\s*$`, 'i'),
  ];
  for (const re of amountThenEntity) {
    const match = text.match(re);
    if (!match) continue;
    const monto = parseAmountFlexible(String(match[1]));
    const proveedorNombre = cleanEntityName(match[2]);
    if (proveedorNombre && monto != null && monto > 0) {
      return { proveedorNombre, monto };
    }
  }
  return null;
}

const COMPROBANTE_REF = String.raw`(ultima|última|\d{1,4}\s*-\s*\d{1,8}|\d{1,8})`;

function normalizeComprobanteRef(raw: string): string {
  const clean = cleanEntityName(raw);
  if (normalizeText(clean) === 'ultima') return 'ultima';
  return clean.replace(/\s+/g, '');
}

function tryClienteCobranzaFacturaPatterns(rawText: string): ClienteCobranzaFacturaRequest | null {
  const text = rawText.trim();

  const ultima = text.match(
    new RegExp(
      String.raw`(?:cobr(?:ar|e)|registrar\s+cobro)\s+(?:la\s+)?ultima\s+(?:factura|ticket)\s+(?:del?\s+)?(?:cliente\s+)?(.+?)\s+${AMOUNT_TAIL}`,
      'i',
    ),
  );
  if (ultima) {
    const clienteNombre = cleanEntityName(ultima[1]);
    const monto = parseAmountFlexible(String(ultima[2]));
    if (clienteNombre && monto != null && monto > 0) {
      return { clienteNombre, monto, comprobanteRef: 'ultima' };
    }
  }

  const refClienteMonto = text.match(
    new RegExp(
      String.raw`(?:cobr(?:ar|e)|registrar\s+cobro)\s+(?:la\s+)?(?:factura|ticket)\s+${COMPROBANTE_REF}\s+(?:del?\s+)?(?:cliente\s+)?(.+?)\s+${AMOUNT_TAIL}`,
      'i',
    ),
  );
  if (refClienteMonto) {
    const comprobanteRef = normalizeComprobanteRef(refClienteMonto[1]);
    const clienteNombre = cleanEntityName(refClienteMonto[2]);
    const monto = parseAmountFlexible(String(refClienteMonto[3]));
    if (clienteNombre && comprobanteRef && monto != null && monto > 0) {
      return { clienteNombre, monto, comprobanteRef };
    }
  }

  const montoRefCliente = text.match(
    new RegExp(
      String.raw`(?:cobr(?:ar|e)|registrar\s+cobro)\s+${AMOUNT_INLINE}\s+(?:de\s+la\s+)?(?:factura|ticket)\s+${COMPROBANTE_REF}\s+(?:del?\s+)?(?:cliente\s+)?(.+?)\s*$`,
      'i',
    ),
  );
  if (montoRefCliente) {
    const monto = parseAmountFlexible(String(montoRefCliente[1]));
    const comprobanteRef = normalizeComprobanteRef(montoRefCliente[2]);
    const clienteNombre = cleanEntityName(montoRefCliente[3]);
    if (clienteNombre && comprobanteRef && monto != null && monto > 0) {
      return { clienteNombre, monto, comprobanteRef };
    }
  }

  const clienteRefMonto = text.match(
    new RegExp(
      String.raw`(?:cobr(?:ar|e)|registrar\s+cobro)\s+(?:a\s+)?cliente\s+(.+?)\s+(?:factura|ticket)\s+${COMPROBANTE_REF}\s+${AMOUNT_TAIL}`,
      'i',
    ),
  );
  if (clienteRefMonto) {
    const clienteNombre = cleanEntityName(clienteRefMonto[1]);
    const comprobanteRef = normalizeComprobanteRef(clienteRefMonto[2]);
    const monto = parseAmountFlexible(String(clienteRefMonto[3]));
    if (clienteNombre && comprobanteRef && monto != null && monto > 0) {
      return { clienteNombre, monto, comprobanteRef };
    }
  }

  return null;
}

function tryClientePatterns(rawText: string): ClientePaymentRequest | null {
  const text = rawText.trim();
  const entityThenAmount: RegExp[] = [
    new RegExp(
      String.raw`(?:registrar\s+cobro|cobrar|cobre|cobrale|cobrarle)\s+(?:a\s+)?cliente\s+(.+?)\s+${AMOUNT_TAIL}`,
      'i',
    ),
    new RegExp(String.raw`cobro\s+(?:a\s+)?cliente\s+(.+?)\s+${AMOUNT_TAIL}`, 'i'),
  ];
  for (const re of entityThenAmount) {
    const match = text.match(re);
    if (!match) continue;
    const clienteNombre = cleanEntityName(match[1]);
    const monto = parseAmountFlexible(String(match[2]));
    if (clienteNombre && monto != null && monto > 0) {
      return { clienteNombre, monto };
    }
  }
  const amountThenEntity: RegExp[] = [
    new RegExp(
      String.raw`(?:registrar\s+cobro|cobrar|cobre)\s+${AMOUNT_INLINE}\s+(?:a\s+)?cliente\s+(.+?)\s*$`,
      'i',
    ),
    new RegExp(String.raw`(?:le\s+)?cobre\s+${AMOUNT_INLINE}\s+(?:a\s+)?cliente\s+(.+?)\s*$`, 'i'),
  ];
  for (const re of amountThenEntity) {
    const match = text.match(re);
    if (!match) continue;
    const monto = parseAmountFlexible(String(match[1]));
    const clienteNombre = cleanEntityName(match[2]);
    if (clienteNombre && monto != null && monto > 0) {
      return { clienteNombre, monto };
    }
  }
  return null;
}

function tryStockSetTargetPatterns(rawText: string): StockAdjustmentRequest | null {
  const text = rawText.trim();
  const patterns: RegExp[] = [
    new RegExp(
      String.raw`(?:podrias?|podes?|puedes?|quiero\s+)?(?:cambiar|dejar|poner|llevar|actualizar)\s+(?:el\s+)?stock\s+(?:de\s+)?(.+?)\s+a\s+([\d.,]+)\s*$`,
      'i',
    ),
    new RegExp(
      String.raw`(?:cambiar|dejar|poner|llevar|actualizar)\s+(?:el\s+)?stock\s+(?:de\s+)?(.+?)\s+en\s+([\d.,]+)\s*$`,
      'i',
    ),
    new RegExp(String.raw`stock\s+(?:de\s+)?(.+?)\s+(?:a|en)\s+([\d.,]+)\s*$`, 'i'),
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (!match) continue;
    const productoNombre = cleanEntityName(match[1]);
    const target = parseAmountFlexible(match[2]);
    if (!productoNombre || target == null || target < 0) continue;
    return { productoNombre, cantidad: target, modo: 'fijar' };
  }
  return null;
}

function tryStockDeltaPatterns(rawText: string): StockAdjustmentRequest | null {
  const text = rawText.trim();
  const patterns: RegExp[] = [
    new RegExp(String.raw`(?:ajustar\s+stock|ajuste\s+de\s+stock|ajuste\s+stock)\s+(.+?)\s+([+-]?\s*[\d.,]+)\s*$`, 'i'),
    new RegExp(
      String.raw`(?:sumar|restar|ingreso|salida)\s+(?:de\s+)?stock\s+(.+?)\s+([+-]?\s*[\d.,]+)\s*$`,
      'i',
    ),
    new RegExp(String.raw`stock\s+(.+?)\s+([+-]\s*[\d.,]+)\s*$`, 'i'),
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (!match) continue;
    const productoNombre = cleanEntityName(match[1]);
    const signedText = match[2].replace(/\s+/g, '');
    const negative = signedText.startsWith('-');
    const absAmount = parseAmountFlexible(signedText.replace(/^[-+]/, ''));
    if (!productoNombre || absAmount == null) continue;
    const signed = negative ? -Math.abs(absAmount) : absAmount;
    if (signed === 0) continue;
    return { productoNombre, cantidad: signed, modo: 'delta' };
  }
  return null;
}

function tryStockPatterns(rawText: string): StockAdjustmentRequest | null {
  return tryStockSetTargetPatterns(rawText) ?? tryStockDeltaPatterns(rawText);
}

export function parseProveedorPaymentRequest(rawText: string): ProveedorPaymentRequest | null {
  return tryProveedorPatterns(rawText);
}

export function parseClientePaymentRequest(rawText: string): ClientePaymentRequest | null {
  return tryClientePatterns(rawText);
}

export function parseClienteCobranzaFacturaRequest(rawText: string): ClienteCobranzaFacturaRequest | null {
  return tryClienteCobranzaFacturaPatterns(rawText);
}

export function parseStockAdjustmentRequest(rawText: string): StockAdjustmentRequest | null {
  return tryStockPatterns(rawText);
}

export function classifyActionPhrase(rawText: string): ParsedActionKind {
  if (parseProveedorPaymentRequest(rawText)) return 'proveedor_pago';
  if (parseClienteCobranzaFacturaRequest(rawText)) return 'cliente_cobro_factura';
  if (parseClientePaymentRequest(rawText)) return 'cliente_cobro';
  if (parseStockAdjustmentRequest(rawText)) return 'stock_ajuste';
  const text = normalizeText(rawText);
  if (
    (/\b(pagar|pague|abonar|abone|transferi|registrar\s+pago)\b/.test(text) ||
      /\bregistrar\s+pago\b/.test(text)) &&
    /\bproveedor\b/.test(text)
  ) {
    return 'proveedor_pago';
  }
  if (
    (/\b(cobrar|cobre|cobranza|registrar\s+cobro)\b/.test(text) || /\bregistrar\s+cobro\b/.test(text)) &&
    /\b(factura|ticket)\b/.test(text)
  ) {
    return 'cliente_cobro_factura';
  }
  if (
    (/\b(cobrar|cobre|cobranza|registrar\s+cobro)\b/.test(text) || /\bregistrar\s+cobro\b/.test(text)) &&
    /\bcliente\b/.test(text)
  ) {
    return 'cliente_cobro';
  }
  if (/\b(ajustar\s+stock|ajuste\s+stock|sumar\s+stock|restar\s+stock|registrar\s+movimiento)\b/.test(text)) {
    return 'stock_ajuste';
  }
  return null;
}

export function composeActionHintReply(kind: ParsedActionKind): string {
  if (kind === 'proveedor_pago') {
    return [
      'Para registrar un pago a proveedor con confirmación, usá una frase como:',
      '• registrar pago proveedor Arcor 50000',
      '• pagar proveedor Ginkgo $12.500',
      '• pague 10 lucas al proveedor Coca',
      'Te voy a pedir confirmación con un código de 4 dígitos antes de ejecutar.',
    ].join('\n');
  }
  if (kind === 'cliente_cobro') {
    return [
      'Para registrar un cobro de cliente con confirmación, usá una frase como:',
      '• registrar cobro cliente Juan Perez 15000',
      '• cobrar a cliente Kiosco Centro 2500',
      '• cobre 5 lucas al cliente Maria Lopez',
      'Te voy a pedir confirmación con un código de 4 dígitos antes de ejecutar.',
    ].join('\n');
  }
  if (kind === 'cliente_cobro_factura') {
    return [
      'Para cobrar una factura o ticket puntual con confirmación, usá una frase como:',
      '• cobrar factura 42 cliente Juan Perez 15000',
      '• cobrar ultima factura cliente Kiosco Centro 2500',
      '• cobrar 5 lucas factura 0001-00000012 de cliente Maria Lopez',
      'Te voy a pedir confirmación con un código de 4 dígitos antes de ejecutar.',
    ].join('\n');
  }
  if (kind === 'stock_ajuste') {
    return [
      'Para ajustar stock con confirmación, usá una frase como:',
      '• ajustar stock Yerba Playadito 1kg +10',
      '• cambiar stock Producto X a 200',
      '• sumar stock producto ABC-001 5',
      'Te voy a pedir confirmación con un código de 4 dígitos antes de ejecutar.',
    ].join('\n');
  }
  return [
    'Este canal también puede ejecutar acciones con doble confirmación:',
    '• pagos a proveedores',
    '• cobros a clientes (cuenta corriente)',
    '• cobros imputados a una factura/ticket',
    '• ajustes de stock',
    'Ejemplo: registrar pago proveedor Arcor 10000',
  ].join('\n');
}
