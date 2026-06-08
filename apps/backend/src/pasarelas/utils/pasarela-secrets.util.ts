import type { LegacyFieldCryptoService } from '../../common/crypto/legacy-field-crypto.service';
import type { PasarelaIntegracion } from '../entities/pasarela-integracion.entity';

export function stringFromUnknown(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t ? t : null;
}

export function decryptPasarelaSecret(
  crypto: LegacyFieldCryptoService,
  value: unknown,
): string | null {
  const raw = stringFromUnknown(value);
  if (!raw) return null;
  const decrypted = crypto.tryDecrypt(raw);
  return decrypted ?? raw;
}

export function getPasarelaSecret(
  crypto: LegacyFieldCryptoService,
  integracion: Pick<PasarelaIntegracion, 'secretosCifrados'>,
  key: string,
): string | null {
  const bag = integracion.secretosCifrados;
  if (!bag || typeof bag !== 'object') return null;
  return decryptPasarelaSecret(crypto, bag[key]);
}

export function encryptSecretsRecord(
  crypto: LegacyFieldCryptoService,
  input: unknown,
): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const raw = stringFromUnknown(value);
    if (raw) out[key] = crypto.encrypt(raw);
  }
  return out;
}

export function listSecretosConfigurados(secretosCifrados: Record<string, unknown> | null | undefined): string[] {
  if (!secretosCifrados || typeof secretosCifrados !== 'object' || Array.isArray(secretosCifrados)) {
    return [];
  }
  return Object.entries(secretosCifrados)
    .filter(([, v]) => stringFromUnknown(v) != null)
    .map(([k]) => k);
}

export function serializeIntegracion(row: PasarelaIntegracion) {
  const secretos = listSecretosConfigurados(row.secretosCifrados);
  return {
    id: row.id,
    tenant_id: row.tenantId,
    sucursal_id: row.sucursalId,
    proveedor: row.proveedor,
    canal: row.canal,
    tipo: row.tipo,
    nombre: row.nombre,
    estado: row.estado,
    config_publica: row.configPublica ?? {},
    webhook_public_id: row.webhookPublicId,
    origen_legacy: row.origenLegacy,
    legacy_config_id: row.legacyConfigId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    secretos_configurados: secretos,
  };
}

export function cleanSlug(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z0-9_]+$/.test(raw) ? raw : '';
}

export function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export const PASARELA_CANALES = ['qr', 'terminal'] as const;
export const PASARELA_ESTADOS = ['activa', 'inactiva', 'incompleta'] as const;

export const TRANSACCION_ESTADOS_ACTIVOS = ['creada', 'iniciada', 'pendiente', 'fiscalizando'];
