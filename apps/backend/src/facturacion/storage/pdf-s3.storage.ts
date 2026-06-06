import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Subida opcional de PDF de comprobante a un bucket S3-compatible (R2, MinIO, etc.).
 * La clave sigue el patr├│n del legado Supabase: `{tenantId}/{comprobanteId}.pdf`.
 */
@Injectable()
export class PdfS3StorageService {
  constructor(private readonly config: ConfigService) {}

  isStorageEnabled(): boolean {
    const v = this.config.get('PDF_STORAGE_ENABLED');
    return v === true || v === 'true' || v === 1 || v === '1';
  }

  /** Listo para subir: habilitado + bucket + credenciales + URL p├║blica base. */
  isConfigured(): boolean {
    if (!this.isStorageEnabled()) {
      return false;
    }
    const bucket = this.config.get<string>('PDF_S3_BUCKET')?.trim();
    const ak = this.config.get<string>('PDF_S3_ACCESS_KEY_ID')?.trim();
    const sk = this.config.get<string>('PDF_S3_SECRET_ACCESS_KEY')?.trim();
    const pub = this.config.get<string>('PDF_PUBLIC_BASE_URL')?.trim();
    return Boolean(bucket && ak && sk && pub);
  }

  objectKey(tenantId: string, comprobanteId: string): string {
    return `${tenantId}/${comprobanteId}.pdf`;
  }

  /**
   * Sube el PDF y devuelve la URL p├║blica (PDF_PUBLIC_BASE_URL + clave).
   * @throws Si falla PutObject o falta configuraci├│n requerida.
   */
  async uploadComprobantePdf(tenantId: string, comprobanteId: string, body: Buffer): Promise<string> {
    const bucket = this.config.get<string>('PDF_S3_BUCKET')?.trim();
    const accessKeyId = this.config.get<string>('PDF_S3_ACCESS_KEY_ID')?.trim();
    const secretAccessKey = this.config.get<string>('PDF_S3_SECRET_ACCESS_KEY')?.trim();
    const publicBase = this.config.get<string>('PDF_PUBLIC_BASE_URL')?.trim();
    if (!bucket || !accessKeyId || !secretAccessKey || !publicBase) {
      throw new Error('PDF S3: configuraci├│n incompleta');
    }

    const region = (this.config.get<string>('PDF_S3_REGION') ?? 'us-east-1').trim() || 'us-east-1';
    const endpoint = this.config.get<string>('PDF_S3_ENDPOINT')?.trim();
    const forcePath =
      this.config.get('PDF_S3_FORCE_PATH_STYLE') === true ||
      this.config.get('PDF_S3_FORCE_PATH_STYLE') === 'true' ||
      this.config.get('PDF_S3_FORCE_PATH_STYLE') === '1';

    const client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      forcePathStyle: Boolean(endpoint && forcePath),
      credentials: { accessKeyId, secretAccessKey },
    });

    const key = this.objectKey(tenantId, comprobanteId);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'application/pdf',
      }),
    );

    const base = publicBase.replace(/\/+$/, '');
    return `${base}/${key}`;
  }
}
