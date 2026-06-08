import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const WA_ID_MIN_LEN = 8;
const WA_ID_MAX_LEN = 20;

export const OTP_DIGITS = 6;
export const OTP_EXPIRES_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_BLOCK_MINUTES = 15;
export const OTP_MAX_RESEND_WINDOW = 3;
export const OTP_RESEND_WINDOW_MINUTES = 30;

export function normalizeWaId(input: string): string | null {
  const digits = input.replace(/\D/g, '').trim();
  if (digits.length < WA_ID_MIN_LEN || digits.length > WA_ID_MAX_LEN) return null;
  return digits;
}

export function canonicalWaId(input: string): string | null {
  const normalized = normalizeWaId(input);
  if (!normalized) return null;

  if (normalized.startsWith('549')) {
    return normalized;
  }

  if (normalized.startsWith('54') && normalized.length >= 11) {
    return `549${normalized.slice(2)}`;
  }

  return normalized;
}

export function waIdsMatch(a: string, b: string): boolean {
  const left = new Set(waIdLookupVariants(a));
  return waIdLookupVariants(b).some((value) => left.has(value));
}

export function waIdVariants(input: string): string[] {
  const normalized = normalizeWaId(input);
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);

  if (normalized.startsWith('549') && normalized.length >= 11) {
    variants.add(`54${normalized.slice(3)}`);
  } else if (normalized.startsWith('54') && !normalized.startsWith('549') && normalized.length >= 10) {
    variants.add(`549${normalized.slice(2)}`);
  }

  return Array.from(variants);
}

export function waIdLookupVariants(input: string): string[] {
  const variants = new Set<string>();
  for (const seed of [input, canonicalWaId(input) ?? '']) {
    if (!seed) continue;
    for (const variant of waIdVariants(seed)) {
      variants.add(variant);
    }
  }
  return Array.from(variants);
}

export function generateOtpCode(digits = OTP_DIGITS): string {
  const max = 10 ** digits;
  return String(randomInt(0, max)).padStart(digits, '0');
}

export function generateOtpSalt(): string {
  return randomBytes(16).toString('hex');
}

export function hashOtp(code: string, salt: string): string {
  return createHash('sha256').update(`${code}:${salt}`).digest('hex');
}

export function verifyOtpHash(code: string, salt: string, expectedHash: string): boolean {
  const actualHash = hashOtp(code, salt);
  const actual = Buffer.from(actualHash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function maskWaId(waId: string): string {
  if (waId.length <= 4) return waId;
  const start = waId.slice(0, 2);
  const end = waId.slice(-2);
  return `${start}${'*'.repeat(Math.max(0, waId.length - 4))}${end}`;
}
