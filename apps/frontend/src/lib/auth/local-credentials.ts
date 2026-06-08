import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(_scrypt);

/** Dominio reservado (RFC 2606); no es correo real. Evita rechazos de formato/MX de Auth por dominios inventados. */
export const LOCAL_EMAIL_DOMAIN = 'example.invalid';
const HASH_PREFIX = 's1';

export function normalizeLocalUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Email técnico solo para fila auth.users (login lee `usuario.email` guardado al crear).
 * Debe cumplir reglas estrictas de Supabase Auth: parte local corta, sin @ en el usuario, etc.
 */
export function buildLocalAuthEmail(tenantId: string, username: string): string {
  const normalized = normalizeLocalUsername(username);
  const tag = createHash('sha256')
    .update(`${tenantId}\0${normalized}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `l${tag}@${LOCAL_EMAIL_DOMAIN}`;
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

export function generateLocalCashierUsername(base = 'cajero'): string {
  const normalized = normalizeLocalUsername(base).replace(/[^a-z0-9._-]/g, '');
  const safeBase = normalized || 'cajero';
  const suffix = randomBytes(2).toString('hex');
  return `${safeBase}_${suffix}`;
}

export function generateLocalCashierPin(length = 6): string {
  const safeLength = Math.min(8, Math.max(4, Math.trunc(length)));
  let out = '';
  while (out.length < safeLength) {
    const byte = randomBytes(1)[0];
    out += String(byte % 10);
  }
  return out;
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(pin, salt, 64)) as Buffer;
  return `${HASH_PREFIX}$${salt}$${derived.toString('hex')}`;
}

export async function verifyPin(pin: string, encodedHash: string): Promise<boolean> {
  const [prefix, salt, hashHex] = encodedHash.split('$');
  if (prefix !== HASH_PREFIX || !salt || !hashHex) return false;

  const computed = (await scrypt(pin, salt, 64)) as Buffer;
  const expected = Buffer.from(hashHex, 'hex');

  if (expected.length !== computed.length) return false;
  return timingSafeEqual(expected, computed);
}

