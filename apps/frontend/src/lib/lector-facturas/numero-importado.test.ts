import { describe, expect, it } from 'vitest';

import { numeroComprobanteImportado } from './numero-importado';

describe('numeroComprobanteImportado', () => {
  it('devuelve null cuando falta PV o numero de documento', () => {
    expect(numeroComprobanteImportado(null, 123)).toBeNull();
    expect(numeroComprobanteImportado(1, null)).toBeNull();
    expect(numeroComprobanteImportado(undefined, undefined)).toBeNull();
  });

  it('devuelve un numero estable cuando hay PV y numero', () => {
    const a = numeroComprobanteImportado(5, 123456);
    const b = numeroComprobanteImportado(5, 123456);
    expect(a).toBeTypeOf('number');
    expect(a).toBe(b);
  });
});
