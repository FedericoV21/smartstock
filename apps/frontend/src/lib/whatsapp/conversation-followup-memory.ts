import type { WhatsAppConversationState } from '@/lib/whatsapp/conversation-memory';

type DisambiguationKind =
  | 'proveedor'
  | 'cliente'
  | 'cliente_contacto'
  | 'cliente_contacto_telefono'
  | 'cliente_contacto_email'
  | 'cliente_contacto_direccion'
  | 'proveedor_contacto'
  | 'proveedor_contacto_telefono'
  | 'proveedor_contacto_email'
  | 'proveedor_contacto_direccion'
  | 'producto';

type EntityContactField = 'telefono' | 'email' | 'direccion' | 'contacto';

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function selectionIndexFromReply(reply: string, optionCount: number): number | null {
  const text = normalizeText(reply);
  const direct = text.match(/^(?:opcion\s*)?(\d{1,2})$/);
  if (direct) {
    const idx = Number(direct[1]) - 1;
    if (idx >= 0 && idx < optionCount) return idx;
  }

  if (/^(?:el|la)?\s*primer[oa]$/.test(text) && optionCount >= 1) return 0;
  if (/^(?:el|la)?\s*segund[oa]$/.test(text) && optionCount >= 2) return 1;
  if (/^(?:el|la)?\s*tercer[oa]$/.test(text) && optionCount >= 3) return 2;
  if (/^(?:el|la)?\s*cuart[oa]$/.test(text) && optionCount >= 4) return 3;
  if (/^(?:el|la)?\s*quint[oa]$/.test(text) && optionCount >= 5) return 4;

  return null;
}

function resolveOptionByName(reply: string, options: string[]): string | null {
  const text = normalizeText(reply);
  if (text.length < 3) return null;
  const exact = options.find((opt) => normalizeText(opt) === text);
  if (exact) return exact;
  const partial = options.find((opt) => normalizeText(opt).includes(text));
  if (partial) return partial;
  return null;
}

function buildClarifiedQuery(kind: DisambiguationKind, option: string): string {
  if (kind === 'proveedor') return `cuanto le debo a ${option}`;
  if (kind === 'cliente') return `cuanto me debe ${option}`;
  if (kind === 'cliente_contacto_telefono') return `telefono de cliente ${option}`;
  if (kind === 'cliente_contacto_email') return `email de cliente ${option}`;
  if (kind === 'cliente_contacto_direccion') return `direccion de cliente ${option}`;
  if (kind === 'cliente_contacto') return `datos de contacto de cliente ${option}`;
  if (kind === 'proveedor_contacto_telefono') return `telefono de proveedor ${option}`;
  if (kind === 'proveedor_contacto_email') return `email de proveedor ${option}`;
  if (kind === 'proveedor_contacto_direccion') return `direccion de proveedor ${option}`;
  if (kind === 'proveedor_contacto') return `datos de contacto de proveedor ${option}`;
  const cleaned = option.replace(/\s+\([^)]*\)\s*$/, '').trim();
  return `stock de ${cleaned || option}`;
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

function isProviderScopeMessage(text: string): boolean {
  return /^(proveedor|proveedores|con proveedores|de proveedores|yo debo|debo)$/i.test(text);
}

function isClientScopeMessage(text: string): boolean {
  return /^(cliente|clientes|de clientes|me deben|me debe)$/i.test(text);
}

const REPORT_MONTH_NAMES = [
  'enero',
  'ene',
  'febrero',
  'feb',
  'marzo',
  'mar',
  'abril',
  'abr',
  'mayo',
  'may',
  'junio',
  'jun',
  'julio',
  'jul',
  'agosto',
  'ago',
  'septiembre',
  'setiembre',
  'sep',
  'set',
  'octubre',
  'oct',
  'noviembre',
  'nov',
  'diciembre',
  'dic',
] as const;

const REPORT_MONTH_PATTERN = REPORT_MONTH_NAMES.join('|');

