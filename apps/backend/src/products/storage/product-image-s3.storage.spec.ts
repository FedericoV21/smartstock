import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { productImageObjectKey, ProductImageS3StorageService } from './product-image-s3.storage';

function configFromEnv(env: Record<string, string | undefined>): ConfigService {
  return {
    get: <T = unknown>(key: string, defaultValue?: T): T => {
      if (key in env && env[key] !== undefined) {
        return env[key] as T;
      }
      return defaultValue as T;
    },
  } as ConfigService;
}

describe('ProductImageS3StorageService', () => {
  it('objectKey replica path Supabase', () => {
    expect(productImageObjectKey('tenant-a', 'prod-1')).toBe('tenant-a/prod-1/preview.webp');
  });

  it('isConfigured es false sin habilitar storage', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductImageS3StorageService,
        { provide: ConfigService, useValue: configFromEnv({}) },
      ],
    }).compile();
    expect(moduleRef.get(ProductImageS3StorageService).isConfigured()).toBe(false);
  });

  it('isConfigured es true con variables propias', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductImageS3StorageService,
        {
          provide: ConfigService,
          useValue: configFromEnv({
            PRODUCT_IMAGE_STORAGE_ENABLED: 'true',
            PRODUCT_IMAGE_S3_BUCKET: 'producto-imagenes',
            PRODUCT_IMAGE_S3_ACCESS_KEY_ID: 'key',
            PRODUCT_IMAGE_S3_SECRET_ACCESS_KEY: 'secret',
            PRODUCT_IMAGE_PUBLIC_BASE_URL: 'https://cdn.example.com/producto-imagenes',
          }),
        },
      ],
    }).compile();
    expect(moduleRef.get(ProductImageS3StorageService).isConfigured()).toBe(true);
  });

  it('reutiliza credenciales PDF si faltan las de imagen', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductImageS3StorageService,
        {
          provide: ConfigService,
          useValue: configFromEnv({
            PRODUCT_IMAGE_STORAGE_ENABLED: 'true',
            PDF_S3_BUCKET: 'shared-bucket',
            PDF_S3_ACCESS_KEY_ID: 'pdf-key',
            PDF_S3_SECRET_ACCESS_KEY: 'pdf-secret',
            PDF_PUBLIC_BASE_URL: 'https://cdn.example.com',
          }),
        },
      ],
    }).compile();
    expect(moduleRef.get(ProductImageS3StorageService).isConfigured()).toBe(true);
  });
});
