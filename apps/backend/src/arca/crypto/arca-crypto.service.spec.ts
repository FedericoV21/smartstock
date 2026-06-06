import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ArcaCryptoService } from './arca-crypto.service';

describe('ArcaCryptoService', () => {
  it('encrypts and decrypts payload using env key', () => {
    const service = new ArcaCryptoService({
      get: jest.fn().mockReturnValue('12345678901234567890123456789012'),
    } as unknown as ConfigService);

    const encrypted = service.encrypt('CERT-PEM-CONTENT');
    const decrypted = service.decrypt(encrypted);

    expect(encrypted).not.toContain('CERT-PEM-CONTENT');
    expect(decrypted).toBe('CERT-PEM-CONTENT');
  });

  it('throws when env key missing/invalid', () => {
    const service = new ArcaCryptoService({
      get: jest.fn().mockReturnValue('short'),
    } as unknown as ConfigService);
    expect(() => service.encrypt('x')).toThrow(BadRequestException);
  });
});
