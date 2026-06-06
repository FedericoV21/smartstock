import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class ArcaCryptoService {
  constructor(private readonly config: ConfigService) {}

  encrypt(plainText: string): string {
    const key = this.getKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(payload: string): string {
    const key = this.getKey();
    const [ivHex, tagHex, cipherHex] = payload.split(':');
    if (!ivHex || !tagHex || !cipherHex) {
      throw new BadRequestException('Formato de secreto ARCA inv├ílido');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  private getKey(): Buffer {
    const key = this.config.get<string>('ARCA_ENCRYPTION_KEY');
    if (!key || key.length !== 32) {
      throw new BadRequestException(
        'ARCA_ENCRYPTION_KEY inv├ílida: debe existir y tener exactamente 32 caracteres',
      );
    }
    return Buffer.from(key, 'utf8');
  }
}
