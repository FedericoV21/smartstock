import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

@Injectable()
export class WhatsappStorageService {
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

  private bucketForMime(mime: string | null | undefined): string {
    const m = (mime ?? '').toLowerCase().trim();
    if (m === 'application/pdf' || m.startsWith('image/')) return 'facturas-recibidas';
    return 'listas-precios';
  }

  private folderForMime(mime: string | null | undefined): string {
    const m = (mime ?? '').toLowerCase().trim();
    if (m === 'application/pdf' || m.startsWith('image/')) return 'whatsapp/facturas';
    return 'whatsapp/listas';
  }

  private safeName(name: string | null | undefined, fallback: string): string {
    const n = (name ?? '').trim();
    if (!n) return fallback;
    return n.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  async uploadAttachment(params: {
    tenantId: string;
    bytes: ArrayBuffer;
    mimeType: string | null;
    filename: string | null;
  }): Promise<{ bucket: string; path: string }> {
    const bucket = this.bucketForMime(params.mimeType);
    const folder = this.folderForMime(params.mimeType);
    const name = this.safeName(params.filename, 'whatsapp-file');
    const path = `whatsapp/${params.tenantId}/${folder}/${Date.now()}_${randomUUID().slice(0, 8)}_${name}`;

    if (this.s3Configured()) {
      const s3Bucket = this.config.get<string>('PDF_S3_BUCKET')!.trim();
      const client = this.createS3Client();
      await client.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: path,
          Body: Buffer.from(params.bytes),
          ContentType: params.mimeType ?? 'application/octet-stream',
        }),
      );
      return { bucket: s3Bucket, path };
    }

    return { bucket, path };
  }

  async createPresignedDownloadUrl(storagePath: string, ttlSeconds: number): Promise<string | null> {
    if (!this.s3Configured()) return null;
    const bucket = this.config.get<string>('PDF_S3_BUCKET')!.trim();
    const client = this.createS3Client();
    const command = new GetObjectCommand({ Bucket: bucket, Key: storagePath });
    return getSignedUrl(client, command, { expiresIn: Math.max(60, ttlSeconds) });
  }
}
