import { describe, expect, it } from 'vitest';

import { generarEAN13Interno } from '@/lib/pos/ean13';
import { opcionesBwipEtiqueta } from '@/lib/pos/etiqueta-barcode-render';

describe('opcionesBwipEtiqueta', () => {
  it('usa ean13 cuando el código es EAN-13 válido', () => {
    const ean = generarEAN13Interno(42);
    const o = opcionesBwipEtiqueta(ean, '50x30');
    expect(o).toEqual({
      bcid: 'ean13',
      text: ean,
      scale: 1.75,
      height: 8,
    });
  });

  it('usa code128 para SKU alfanumérico', () => {
    const o = opcionesBwipEtiqueta('hl-3323-mg', '50x30');
    expect(o?.bcid).toBe('code128');
    expect(o?.text).toBe('hl-3323-mg');
    expect(o?.scale).toBeGreaterThanOrEqual(1);
  });

  it('devuelve null para string vacío', () => {
    expect(opcionesBwipEtiqueta('   ', '50x30')).toBeNull();
  });

  it('no usa ean13 para 13 dígitos con check inválido', () => {
    const o = opcionesBwipEtiqueta('1234567890123', '50x30');
    expect(o?.bcid).toBe('code128');
  });
});
