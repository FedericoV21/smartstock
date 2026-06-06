import sharp from 'sharp';

export const PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_EDGE = 256;
export const PRODUCT_IMAGE_WEBP_QUALITY = 80;
export const PRODUCT_IMAGE_ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function assertProductImageMime(mime: string | undefined): void {
  const normalized = mime?.trim() || 'application/octet-stream';
  if (!PRODUCT_IMAGE_ALLOWED_MIMES.has(normalized)) {
    throw new Error('FORMATO_NO_PERMITIDO');
  }
}

export function assertProductImageSize(size: number): void {
  if (size > PRODUCT_IMAGE_MAX_BYTES) {
    throw new Error('ARCHIVO_DEMASIADO_GRANDE');
  }
}

export async function processProductImagePreview(raw: Buffer): Promise<Buffer> {
  return sharp(raw)
    .rotate()
    .resize(PRODUCT_IMAGE_MAX_EDGE, PRODUCT_IMAGE_MAX_EDGE, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: PRODUCT_IMAGE_WEBP_QUALITY })
    .toBuffer();
}