function reportPeriodSuffixFromText(text: string): string | null {
  if (/\bhoy\b/.test(text)) return 'hoy';
  if (/\bayer\b/.test(text)) return 'ayer';
  if (/\b(?:esta\s+)?semana\b|\bsemanal\b/.test(text)) return 'esta semana';
  if (/\bmes\s+(?:anterior|pasado)\b/.test(text)) return 'mes anterior';
  if (/\b(?:este\s+)?mes\b|\bmensual\b/.test(text)) return 'este mes';
  const month = text.match(new RegExp(`\\b(${REPORT_MONTH_PATTERN})(?:\\s+\\d{4})?\\b`));
  return month?.[0] ?? null;
}

function reportScopeMessageFromText(text: string): string | null {
  const clean = text
    .replace(/^(?:y|ahora|tambien|despues|luego|por ultimo|finalmente)\s+/, '')
    .replace(/^(?:del?|de\s+la)\s+/, '')
    .replace(/[?.!]+$/g, '')
    .trim();
  const period = reportPeriodSuffixFromText(clean);

  if (/\b(?:productos?|articulos?|items?|sku)\b/.test(clean) && /\b(?:mas\s+)?vendidos?\b/.test(clean)) {
    return period ? `productos mas vendidos ${period}` : 'productos mas vendidos';
  }
  if (/^(?:mas\s+vendidos|ranking\s+(?:de\s+)?productos?|top\s+(?:productos?|ventas))/.test(clean)) {
    return period ? `productos mas vendidos ${period}` : 'productos mas vendidos';
  }
  if (
    /\bclientes?\b/.test(clean) &&
    (/\b(?:mas|top|ranking|mejores|principales|mayor)\b/.test(clean) ||
      /\bventas?\s+por\s+clientes?\b/.test(clean)) &&
    /\b(?:compraron|compras|ventas?|facturacion|facturado|clientes?)\b/.test(clean)
  ) {
    return period ? `clientes que mas compraron ${period}` : 'clientes que mas compraron';
  }
  if (/\bventas?\s+por\s+clientes?\b/.test(clean) || /\bclientes?\s+que\s+mas\s+(?:compraron|compran)\b/.test(clean)) {
    return period ? `clientes que mas compraron ${period}` : 'clientes que mas compraron';
  }
  if (/\b(?:ganancia|ganancias|margen|rentabilidad|utilidad|utilidades)\b/.test(clean)) {
    return period ? `ganancia ${period}` : 'ganancia este mes';
  }
  if (
    /\b(?:medios?|metodos?|formas?)\s+de\s+pago\b/.test(clean) ||
    /\bventas?\s+por\s+(?:medio|metodo|forma)\s+de\s+pago\b/.test(clean)
  ) {
    return period ? `medios de pago ${period}` : 'medios de pago hoy';
  }
  if (
    /\b(?:ventas?|venta|facturacion|facturado|recaudacion|ingresos)\b/.test(clean) &&
    !/\b(?:productos?|articulos?|items?|sku)\b/.test(clean)
  ) {
    return period ? `ventas ${period}` : 'ventas hoy';
  }
  if (/^(?:stock|inventario|stock general|inventario general|productos)$/.test(clean)) {
    return 'reporte stock general';
  }
  if (
    /^(?:stock bajo|bajo stock|stock critico|stock en rojo|faltantes?|reposicion|reposicion de stock)$/.test(
      clean,
    )
  ) {
    return 'reporte stock bajo';
  }
  if (/\bstock\s+criticos?\b/.test(clean) || /\bcriticos?\s+(?:de|por)\s+stock\b/.test(clean)) {
    return 'reporte stock bajo';
  }
  if (/^(?:clientes|cliente|deuda clientes|de clientes|me deben)$/.test(clean)) {
    return 'reporte deuda clientes';
  }
  if (/^(?:proveedores|proveedor|deuda proveedores|de proveedores|debo|yo debo)$/.test(clean)) {
    return 'reporte deuda proveedores';
  }
  return null;
}

