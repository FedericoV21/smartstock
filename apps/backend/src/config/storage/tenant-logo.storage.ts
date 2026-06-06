import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const TENANT_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const TENANT_LOGO_ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function tenantLogoObjectKey(tenantId: string, ext: string): string {
  return `${tenantId}/logo.${ext}`;
}

export function extForTenantLogoMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

@Injectable()
export class TenantLogoStorageService {
  constructor(private readonly config: ConfigService) {}

  isStorageEnabled(): boolean {
    const v = this.config.get('TENANT_LOGO_STORAGE_ENABLED');
    if (v !== undefined && v !== '') {
      return v === true || v === 'true' || v === 1 || v === '1';
    }
    const img = this.config.get('PRODUCT_IMAGE_STORAGE_ENABLED');
    return img === true || img === 'true' || img === 1 || img === '1';
  }

  isConfigured(): boolean {
    if (!this.isStorageEnabled()) return false;
    const bucket = this.resolveBucket();
    const ak = this.resolveAccessKeyId();
    const sk = this.resolveSecretAccessKey();
    const pub = this.resolvePublicBaseUrl();
    return Boolean(bucket && ak && sk && pub);
  }

  async uploadLogo(tenantId: string, body: Buffer, mime: string): Promise<string> {
    const bucket = this.resolveBucket();
    const accessKeyId = this.resolveAccessKeyId();
    const secretAccessKey = this.resolveSecretAccessKey();
    const publicBase = this.resolvePublicBaseUrl();
    if (!bucket || !accessKeyId || !secretAccessKey || !publicBase) {
      throw new Error('Tenant logo S3: configuraci├│n incompleta');
    }

    const ext = extForTenantLogoMime(mime);
    const client = this.createClient(accessKeyId, secretAccessKey);
    const key = tenantLogoObjectKey(tenantId, ext);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: mime,
      }),
    );

    await this.deleteStaleFormats(client, bucket, tenantId, ext);
    const base = publicBase.replace(/\/+$/, '');
    return `${base}/${key}`;
  }

  async deleteLogo(tenantId: string): Promise<void> {
    const bucket = this.resolveBucket();
    const accessKeyId = this.resolveAccessKeyId();
    const secretAccessKey = this.resolveSecretAccessKey();
    if (!bucket || !accessKeyId || !secretAccessKey) return;

    const client = this.createClient(accessKeyId, secretAccessKey);
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: tenantLogoObjectKey(tenantId, ext === 'jpeg' ? 'jpg' : ext),
          }),
        );
      } catch {
        // Objeto inexistente no bloquea limpiar logo_url en BD.
      }
    }
  }

  private async deleteStaleFormats(
    client: S3Client,
    bucket: string,
    tenantId: string,
    keepExt: string,
  ): Promise<void> {
    for (const ext of ['png', 'jpg', 'webp']) {
      if (ext === keepExt) continue;
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: tenantLogoObjectKey(tenantId, ext),
          }),
        );
      } catch {
        // ignore
      }
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
      this.config.get<string>('TENANT_LOGO_S3_BUCKET')?.trim() ||
      this.config.get<string>('PRODUCT_IMAGE_S3_BUCKET')?.trim() ||
      this.config.get<string>('PDF_S3_BUCKET')?.trim() ||
      'tenant-logos'
    );
  }

  private resolveRegion(): string | undefined {
    return (
      this.config.get<string>('TENANT_LOGO_S3_REGION')?.trim() ||
      this.config.get<string>('PRODUCT_IMAGE_S3_REGION')?.trim() ||
      this.config.get<string>('PDF_S3_REGION')?.trim() ||
      'us-east-1'
    );
  }

  private resolveEndpoint(): string | undefined {
    return (
      this.config.get<string>('TENANT_LOGO_S3_ENDPOINT')?.trim() ||
      this.config.get<string>('PRODUCT_IMAGE_S3_ENDPOINT')?.trim() ||
      this.config.get<string>('PDF_S3_ENDPOINT')?.trim() ||
      undefined
    );
  }

  private resolveForcePathStyle(): unknown {
    const own = this.config.get('TENANT_LOGO_S3_FORCE_PATH_STYLE');
    if (own !== undefined && own !== '') return own;
    const img = this.config.get('PRODUCT_IMAGE_S3_FORCE_PATH_STYLE');
    if (img !== undefined && img !== '') return img;
    return this.config.get('PDF_S3_FORCE_PATH_STYLE');
  }

  private resolveAccessKeyId(): string | undefined {
    return (
      this.config.get<string>('TENANT_LOGO_S3_ACCESS_KEY_ID')?.trim() ||
      this.config.get<string>('PRODUCT_IMAGE_S3_ACCESS_KEY_ID')?.trim() ||
      this.config.get<string>('PDF_S3_ACCESS_KEY_ID')?.trim() ||
      undefined
    );
  }

  private resolveSecretAccessKey(): string | undefined {
    return (
      this.config.get<string>('TENANT_LOGO_S3_SECRET_ACCESS_KEY')?.trim() ||
      this.config.get<string>('PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY')?.trim() ||
      this.config.get<string>('PDF_S3_SECRET_ACCESS_KEY')?.trim() ||
      undefined
    );
  }

  private resolvePublicBaseUrl(): string | undefined {
    return (
      this.config.get<string>('TENANT_LOGO_PUBLIC_BASE_URL')?.trim() ||
      this.config.get<string>('PRODUCT_IMAGE_PUBLIC_BASE_URL')?.trim() ||
      this.config.get<string>('PDF_PUBLIC_BASE_URL')?.trim() ||
      undefined
    );
  }
}
