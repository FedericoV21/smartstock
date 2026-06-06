import { ProductoBarcodeTipo } from '../enums/producto-barcode-tipo.enum';
import {
  inferBarcodeTipoByLength,
  isValidBarcodeByTipo,
  isValidEan13,
  isValidItf14,
  isValidUpca,
} from './barcode-validation.util';

describe('barcode-validation util', () => {
  it('validates EAN13 with checksum', () => {
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('4006381333932')).toBe(false);
  });

  it('validates UPC-A with checksum', () => {
    expect(isValidUpca('036000291452')).toBe(true);
    expect(isValidUpca('036000291453')).toBe(false);
  });

  it('validates ITF-14 with checksum', () => {
    expect(isValidItf14('01234567890128')).toBe(true);
    expect(isValidItf14('01234567890129')).toBe(false);
  });

  it('infers barcode type by length', () => {
    expect(inferBarcodeTipoByLength('036000291452')).toBe(ProductoBarcodeTipo.UPCA);
    expect(inferBarcodeTipoByLength('4006381333931')).toBe(ProductoBarcodeTipo.EAN13);
    expect(inferBarcodeTipoByLength('01234567890128')).toBe(ProductoBarcodeTipo.ITF14);
    expect(inferBarcodeTipoByLength('ABC')).toBe(ProductoBarcodeTipo.OTRO);
  });

  it('validates by explicit type', () => {
    expect(isValidBarcodeByTipo(ProductoBarcodeTipo.EAN13, '4006381333931')).toBe(true);
    expect(isValidBarcodeByTipo(ProductoBarcodeTipo.EAN13, '036000291452')).toBe(false);
    expect(isValidBarcodeByTipo(ProductoBarcodeTipo.UPCA, '036000291452')).toBe(true);
    expect(isValidBarcodeByTipo(ProductoBarcodeTipo.ITF14, '01234567890128')).toBe(true);
    expect(isValidBarcodeByTipo(ProductoBarcodeTipo.OTRO, 'X1')).toBe(true);
  });
});
