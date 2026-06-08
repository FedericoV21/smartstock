import { describe, expect, it } from 'vitest';

import {
  celdasCalendarioMes,
  displayFechaToIso,
  isoFechaToDisplay,
  MESES_ES,
} from '@/lib/ui/fecha-argentina';

describe('fecha-argentina', () => {
  it('convierte ISO ↔ display', () => {
    expect(isoFechaToDisplay('2026-02-06')).toBe('06/02/2026');
    expect(displayFechaToIso('06/02/2026')).toBe('2026-02-06');
  });

  it('meses en español', () => {
    expect(MESES_ES[1]).toBe('febrero');
  });

  it('arma grilla de calendario', () => {
    const cells = celdasCalendarioMes(2026, 2);
    expect(cells.filter((c) => c != null).length).toBe(28);
  });
});
