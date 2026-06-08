import { describe, expect, it } from 'vitest';

import { calcularLayoutHojaEtiquetas } from '@/lib/pos/hoja-etiquetas-pdf';

describe('calcularLayoutHojaEtiquetas', () => {
  it('arma una grilla A4 de 50x30 con 36 etiquetas por hoja', () => {
    const layout = calcularLayoutHojaEtiquetas('a4');

    expect(layout.labelSize).toBe('50x30');
    expect(layout.columns).toBe(4);
    expect(layout.rows).toBe(9);
    expect(layout.labelsPerPage).toBe(36);
  });

  it('arma una grilla A4 de 80x40 con 14 etiquetas por hoja', () => {
    const layout = calcularLayoutHojaEtiquetas('80x40');

    expect(layout.labelSize).toBe('80x40');
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(7);
    expect(layout.labelsPerPage).toBe(14);
  });
});
