import {
  assertProductImageMime,
  assertProductImageSize,
  PRODUCT_IMAGE_MAX_BYTES,
} from './process-product-image';

describe('process-product-image', () => {
  it('assertProductImageMime acepta png/jpeg/webp', () => {
    expect(() => assertProductImageMime('image/png')).not.toThrow();
    expect(() => assertProductImageMime('image/jpeg')).not.toThrow();
    expect(() => assertProductImageMime('image/webp')).not.toThrow();
  });

  it('assertProductImageMime rechaza otros formatos', () => {
    expect(() => assertProductImageMime('image/gif')).toThrow('FORMATO_NO_PERMITIDO');
  });

  it('assertProductImageSize rechaza archivos grandes', () => {
    expect(() => assertProductImageSize(PRODUCT_IMAGE_MAX_BYTES + 1)).toThrow(
      'ARCHIVO_DEMASIADO_GRANDE',
    );
  });
});
