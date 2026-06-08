import { createHash } from 'node:crypto';

import { principalOrFirstActiveSucursalId } from '@/lib/api/sucursal-scope';

type ApiKeyScope =
  | 'lector_facturas:jobs:create'
  | 'lector_facturas:jobs:read'
  | 'lector_facturas:jobs:confirm';

type ApiKeyRow = {
  id: string;
  tenant_id: string;
  sucursal_id: string | null;
  usuario_id: string | null;
  nombre: string;
  scopes: string[] | null;
  estado: string;
  rate_limit_por_minuto: number | null;
};

export type ApiIntegrationAuth =
  | {
      ok: true;
      key: ApiKeyRow;
      tenantId: string;
      sucursalId: string | null;
      userId: string;
    }
  | { ok: false; status: number; error: string };

const keyHits = new Map<string, number[]>();

export function hashApiIntegrationKey(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

export function previewApiIntegrationKey(token: string): string {
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

function hasScope(scopes: string[] | null | undefined, scope: ApiKeyScope): boolean {
  const set = new Set(scopes ?? []);
  if (set.has('*') || set.has('lector_facturas:*') || set.has(scope)) return true;
  return scope === 'lector_facturas:jobs:read' && set.has('lector_facturas:read');
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

async function pickAutomationUserId(db: any, tenantId: string): Promise<string | null> {
  const { data } = await db
    .from('usuario')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .in('rol', ['admin', 'operador'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function validateModule(db: any, tenantId: string): Promise<boolean> {
  const { data, error } = await db
    .from('modulo_config')
    .select('lector_facturas, facturador_simple')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return false;
  return data.lector_facturas === true || data.facturador_simple === true;
}

async function resolveSucursal(params: {
  db: any;
  key: ApiKeyRow;
  requestedSucursalId?: string | null;
}): Promise<{ ok: true; sucursalId: string | null } | { ok: false; status: number; error: string }> {
  const { db, key } = params;
  const requested = params.requestedSucursalId?.trim() || null;

  if (key.sucursal_id && requested && requested !== key.sucursal_id) {
    return { ok: false, status: 403, error: 'La API key no tiene permiso para esa sucursal.' };
  }

  const sucursalId = requested ?? key.sucursal_id ?? await principalOrFirstActiveSucursalId(db, key.tenant_id);
  if (!sucursalId) return { ok: true, sucursalId: null };

  const { data, error } = await db
    .from('sucursal')
    .select('id')
    .eq('id', sucursalId)
    .eq('tenant_id', key.tenant_id)
    .eq('activa', true)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data?.id) return { ok: false, status: 404, error: 'Sucursal no encontrada o inactiva.' };

  return { ok: true, sucursalId };
}

export async function authenticateApiIntegrationKey(params: {
  db: any;
  request: Request;
  scope: ApiKeyScope;
  requestedSucursalId?: string | null;
  consumeRateLimit?: boolean;
}): Promise<ApiIntegrationAuth> {
  const token = readToken(params.request);
  if (!token) return { ok: false, status: 401, error: 'API key requerida' };

  const keyHash = hashApiIntegrationKey(token);
  const { data, error } = await params.db
    .from('api_integracion_key')
    .select('id, tenant_id, sucursal_id, usuario_id, nombre, scopes, estado, rate_limit_por_minuto')
    .eq('key_hash', keyHash)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: error.message };
  const key = data as ApiKeyRow | null;
  if (!key?.id) return { ok: false, status: 401, error: 'API key invalida' };
  if (key.estado !== 'activa') return { ok: false, status: 403, error: 'API key no activa' };
  if (!hasScope(key.scopes, params.scope)) return { ok: false, status: 403, error: 'Scope insuficiente' };

  const moduleOk = await validateModule(params.db, key.tenant_id);
  if (!moduleOk) {
    return {
      ok: false,
      status: 403,
      error: 'El modulo lector de facturas no esta habilitado para este tenant.',
    };
  }

  if (params.consumeRateLimit !== false) {
    const limit = Math.max(1, Number(key.rate_limit_por_minuto ?? 10));
    if (!rateLimitOk(key.id, limit)) {
      return { ok: false, status: 429, error: 'Rate limit de API key excedido' };
    }
  }

  const sucursal = await resolveSucursal({
    db: params.db,
    key,
    requestedSucursalId: params.requestedSucursalId,
  });
  if (!sucursal.ok) return sucursal;

  const userId = key.usuario_id ?? await pickAutomationUserId(params.db, key.tenant_id);
  if (!userId) {
    return { ok: false, status: 500, error: 'No hay usuario admin/operador para auditar la operacion.' };
  }

  await params.db
    .from('api_integracion_key')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id);

  return {
    ok: true,
    key,
    tenantId: key.tenant_id,
    sucursalId: sucursal.sucursalId,
    userId,
  };
}
