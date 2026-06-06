import {
  calcularCheckDigitEAN13,
  generarEAN13Interno,
  secuencialDesdeEAN13Interno,
  siguienteSecuencialInterno,
} from './ean13-interno.util';
import { isValidEan13 } from './barcode-validation.util';

describe('ean13-interno.util', () => {
  it('calcularCheckDigitEAN13 valida longitud', () => {
    expect(() => calcularCheckDigitEAN13('123')).toThrow();
  });

  it('generarEAN13Interno produce EAN-13 v├ílido con prefijo 135', () => {
    const code = generarEAN13Interno(1);
    expect(code).toHaveLength(13);
    expect(code.startsWith('135')).toBe(true);
    expect(isValidEan13(code)).toBe(true);
  });

  it('rellena secuencial con ceros', () => {
    expect(generarEAN13Interno(42).substring(0, 12)).toBe('135000000042');
  });

  it('secuencialDesdeEAN13Interno parsea c├│digos internos', () => {
    expect(secuencialDesdeEAN13Interno('1350000000427')).toBe(42);
    expect(secuencialDesdeEAN13Interno('7790000000000')).toBeNull();
  });

  it('siguienteSecuencialInterno incrementa desde el m├íximo', () => {
    expect(siguienteSecuencialInterno(null)).toBe(1);
    expect(siguienteSecuencialInterno(generarEAN13Interno(99))).toBe(100);
  });
});
