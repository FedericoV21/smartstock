import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PriceListFileStorage {
  private readonly logger = new Logger(PriceListFileStorage.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const bucket = this.config.get<string>('PDF_S3_BUCKET')?.trim();
    const ak = this.config.get<string>('PDF_S3_ACCESS_KEY_ID')?.trim();
    const sk = this.config.get<string>('PDF_S3_SECRET_ACCESS_KEY')?.trim();
    return Boolean(bucket && ak && sk);
  }

  async upload(
    tenantId: string,
    buffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<string | null> {
    if (!this.isConfigured()) return null;

    const bucket = this.config.get<string>('PDF_S3_BUCKET')!.trim();
    const accessKeyId = this.config.get<string>('PDF_S3_ACCESS_KEY_ID')!.trim();
    const secretAccessKey = this.config.get<string>('PDF_S3_SECRET_ACCESS_KEY')!.trim();
    const region = (this.config.get<string>('PDF_S3_REGION') ?? 'us-east-1').trim() || 'us-east-1';
    const endpoint = this.config.get<string>('PDF_S3_ENDPOINT')?.trim();
    const forcePath =
      this.config.get('PDF_S3_FORCE_PATH_STYLE') === true ||
      this.config.get('PDF_S3_FORCE_PATH_STYLE') === 'true' ||
      this.config.get('PDF_S3_FORCE_PATH_STYLE') === '1';

    const timestamp = Date.now();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${tenantId}/listas/${timestamp}_${safeName}`;

    const client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      ...(endpoint ? { endpoint, forcePathStyle: forcePath } : {}),
    });

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: storagePath,
          Body: buffer,
          ContentType: mimeType,
        }),
      );
      return storagePath;
    } catch (e) {
      this.logger.warn(`Price list upload failed: ${(e as Error).message}`);
      return null;
    }
  }
}
