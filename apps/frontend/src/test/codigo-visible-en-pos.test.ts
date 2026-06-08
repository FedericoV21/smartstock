import { describe, expect, it } from 'vitest';

import { codigoVisibleEnPos } from '@/lib/pos/codigo-visible-en-pos';

describe('codigoVisibleEnPos', () => {
  it('prioriza codigo de barras de variante', () => {
    expect(
      codigoVisibleEnPos({
        codigo: 'SKU-1',
        codigo_barras: '111',
        variante: { codigo_barras: '222' },
      }),
    ).toBe('222');
  });

  it('usa codigo de barras del producto', () => {
    expect(codigoVisibleEnPos({ codigo: 'SKU-1', codigo_barras: '7791234567890' })).toBe(
      '7791234567890',
    );
  });

  it('usa PLU si no hay barras', () => {
    expect(codigoVisibleEnPos({ codigo: 'SKU-1', plu: '00075' })).toBe('00075');
  });

  it('cae al codigo interno si no hay barras ni PLU', () => {
    expect(codigoVisibleEnPos({ codigo: 'BULL-UVA' })).toBe('BULL-UVA');
  });
});
