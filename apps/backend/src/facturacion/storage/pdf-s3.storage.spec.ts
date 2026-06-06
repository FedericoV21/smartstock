import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { PdfS3StorageService } from './pdf-s3.storage';

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

describe('PdfS3StorageService', () => {
  it('isConfigured es false si storage est├í deshabilitado', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PdfS3StorageService,
        { provide: ConfigService, useValue: configFromEnv({}) },
      ],
    }).compile();
    const svc = moduleRef.get(PdfS3StorageService);
    expect(svc.isConfigured()).toBe(false);
  });

  it('objectKey replica carpeta por tenant', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PdfS3StorageService,
        { provide: ConfigService, useValue: configFromEnv({}) },
      ],
    }).compile();
    expect(moduleRef.get(PdfS3StorageService).objectKey('tenant-a', 'uuid-1')).toBe('tenant-a/uuid-1.pdf');
  });

  it('isConfigured es true con variables m├¡nimas', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PdfS3StorageService,
        {
          provide: ConfigService,
          useValue: configFromEnv({
            PDF_STORAGE_ENABLED: 'true',
            PDF_S3_BUCKET: 'bucket',
            PDF_S3_ACCESS_KEY_ID: 'key',
            PDF_S3_SECRET_ACCESS_KEY: 'secret',
            PDF_PUBLIC_BASE_URL: 'https://files.example.com',
          }),
        },
      ],
    }).compile();
    expect(moduleRef.get(PdfS3StorageService).isConfigured()).toBe(true);
  });
});