export function extractDebtFollowupTarget(rawText: string): string | null {
  const text = rawText.trim();
  if (!text) return null;

  const patterns = [
    /(?:pasame|decime|dime)?\s*(?:la\s+)?deuda\s+de\s+(.+)/i,
    /(?:cuanto|cuánto)\s+es\s+(?:la\s+)?deuda\s+de\s+(.+)/i,
    /saldo\s+de\s+(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const target = stripTrailingContext(match?.[1] ?? '');
    if (target) return target;
  }
  return null;
}

type ClienteContactField = 'telefono' | 'email' | 'direccion' | 'contacto';

function detectClienteContactField(text: string): EntityContactField | null {
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

function buildClienteContactQuery(field: EntityContactField, clienteName: string): string {
  if (field === 'telefono') return `telefono de cliente ${clienteName}`;
  if (field === 'email') return `email de cliente ${clienteName}`;
  if (field === 'direccion') return `direccion de cliente ${clienteName}`;
  return `datos de contacto de cliente ${clienteName}`;
}

function buildProveedorContactQuery(field: EntityContactField, proveedorName: string): string {
  if (field === 'telefono') return `telefono de proveedor ${proveedorName}`;
  if (field === 'email') return `email de proveedor ${proveedorName}`;
  if (field === 'direccion') return `direccion de proveedor ${proveedorName}`;
  return `datos de contacto de proveedor ${proveedorName}`;
}

function selectionIndexMentionedFromText(text: string, optionCount: number): number | null {
  const direct = selectionIndexFromReply(text, optionCount);
  if (direct != null) return direct;
  const normalized = normalizeText(text);
  if (/\b(primer[oa]|1)\b/.test(normalized) && optionCount >= 1) return 0;
  if (/\b(segund[oa]|2)\b/.test(normalized) && optionCount >= 2) return 1;
  if (/\b(tercer[oa]|3)\b/.test(normalized) && optionCount >= 3) return 2;
  if (/\b(cuart[oa]|4)\b/.test(normalized) && optionCount >= 4) return 3;
  if (/\b(quint[oa]|5)\b/.test(normalized) && optionCount >= 5) return 4;
  return null;
}

function extractProveedorContactTarget(rawText: string): string | null {
  const text = normalizeText(rawText);
  const patterns = [
    /(?:datos?\s+de\s+contacto|contacto)\s+(?:del?\s+proveedor\s+|de\s+proveedor\s+)(.+)/,
    /(?:numero\s+de\s+telefono|nro\s+de\s+telefono|telefono|tel|celular|whatsapp|numero|nro)\s+(?:del?\s+proveedor\s+|de\s+proveedor\s+|proveedor\s+)(.+)/,
    /(?:mail|email|e-mail|correo)\s+(?:del?\s+proveedor\s+|de\s+proveedor\s+|proveedor\s+)(.+)/,
    /(?:direccion|domicilio)\s+(?:del?\s+proveedor\s+|de\s+proveedor\s+|proveedor\s+)(.+)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const target = stripTrailingContext(match?.[1] ?? '')
      .replace(/^(?:del?\s+)?proveedor\s+/i, '')
      .replace(/^proveedor\s+/i, '')
      .trim();
    if (target) return target;
  }
  return null;
}

function extractClienteContactTarget(rawText: string): string | null {
  const text = normalizeText(rawText);
  const patterns = [
    /(?:datos?\s+de\s+contacto|contacto)\s+(?:del?\s+cliente\s+|de\s+cliente\s+|del?\s+|de\s+)?(.+)/,
    /(?:numero\s+de\s+telefono|nro\s+de\s+telefono|telefono|tel|celular|whatsapp|numero|nro)\s+(?:del?\s+cliente\s+|de\s+cliente\s+|del?\s+|de\s+)?(.+)/,
    /(?:mail|email|e-mail|correo)\s+(?:del?\s+cliente\s+|de\s+cliente\s+|del?\s+|de\s+)?(.+)/,
    /(?:direccion|domicilio)\s+(?:del?\s+cliente\s+|de\s+cliente\s+|del?\s+|de\s+)?(.+)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const target = stripTrailingContext(match?.[1] ?? '')
      .replace(/^(?:del?\s+)?cliente\s+/i, '')
      .replace(/^cliente\s+/i, '')
      .trim();
    if (target) return target;
  }
  return null;
}

function isReportContinueMessage(text: string): boolean {
  return /^(segui|sigue|siguiente|mas|más|mostrame mas|mostrame más|continua|continuar)$/i.test(text);
}

function isAffirmativeOfferedReportMessage(text: string): boolean {
  const clean = text
    .replace(/[?.!,;:]+/g, ' ')
    .replace(/\b(?:porfa|por\s+favor|gracias)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return true;
  if (
    /\b(stock|deuda|ventas?|cliente|clientes|proveedor|proveedores|producto|productos|ganancia|pago)\b/.test(
      clean,
    )
  ) {
    return false;
  }

  const affirmativeOnly = /^(?:si|dale|ok|okay|bueno|listo|perfecto|de una)$/.test(clean);
  if (affirmativeOnly) return true;

  const startsAffirmative = /^(?:si|dale|ok|okay|bueno|listo|perfecto|de una)\b/.test(clean);
  const requestsOfferedReport = /\b(?:pasame|mandame|enviame|envialo|mostrame|dame|reporte|informe|eso|tambien)\b/.test(
    clean,
  );
  const startsRequest = /^(?:pasame|mandame|enviame|envialo|mostrame|dame)\b/.test(clean);
  return clean.length <= 60 && ((startsAffirmative && requestsOfferedReport) || startsRequest);
}

function reportContinueMessageFromState(state: WhatsAppConversationState): string | null {
  if (!state.lastReportKey) return null;
  const nextPage = Math.max(2, (state.lastReportPage ?? 1) + 1);
  if (state.lastReportKey === 'stock_general') return `reporte stock general pagina ${nextPage}`;
  if (state.lastReportKey === 'stock_bajo') return `reporte stock bajo pagina ${nextPage}`;
  if (state.lastReportKey === 'deuda_clientes') return `reporte deuda clientes pagina ${nextPage}`;
  if (state.lastReportKey === 'deuda_proveedores') return `reporte deuda proveedores pagina ${nextPage}`;
  return null;
}

function salesFollowupPrefix(lastIntent: string | null): string {
  if (lastIntent === 'reporte_ventas_productos') return 'productos mas vendidos';
  if (lastIntent === 'reporte_ventas_articulo') return 'ventas por articulo';
  if (lastIntent === 'reporte_ventas_clientes') return 'clientes que mas compraron';
  if (lastIntent === 'reporte_ganancias') return 'ganancia';
  if (lastIntent === 'reporte_medios_pago') return 'medios de pago';
  if (lastIntent === 'reporte_resumen') return 'resumen del mes';
  if (lastIntent === 'reporte_ventas_pos') return 'ventas pos';
  if (lastIntent === 'reporte_recibos') return 'recibos del mes';
  if (lastIntent === 'reporte_comparativo_ventas') return 'comparativo ventas';
  return 'ventas';
}

function salesFollowupMessageFromText(normalized: string, lastIntent: string | null): string | null {
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
  if (new RegExp(`^(?:${REPORT_MONTH_PATTERN})(?:\\s+\\d{4})?$`).test(clean)) return `${prefix} ${clean}`;
  if (/^ventas?$/.test(clean)) return 'ventas hoy';
  if (/^(?:productos?|articulos?)\s+(?:mas\s+)?vendidos?$/.test(clean)) return 'productos mas vendidos';
  if (/^(?:clientes?\s+que\s+mas\s+compraron|ventas?\s+por\s+clientes?|mejores\s+clientes?)$/.test(clean))
    return 'clientes que mas compraron';
  if (/^(?:ganancia|ganancias|margen|rentabilidad|utilidad|utilidades)$/.test(clean)) return 'ganancia este mes';
  if (/^(?:medios?|metodos?|formas?)\s+de\s+pago$/.test(clean)) return 'medios de pago hoy';
  return null;
}

function disambiguationKindFromLastIntent(lastIntent: string | null): DisambiguationKind | null {
  if (lastIntent === 'proveedor_deuda') return 'proveedor';
  if (
    lastIntent === 'cliente_deuda' ||
    lastIntent === 'cliente_extracto_cc' ||
    lastIntent === 'reporte_deuda_clientes'
  )
    return 'cliente';
  if (lastIntent === 'cliente_contacto') return 'cliente_contacto';
  if (lastIntent === 'proveedor_contacto') return 'proveedor_contacto';
  if (lastIntent === 'stock_producto') return 'producto';
  return null;
}

export function resolveFollowupFromConversationMemory(params: {
  text: string;
  state: WhatsAppConversationState | null;
}): { message: string; interpreted: boolean } {
  const { text, state } = params;
  if (!state) return { message: text, interpreted: false };

  const normalized = normalizeText(text);
  if (!normalized) return { message: text, interpreted: false };

  if (state.pendingPrompt === 'report_scope') {
    const reportScope = reportScopeMessageFromText(normalized);
    if (reportScope) return { message: reportScope, interpreted: true };
  }

  if (state.lastIntent?.startsWith('reporte_')) {
    const reportScope = reportScopeMessageFromText(normalized);
    if (reportScope) return { message: reportScope, interpreted: true };
  }

  const contactField = detectClienteContactField(normalized);
  if (contactField) {
    const hasProveedorKw = /\bproveedor(?:es)?\b/.test(normalized);
    const proveedorTarget = extractProveedorContactTarget(text);
    const clienteTarget = extractClienteContactTarget(text);
    const useProveedor =
      hasProveedorKw ||
      state.lastEntityType === 'proveedor' ||
      state.topic === 'deuda_proveedores' ||
      (proveedorTarget && !clienteTarget && !/\bcliente(?:s)?\b/.test(normalized));

    if (state.lastOptions.length > 0) {
      const idx = selectionIndexMentionedFromText(text, state.lastOptions.length);
      if (idx != null && idx >= 0 && idx < state.lastOptions.length) {
        return {
          message: useProveedor
            ? buildProveedorContactQuery(contactField, state.lastOptions[idx])
            : buildClienteContactQuery(contactField, state.lastOptions[idx]),
          interpreted: true,
        };
      }
    }

    if (useProveedor) {
      if (!proveedorTarget && state.lastEntityType === 'proveedor' && state.lastEntityName) {
        return {
          message: buildProveedorContactQuery(contactField, state.lastEntityName),
          interpreted: true,
        };
      }
    } else {
      const explicitTarget = clienteTarget;
      if (!explicitTarget && state.lastEntityType === 'cliente' && state.lastEntityName) {
        return {
          message: buildClienteContactQuery(contactField, state.lastEntityName),
          interpreted: true,
        };
      }
    }
  }

  if (
    state.topic === 'ventas' ||
    state.lastIntent?.startsWith('reporte_ventas') ||
    state.lastIntent === 'reporte_ganancias' ||
    state.lastIntent === 'reporte_medios_pago'
  ) {
    const salesFollowup = salesFollowupMessageFromText(normalized, state.lastIntent);
    if (salesFollowup) return { message: salesFollowup, interpreted: true };
  }

  if (state.lastOptions.length > 0) {
    let idx = selectionIndexFromReply(text, state.lastOptions.length);
    if (idx == null && /^(ese|esa|ese mismo|esa misma|el de arriba)$/.test(normalized)) idx = 0;
    if (idx == null && /^(el ultimo|el último|el final)$/.test(normalized)) idx = state.lastOptions.length - 1;
    if (idx != null && idx >= 0 && idx < state.lastOptions.length) {
      const kind = disambiguationKindFromLastIntent(state.lastIntent);
      if (kind) {
        return {
          message: buildClarifiedQuery(kind, state.lastOptions[idx]),
          interpreted: true,
        };
      }
    }
    const byName = resolveOptionByName(text, state.lastOptions);
    if (byName) {
      const kind = disambiguationKindFromLastIntent(state.lastIntent);
      if (kind) {
        return {
          message: buildClarifiedQuery(kind, byName),
          interpreted: true,
        };
      }
    }
  }

  if (state.pendingPrompt === 'debt_scope') {
    if (isProviderScopeMessage(normalized)) {
      if (state.lastEntityName) {
        return {
          message: `cuanto le debo a proveedor ${state.lastEntityName}`,
          interpreted: true,
        };
      }
      return { message: 'reporte deuda proveedores', interpreted: true };
    }
    if (isClientScopeMessage(normalized)) {
      if (state.lastEntityName) {
        return {
          message: `cuanto me debe el cliente ${state.lastEntityName}`,
          interpreted: true,
        };
      }
      return { message: 'reporte deuda clientes', interpreted: true };
    }
  }

  const hasExplicitScope = /\b(proveedor|proveedores|cliente|clientes)\b/.test(normalized);
  const debtTarget = extractDebtFollowupTarget(text);
  if (debtTarget && !hasExplicitScope) {
    if (state.topic === 'deuda_proveedores') {
      return {
        message: `cuanto le debo a proveedor ${debtTarget}`,
        interpreted: true,
      };
    }
    if (state.topic === 'deuda_clientes') {
      return {
        message: `cuanto me debe el cliente ${debtTarget}`,
        interpreted: true,
      };
    }
  }

  if (state.topic === 'deuda_proveedores' && isProviderScopeMessage(normalized)) {
    return { message: 'reporte deuda proveedores', interpreted: true };
  }
  if (state.topic === 'deuda_clientes' && isClientScopeMessage(normalized)) {
    return { message: 'reporte deuda clientes', interpreted: true };
  }

  if (isReportContinueMessage(normalized)) {
    const followup = reportContinueMessageFromState(state);
    if (followup) return { message: followup, interpreted: true };
  }

  if (
    state.topic === 'stock' &&
    state.lastIntent === 'stock_mas_bajo' &&
    isAffirmativeOfferedReportMessage(normalized)
  ) {
    return { message: 'reporte stock bajo', interpreted: true };
  }

  if (/^(de nuevo|otra vez|lo mismo)$/.test(normalized) && state.lastIntent && state.lastEntityName) {
    if (state.lastIntent === 'cliente_deuda' || state.lastEntityType === 'cliente') {
      return {
        message: `cuanto me debe el cliente ${state.lastEntityName}`,
        interpreted: true,
      };
    }
    if (state.lastIntent === 'proveedor_deuda' || state.lastEntityType === 'proveedor') {
      return {
        message: `cuanto le debo a proveedor ${state.lastEntityName}`,
        interpreted: true,
      };
    }
  }

  if (/^(y\s+)?(su\s+)?saldo$/.test(normalized) && state.lastEntityName) {
    if (state.lastEntityType === 'cliente' || state.topic === 'deuda_clientes') {
      return {
        message: `cuanto me debe el cliente ${state.lastEntityName}`,
        interpreted: true,
      };
    }
    if (state.lastEntityType === 'proveedor' || state.topic === 'deuda_proveedores') {
      return {
        message: `cuanto le debo a proveedor ${state.lastEntityName}`,
        interpreted: true,
      };
    }
  }

  return { message: text, interpreted: false };
}
