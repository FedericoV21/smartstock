import { ConfigService } from '@nestjs/config';

/**
 * Secreto HS256 para validar JWT de usuarios.
 * Preferir `JWT_SECRET`; `SUPABASE_JWT_SECRET` se mantiene por compatibilidad.
 */
export function getJwtSigningSecret(config: ConfigService): string {
  const primary = config.get<string>('JWT_SECRET')?.trim();
  const legacy = config.get<string>('SUPABASE_JWT_SECRET')?.trim();
  const secret = primary || legacy;
  if (!secret) {
    throw new Error('Falta JWT_SECRET o SUPABASE_JWT_SECRET en configuraci├│n');
  }
  return secret;
}
