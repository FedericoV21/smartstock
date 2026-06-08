import { createHash } from 'node:crypto';

export type ExtractorScope = 'invoice:extract';

type ExtractorKeyRow = {
  id: string;
  nombre: string;
  scopes: string[] | null;
  estado: string;
  rate_limit_por_minuto: number | null;
};

export type ExtractorAuth =
  | {
      ok: true;
      key: ExtractorKeyRow;
    }
  | { ok: false; status: number; error: string };

const keyHits = new Map<string, number[]>();

export function hashExtractorApiKey(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

export function previewExtractorApiKey(token: string): string {
  const t = token.trim();
  return t.length <= 8 ? t : `${t.slice(0, 4)}...${t.slice(-4)}`;
}

function readToken(request: Request): string | null {
  const auth = request.headers.get('authorization')?.trim() ?? '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  const header = request.headers.get('x-api-key')?.trim();
  return header || null;
}

function hasScope(scopes: string[] | null | undefined, scope: ExtractorScope): boolean {
  const set = new Set(scopes ?? []);
  return set.has('*') || set.has('invoice:*') || set.has(scope);
}

function rateLimitOk(keyId: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const existing = (keyHits.get(keyId) ?? []).filter((ts) => ts >= windowStart);
  if (existing.length >= limitPerMinute) {
    keyHits.set(keyId, existing);
    return false;
  }
  existing.push(now);
  keyHits.set(keyId, existing);
  return true;
}

export async function authenticateExtractorKey(params: {
  db: any;
  request: Request;
  scope: ExtractorScope;
  consumeRateLimit?: boolean;
}): Promise<ExtractorAuth> {
  const token = readToken(params.request);
  if (!token) return { ok: false, status: 401, error: 'API key requerida' };

  const keyHash = hashExtractorApiKey(token);
  const { data, error } = await params.db
    .from('api_extractor_key')
    .select('id, nombre, scopes, estado, rate_limit_por_minuto')
    .eq('key_hash', keyHash)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: error.message };
  const key = data as ExtractorKeyRow | null;
  if (!key?.id) return { ok: false, status: 401, error: 'API key invalida' };
  if (key.estado !== 'activa') return { ok: false, status: 403, error: 'API key no activa' };
  if (!hasScope(key.scopes, params.scope)) return { ok: false, status: 403, error: 'Scope insuficiente' };

  if (params.consumeRateLimit !== false) {
    const limit = Math.max(1, Number(key.rate_limit_por_minuto ?? 10));
    if (!rateLimitOk(key.id, limit)) {
      return { ok: false, status: 429, error: 'Rate limit de API key excedido' };
    }
  }

  await params.db
    .from('api_extractor_key')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id);

  return { ok: true, key };
}

