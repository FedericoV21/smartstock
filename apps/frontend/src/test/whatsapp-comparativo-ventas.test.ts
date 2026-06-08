import { describe, expect, it, vi } from 'vitest';

import { resolveWhatsAppComparativoPeriods } from '@/lib/whatsapp/report-tools';

describe('whatsapp comparativo ventas', () => {
  it('resuelve periodo actual y mes anterior', () => {
    vi.useFakeTimers({ now: new Date('2026-06-01T15:00:00-03:00') });
    const periods = resolveWhatsAppComparativoPeriods('como venimos vs mes pasado');
    expect(periods.current.label).toBe('Este mes');
    expect(periods.current.desde).toBe('2026-06-01');
    expect(periods.previous.label).toBe('Mes anterior');
    expect(periods.previous.desde).toBe('2026-05-01');
    expect(periods.previous.hasta).toBe('2026-05-31');
    vi.useRealTimers();
  });

  it('resuelve mayo vs abril en comparativo por mes nombrado', () => {
    vi.useFakeTimers({ now: new Date('2026-06-01T15:00:00-03:00') });
    const periods = resolveWhatsAppComparativoPeriods('comparativo ventas mayo');
    expect(periods.current.label).toContain('Mayo');
    expect(periods.previous.label).toContain('Abril');
    vi.useRealTimers();
  });
});
