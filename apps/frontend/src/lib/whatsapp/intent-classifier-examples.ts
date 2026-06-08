/**
 * Few-shots para classifyIntentWithLlm (V143-WA-002).
 * Mantener lista corta; ampliar con casos WAE-* que fallan en piloto.
 */
export type IntentClassifierFewShot = {
  message: string;
  intent: string;
  targetName: string | null;
  contactField?: string | null;
  fallbackReason?: string | null;
};

export const WHATSAPP_INTENT_CLASSIFIER_FEW_SHOTS: IntentClassifierFewShot[] = [
  { message: 'como venimos', intent: 'reporte_resumen', targetName: null },
  { message: 'cuanto vendimos en mayo', intent: 'reporte_ventas', targetName: null },
  { message: 'cuantas ventas tuvimos en mayo', intent: 'reporte_ventas', targetName: null },
  { message: 'productos mas vendidos mes anterior', intent: 'reporte_ventas_productos', targetName: null },
  { message: 'me deben', intent: 'reporte_deuda_clientes', targetName: null },
  { message: 'yo debo', intent: 'reporte_deuda_proveedores', targetName: null },
  { message: 'pasame la deuda de ginkgo', intent: 'unknown', targetName: 'ginkgo', fallbackReason: 'ambiguous_debt_scope' },
  { message: 'stock de producto', intent: 'unknown', targetName: 'producto', fallbackReason: 'generic_target_name' },
  { message: 'telefono de juan perez', intent: 'cliente_contacto', targetName: 'juan perez', contactField: 'telefono' },
  { message: 'registrar pago proveedor arcor', intent: 'unsupported_action', targetName: null },
  { message: 'ventas por articulo hoy', intent: 'reporte_ventas_articulo', targetName: null },
  { message: 'top sku mayo', intent: 'reporte_ventas_articulo', targetName: null },
  { message: 'cierre de caja hoy', intent: 'reporte_cierre_caja', targetName: null },
  { message: 'arqueo de caja', intent: 'reporte_cierre_caja', targetName: null },
  { message: 'extracto cuenta corriente juan perez', intent: 'cliente_extracto_cc', targetName: 'juan perez' },
  { message: 'movimientos cc kiosco centro', intent: 'cliente_extracto_cc', targetName: 'kiosco centro' },
  { message: 'ventas pos hoy caja mostrador', intent: 'reporte_ventas_pos', targetName: null },
  { message: 'tickets pos operador maria lopez', intent: 'reporte_ventas_pos', targetName: null },
  { message: 'telefono del proveedor arcor', intent: 'proveedor_contacto', targetName: 'arcor', contactField: 'telefono' },
  { message: 'mail de proveedor ginkgo', intent: 'proveedor_contacto', targetName: 'ginkgo', contactField: 'email' },
  { message: 'como venimos vs mes pasado', intent: 'reporte_comparativo_ventas', targetName: null },
  { message: 'ventas vs mes anterior', intent: 'reporte_comparativo_ventas', targetName: null },
];

export function formatIntentClassifierFewShotsForPrompt(): string[] {
  return [
    'Ejemplos (respondé con el mismo esquema JSON que el mensaje actual):',
    ...WHATSAPP_INTENT_CLASSIFIER_FEW_SHOTS.map((shot) =>
      JSON.stringify({
        intent: shot.intent,
        targetName: shot.targetName,
        confidence: 0.9,
        fallbackReason: shot.fallbackReason ?? null,
        ...(shot.contactField ? { contactField: shot.contactField } : {}),
      }),
    ),
  ];
}

/** Reglas documentadas: LLM solo si reglas devuelven unknown o confidence en [0.4, 0.88). */
export const WHATSAPP_INTENT_RULES_LLM_CONFIDENCE_MIN = 0.4;
export const WHATSAPP_INTENT_RULES_LLM_CONFIDENCE_MAX_EXCLUSIVE = 0.88;

export function shouldInvokeIntentLlmAfterRules(rules: {
  intent: string;
  confidence: number;
}): boolean {
  if (rules.intent === 'unsupported_action') return false;
  if (rules.intent !== 'unknown' && rules.confidence >= WHATSAPP_INTENT_RULES_LLM_CONFIDENCE_MAX_EXCLUSIVE) {
    return false;
  }
  if (rules.confidence < WHATSAPP_INTENT_RULES_LLM_CONFIDENCE_MIN) {
    return rules.intent === 'unknown';
  }
  return true;
}
