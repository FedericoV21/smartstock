import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Cifrado de campos sensibles compatible con el front Supabase
 * (`apps/frontend/src/lib/facturacion/arca/crypto.ts` ÔÇö AES-256-CBC, iv:hex).
 */
@Injectable()
export class LegacyFieldCryptoService {
  private static readonly ALGORITHM = 'aes-256-cbc';

  constructor(private readonly config: ConfigService) {}

  encrypt(plainText: string): string {
    const keyBuffer = this.getKeyBuffer();
    const iv = randomBytes(16);
    const cipher = createCipheriv(LegacyFieldCryptoService.ALGORITHM, keyBuffer, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(payload: string): string {
    const keyBuffer = this.getKeyBuffer();
    const [ivHex, encryptedHex] = payload.split(':');
    if (!ivHex || !encryptedHex) {
      throw new BadRequestException('Formato de campo cifrado inv├ílido');
    }
    const decipher = createDecipheriv(
      LegacyFieldCryptoService.ALGORITHM,
      keyBuffer,
      Buffer.from(ivHex, 'hex'),
    );
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  /** Devuelve token en claro o null si no hay / error al desencriptar. */
  tryDecrypt(encrypted: string | null | undefined): string | null {
    if (!encrypted?.trim()) return null;
    try {
      return this.decrypt(encrypted.trim());
    } catch {
      return null;
    }
  }

  private getKeyBuffer(): Buffer {
    const key = this.config.get<string>('ARCA_ENCRYPTION_KEY');
    if (!key?.trim()) {
      throw new BadRequestException('ARCA_ENCRYPTION_KEY no configurada');
    }
    return Buffer.from(key.padEnd(32, '0').substring(0, 32), 'utf8');
  }
}
