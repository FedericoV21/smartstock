import { describe, expect, it } from 'vitest';

import {
  shouldInvokeIntentLlmAfterRules,
  WHATSAPP_INTENT_RULES_LLM_CONFIDENCE_MAX_EXCLUSIVE,
  WHATSAPP_INTENT_RULES_LLM_CONFIDENCE_MIN,
} from '@/lib/whatsapp/intent-classifier-examples';

describe('shouldInvokeIntentLlmAfterRules', () => {
  it('no invoca LLM con intent claro y confidence alta', () => {
    expect(shouldInvokeIntentLlmAfterRules({ intent: 'reporte_ventas', confidence: 0.9 })).toBe(false);
  });

  it('invoca LLM en unknown', () => {
    expect(shouldInvokeIntentLlmAfterRules({ intent: 'unknown', confidence: 0.75 })).toBe(true);
  });

  it('invoca LLM en banda media de confidence', () => {
    expect(shouldInvokeIntentLlmAfterRules({ intent: 'stock_producto', confidence: 0.5 })).toBe(true);
  });

  it('no invoca LLM con confidence muy baja salvo unknown', () => {
    expect(shouldInvokeIntentLlmAfterRules({ intent: 'stock_producto', confidence: 0.3 })).toBe(false);
  });

  it('documenta umbrales exportados', () => {
    expect(WHATSAPP_INTENT_RULES_LLM_CONFIDENCE_MIN).toBe(0.4);
    expect(WHATSAPP_INTENT_RULES_LLM_CONFIDENCE_MAX_EXCLUSIVE).toBe(0.88);
  });
});
