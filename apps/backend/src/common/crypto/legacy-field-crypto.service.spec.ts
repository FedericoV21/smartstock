import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { LegacyFieldCryptoService } from './legacy-field-crypto.service';

describe('LegacyFieldCryptoService', () => {
  let service: LegacyFieldCryptoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LegacyFieldCryptoService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-key-32-chars-exactly!!') },
        },
      ],
    }).compile();

    service = module.get(LegacyFieldCryptoService);
  });

  it('encrypts and decrypts with iv:hex format (paridad front CBC)', () => {
    const encrypted = service.encrypt('APP_USR-secret-token');
    expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(encrypted.split(':').length).toBe(2);
    expect(service.decrypt(encrypted)).toBe('APP_USR-secret-token');
  });

  it('tryDecrypt returns null on invalid payload', () => {
    expect(service.tryDecrypt('not-valid')).toBeNull();
  });

  it('throws when ARCA_ENCRYPTION_KEY missing', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LegacyFieldCryptoService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
      ],
    }).compile();
    const bare = module.get(LegacyFieldCryptoService);
    expect(() => bare.encrypt('x')).toThrow(BadRequestException);
  });
});
