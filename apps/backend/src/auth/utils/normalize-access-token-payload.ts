import type { AccessTokenPayload } from '../interfaces/access-token-payload.interface';

/**
 * Alinea el payload del JWT con lo que espera Nest (`tenant_id`, `rol`, etc.)
 * cuando el emisor es Supabase: claims custom suelen ir en `app_metadata` / `user_metadata`.
 */
export function normalizeAccessTokenPayload(raw: Record<string, unknown>): AccessTokenPayload {
  const out = { ...raw } as AccessTokenPayload;

  const mergeFrom = (obj: unknown) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return;
    }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v === undefined || v === null) {
        continue;
      }
      const cur = (out as Record<string, unknown>)[k];
      if (cur === undefined || cur === null) {
        (out as Record<string, unknown>)[k] = v;
      }
    }
  };

  mergeFrom(raw['app_metadata']);
  mergeFrom(raw['user_metadata']);

  return out;
}
