import { desencriptarCampo, encriptarCampo } from '@/lib/facturacion/arca/crypto';

import type { JsonRecord, PasarelaIntegracionRow } from './types';

export function stringFromUnknown(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t ? t : null;
}

export function decryptPasarelaSecret(value: unknown): string | null {
  const raw = stringFromUnknown(value);
  if (!raw) return null;
  try {
    return desencriptarCampo(raw);
  } catch {
    /*
     * Backfills desde tablas legacy pueden traer algun secreto que ya existia sin cifrar
     * (por ejemplo webhook_secret). Se acepta como compatibilidad de transicion.
     */
    return raw;
  }
}

export function getPasarelaSecret(
  integracion: Pick<PasarelaIntegracionRow, 'secretos_cifrados'>,
  key: string,
): string | null {
  return decryptPasarelaSecret(integracion.secretos_cifrados?.[key]);
}

export function encryptSecretsRecord(input: unknown): JsonRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const raw = stringFromUnknown(value);
    if (raw) out[key] = encriptarCampo(raw);
  }
  return out;
}

export function sanitizeIntegracion<T extends { secretos_cifrados?: unknown }>(row: T): Omit<T, 'secretos_cifrados'> & {
  secretos_configurados: string[];
} {
  const secretos =
    row.secretos_cifrados && typeof row.secretos_cifrados === 'object' && !Array.isArray(row.secretos_cifrados)
      ? Object.entries(row.secretos_cifrados as Record<string, unknown>)
          .filter(([, v]) => stringFromUnknown(v) != null)
          .map(([k]) => k)
      : [];
  const { secretos_cifrados: _secretos, ...rest } = row;
  return { ...(rest as Omit<T, 'secretos_cifrados'>), secretos_configurados: secretos };
}
