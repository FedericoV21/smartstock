import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(_scrypt);

/** Dominio reservado (RFC 2606); no es correo real. */
export const LOCAL_EMAIL_DOMAIN = 'example.invalid';
const HASH_PREFIX = 's1';

export function normalizeLocalUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

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

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Mismo algoritmo scrypt que PIN; usable para contraseñas email. */
export const hashPassword = hashPin;
export const verifyPassword = verifyPin;
