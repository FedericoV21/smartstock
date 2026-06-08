import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

export type LectorJobArchivoRef = {
  nombre: string;
  mimeType: string;
  size: number;
  storageBucket?: string;
  storagePath: string;
};

@Injectable()
export class LectorStorageService {
  private readonly logger = new Logger(LectorStorageService.name);

  constructor(private readonly config: ConfigService) {}

  private s3Configured(): boolean {
    const bucket = this.config.get<string>('PDF_S3_BUCKET')?.trim();
    const ak = this.config.get<string>('PDF_S3_ACCESS_KEY_ID')?.trim();
    const sk = this.config.get<string>('PDF_S3_SECRET_ACCESS_KEY')?.trim();
    return Boolean(bucket && ak && sk);
  }

  private createS3Client(): S3Client {
    const accessKeyId = this.config.get<string>('PDF_S3_ACCESS_KEY_ID')!.trim();
    const secretAccessKey = this.config.get<string>('PDF_S3_SECRET_ACCESS_KEY')!.trim();
    const region = (this.config.get<string>('PDF_S3_REGION') ?? 'us-east-1').trim() || 'us-east-1';
    const endpoint = this.config.get<string>('PDF_S3_ENDPOINT')?.trim();
    const forcePath =
      this.config.get('PDF_S3_FORCE_PATH_STYLE') === true ||
      this.config.get('PDF_S3_FORCE_PATH_STYLE') === 'true' ||
      this.config.get('PDF_S3_FORCE_PATH_STYLE') === '1';

    return new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint, forcePathStyle: forcePath } : {}),
    });
  }

  /**
   * Guarda archivo de factura recibida.
   * Si PDF_S3_BUCKET está configurado, sube a S3 con clave `lector/{tenantId}/{uuid}/{name}`.
   * Si no hay bucket, devuelve la ruta lógica sin subir (archivo_url = path; bytes no persistidos).
   */
  async subirArchivoFacturaRecibida(
    tenantId: string,
    buffer: Buffer | Uint8Array,
    fileName: string,
    mimeType: string,
  ): Promise<{ path: string; error: Error | null }> {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `lector/${tenantId}/${randomUUID()}/${safeName}`;

    if (!this.s3Configured()) {
      return { path: storagePath, error: null };
    }

    const bucket = this.config.get<string>('PDF_S3_BUCKET')!.trim();
    const body = buffer instanceof Buffer ? buffer : Buffer.from(buffer);

    try {
      const client = this.createS3Client();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: storagePath,
          Body: body,
          ContentType: mimeType,
        }),
      );
      return { path: storagePath, error: null };
    } catch (e) {
      return { path: storagePath, error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  async subirArchivoLectorFacturaJob(params: {
    tenantId: string;
    source: 'api_publica' | 'whatsapp';
    archivo: { name: string; type: string; size: number; bytes: Uint8Array };
  }): Promise<LectorJobArchivoRef> {
    const safeName = (params.archivo.name.trim() || 'factura').replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${params.tenantId}/lector-jobs/${params.source}/${Date.now()}_${randomUUID()}_${safeName}`;
    const bucket = this.config.get<string>('PDF_S3_BUCKET')?.trim() || 'facturas-recibidas';

    if (this.s3Configured()) {
      const client = this.createS3Client();
      const body = Buffer.from(params.archivo.bytes);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: storagePath,
          Body: body,
          ContentType: params.archivo.type,
        }),
      );
    }

    return {
      nombre: params.archivo.name,
      mimeType: params.archivo.type,
      size: params.archivo.size || params.archivo.bytes.byteLength,
      storageBucket: bucket,
      storagePath,
    };
  }

  async descargarArchivoJob(archivo: LectorJobArchivoRef): Promise<Uint8Array | null> {
    if (!this.s3Configured()) {
      return null;
    }

    const bucket = archivo.storageBucket?.trim() || this.config.get<string>('PDF_S3_BUCKET')?.trim();
    if (!bucket) return null;

    try {
      const client = this.createS3Client();
      const res = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: archivo.storagePath,
        }),
      );
      const bytes = await res.Body?.transformToByteArray();
      return bytes ?? null;
    } catch (e) {
      this.logger.warn(`Job file download failed (${archivo.storagePath}): ${(e as Error).message}`);
      return null;
    }
  }
}
