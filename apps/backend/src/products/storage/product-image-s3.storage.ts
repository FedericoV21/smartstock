import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Objeto can├│nico por producto (paridad Supabase `producto-imagenes`). */
export function productImageObjectKey(tenantId: string, productId: string): string {
  return `${tenantId}/${productId}/preview.webp`;
}

@Injectable()
export class ProductImageS3StorageService {
  constructor(private readonly config: ConfigService) {}

  isStorageEnabled(): boolean {
    const v = this.config.get('PRODUCT_IMAGE_STORAGE_ENABLED');
    return v === true || v === 'true' || v === 1 || v === '1';
  }

  isConfigured(): boolean {
    if (!this.isStorageEnabled()) {
      return false;
    }
    const bucket = this.resolveBucket();
    const ak = this.resolveAccessKeyId();
    const sk = this.resolveSecretAccessKey();
    const pub = this.resolvePublicBaseUrl();
    return Boolean(bucket && ak && sk && pub);
  }

  async uploadPreview(tenantId: string, productId: string, body: Buffer): Promise<string> {
    const bucket = this.resolveBucket();
    const accessKeyId = this.resolveAccessKeyId();
    const secretAccessKey = this.resolveSecretAccessKey();
    const publicBase = this.resolvePublicBaseUrl();
    if (!bucket || !accessKeyId || !secretAccessKey || !publicBase) {
      throw new Error('Product image S3: configuraci├│n incompleta');
    }

    const client = this.createClient(accessKeyId, secretAccessKey);
    const key = productImageObjectKey(tenantId, productId);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'image/webp',
      }),
    );

    const base = publicBase.replace(/\/+$/, '');
    return `${base}/${key}`;
  }

  async deletePreview(tenantId: string, productId: string): Promise<void> {
    const bucket = this.resolveBucket();
    const accessKeyId = this.resolveAccessKeyId();
    const secretAccessKey = this.resolveSecretAccessKey();
    if (!bucket || !accessKeyId || !secretAccessKey) {
      return;
    }

    const client = this.createClient(accessKeyId, secretAccessKey);
    const key = productImageObjectKey(tenantId, productId);
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    } catch {
      // Objeto inexistente u otro error no bloquea limpiar imagen_url en BD.
    }
  }

  private createClient(accessKeyId: string, secretAccessKey: string): S3Client {
    const region = (this.resolveRegion() ?? 'us-east-1').trim() || 'us-east-1';
    const endpoint = this.resolveEndpoint();
    const forcePath =
      this.resolveForcePathStyle() === true ||
      this.resolveForcePathStyle() === 'true' ||
      this.resolveForcePathStyle() === '1';

    return new S3Client({
      region,
      endpoint: endpoint || undefined,
      forcePathStyle: Boolean(endpoint && forcePath),
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  private resolveBucket(): string | undefined {
    return (
      this.config.get<string>('PRODUCT_IMAGE_S3_BUCKET')?.trim() ||
      this.config.get<string>('PDF_S3_BUCKET')?.trim() ||
      undefined
    );
  }

  private resolveRegion(): string | undefined {
    return (
      this.config.get<string>('PRODUCT_IMAGE_S3_REGION')?.trim() ||
      this.config.get<string>('PDF_S3_REGION')?.trim() ||
      'us-east-1'
    );
  }

  private resolveEndpoint(): string | undefined {
    return (
      this.config.get<string>('PRODUCT_IMAGE_S3_ENDPOINT')?.trim() ||
      this.config.get<string>('PDF_S3_ENDPOINT')?.trim() ||
      undefined
    );
  }

  private resolveForcePathStyle(): unknown {
    const own = this.config.get('PRODUCT_IMAGE_S3_FORCE_PATH_STYLE');
    if (own !== undefined && own !== '') {
      return own;
    }
    return this.config.get('PDF_S3_FORCE_PATH_STYLE');
  }

  private resolveAccessKeyId(): string | undefined {
    return (
      this.config.get<string>('PRODUCT_IMAGE_S3_ACCESS_KEY_ID')?.trim() ||
      this.config.get<string>('PDF_S3_ACCESS_KEY_ID')?.trim() ||
      undefined
    );
  }

  private resolveSecretAccessKey(): string | undefined {
    return (
      this.config.get<string>('PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY')?.trim() ||
      this.config.get<string>('PDF_S3_SECRET_ACCESS_KEY')?.trim() ||
      undefined
    );
  }

  private resolvePublicBaseUrl(): string | undefined {
    return (
      this.config.get<string>('PRODUCT_IMAGE_PUBLIC_BASE_URL')?.trim() ||
      this.config.get<string>('PDF_PUBLIC_BASE_URL')?.trim() ||
      undefined
    );
  }
}
