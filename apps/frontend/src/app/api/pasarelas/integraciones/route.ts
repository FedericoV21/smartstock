import { NextResponse } from 'next/server';

import { puedeGestionarEstructuraCajas } from '@/lib/api/cajas-config-permissions';
import { idsSucursalesOperables, resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { getPasarelaAdapter } from '@/lib/pasarelas/adapters';
import { encryptSecretsRecord, sanitizeIntegracion } from '@/lib/pasarelas/secrets';
import type { JsonRecord, PasarelaCanal, PasarelaEstado } from '@/lib/pasarelas/types';

const CANALES: PasarelaCanal[] = ['qr', 'terminal'];
const ESTADOS: PasarelaEstado[] = ['activa', 'inactiva', 'incompleta'];

function cleanSlug(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z0-9_]+$/.test(raw) ? raw : '';
}

function cleanNombre(value: unknown): string {
  return (typeof value === 'string' ? value.trim() : '').slice(0, 120);
}

function cleanEstado(value: unknown, fallback: PasarelaEstado): PasarelaEstado {
  return ESTADOS.includes(value as PasarelaEstado) ? (value as PasarelaEstado) : fallback;
}

function cleanCanal(value: unknown): PasarelaCanal | null {
  return CANALES.includes(value as PasarelaCanal) ? (value as PasarelaCanal) : null;
}

function jsonRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function tablaLegacyPasarela(origen: unknown): 'mp_point_config' | 'mp_qr_config' | null {
  if (origen === 'mp_point_config') return 'mp_point_config';
  if (origen === 'mp_qr_config') return 'mp_qr_config';
  return null;
}

async function desactivarConfigLegacySiCorresponde(params: {
  db: any;
  tenantId: string;
  integracion: { origen_legacy?: unknown; legacy_config_id?: unknown };
}): Promise<string | null> {
  const table = tablaLegacyPasarela(params.integracion.origen_legacy);
  const legacyId =
    typeof params.integracion.legacy_config_id === 'string'
      ? params.integracion.legacy_config_id.trim()
      : '';
  if (!table || !legacyId) return null;

  const { error } = await params.db
    .from(table)
    .update({ habilitado: false })
    .eq('tenant_id', params.tenantId)
    .eq('id', legacyId);
  return error?.message ?? null;
}

function queryIntegraciones(params: {
  db: any;
  tenantId: string;
  sucursalId?: string | null;
  sucursalIds?: string[];
  id?: string | null;
}) {
  let q = params.db
    .from('pasarela_integracion')
    .select('*')
    .eq('tenant_id', params.tenantId)
    .order('nombre', { ascending: true });
  if (params.id) q = q.eq('id', params.id);
  if (params.sucursalId) q = q.eq('sucursal_id', params.sucursalId);
  if (params.sucursalIds) q = q.in('sucursal_id', params.sucursalIds);
  return q;
}

async function assertGestionable() {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return { ok: false as const, response: guard.response };

  const session = await getTenantSession();
  if ('error' in session) return { ok: false as const, response: session.error };

  if (!(await puedeGestionarEstructuraCajas(session))) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Sin permisos para gestionar pasarelas.' }, { status: 403 }),
    };
  }

  return { ok: true as const, session, db: session.supabase as any };
}

export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const url = new URL(request.url);
  const scope = await resolveAndValidateSucursalScope(session, url.searchParams.get('sucursal_id'));
  if (!scope.ok) return scope.response;

  let sucursalIds: string[] | undefined;
  if (!scope.sucursalId) {
    const operables = await idsSucursalesOperables(session);
    if (!operables.ok) return operables.response;
    if (operables.ids.length === 0) return NextResponse.json({ integraciones: [] });
    sucursalIds = operables.ids;
  }

  const { data, error } = await queryIntegraciones({
    db: session.supabase as any,
    tenantId: session.tenantId,
    sucursalId: scope.sucursalId,
    sucursalIds,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ integraciones: (data ?? []).map((row: any) => sanitizeIntegracion(row)) });
}

export async function POST(request: Request) {
  const resolved = await assertGestionable();
  if (!resolved.ok) return resolved.response;
  const { session, db } = resolved;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const scope = await resolveAndValidateSucursalScope(session, String(body.sucursal_id ?? ''));
  if (!scope.ok) return scope.response;
  if (!scope.sucursalId) {
    return NextResponse.json({ error: 'sucursal_id es obligatorio' }, { status: 400 });
  }

  const proveedor = cleanSlug(body.proveedor);
  const tipo = cleanSlug(body.tipo);
  const canal = cleanCanal(body.canal);
  const nombre = cleanNombre(body.nombre);
  if (!proveedor || !tipo || !canal || !nombre) {
    return NextResponse.json(
      { error: 'proveedor, tipo, canal y nombre son obligatorios' },
      { status: 400 },
    );
  }

  const row = {
    tenant_id: session.tenantId,
    sucursal_id: scope.sucursalId,
    proveedor,
    canal,
    tipo,
    nombre,
    estado: cleanEstado(body.estado, 'incompleta'),
    config_publica: jsonRecord(body.config_publica),
    secretos_cifrados: encryptSecretsRecord(body.secretos),
  };

  const adapter = getPasarelaAdapter(tipo);
  if (row.estado === 'activa' && adapter) {
    const validation = adapter.validateConfig(row as any);
    if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { data, error } = await db.from('pasarela_integracion').insert(row).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ integracion: sanitizeIntegracion(data) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const resolved = await assertGestionable();
  if (!resolved.ok) return resolved.response;
  const { session, db } = resolved;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return NextResponse.json({ error: 'id es obligatorio' }, { status: 400 });

  const { data: current, error: currentErr } = await queryIntegraciones({
    db,
    tenantId: session.tenantId,
    id,
  }).maybeSingle();
  if (currentErr) return NextResponse.json({ error: currentErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Integracion no encontrada' }, { status: 404 });

  const scope = await resolveAndValidateSucursalScope(session, current.sucursal_id);
  if (!scope.ok) return scope.response;

  const patch: Record<string, unknown> = {};
  if ('nombre' in body) {
    const nombre = cleanNombre(body.nombre);
    if (!nombre) return NextResponse.json({ error: 'nombre no puede quedar vacio' }, { status: 400 });
    patch.nombre = nombre;
  }
  if ('estado' in body) patch.estado = cleanEstado(body.estado, current.estado);
  if ('config_publica' in body) patch.config_publica = jsonRecord(body.config_publica);
  if ('secretos' in body) {
    patch.secretos_cifrados = {
      ...(current.secretos_cifrados ?? {}),
      ...encryptSecretsRecord(body.secretos),
    };
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ integracion: sanitizeIntegracion(current) });
  }

  const next = { ...current, ...patch };
  const adapter = getPasarelaAdapter(String(current.tipo));
  if (patch.estado === 'activa' && adapter) {
    const validation = adapter.validateConfig(next);
    if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { data, error } = await db
    .from('pasarela_integracion')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ integracion: sanitizeIntegracion(data) });
}

export async function DELETE(request: Request) {
  const resolved = await assertGestionable();
  if (!resolved.ok) return resolved.response;
  const { session, db } = resolved;

  const url = new URL(request.url);
  let id = url.searchParams.get('id')?.trim() ?? '';
  if (!id) {
    try {
      const body = (await request.json()) as { id?: string };
      id = body.id?.trim() ?? '';
    } catch {
      /* body opcional */
    }
  }
  if (!id) return NextResponse.json({ error: 'id es obligatorio' }, { status: 400 });

  const { data: current, error: currentErr } = await queryIntegraciones({
    db,
    tenantId: session.tenantId,
    id,
  }).maybeSingle();
  if (currentErr) return NextResponse.json({ error: currentErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Integracion no encontrada' }, { status: 404 });

  const scope = await resolveAndValidateSucursalScope(session, current.sucursal_id);
  if (!scope.ok) return scope.response;

  const { count, error: countErr } = await db
    .from('pasarela_transaccion')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', session.tenantId)
    .eq('integracion_id', id)
    .in('estado', ['creada', 'iniciada', 'pendiente', 'fiscalizando']);
  if (countErr && countErr.code !== '42P01') {
    return NextResponse.json({ error: countErr.message }, { status: 500 });
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'No se puede borrar una integracion con cobros activos.' },
      { status: 409 },
    );
  }

  const { error } = await db.from('pasarela_integracion').delete().eq('id', id).eq('tenant_id', session.tenantId);
  if (error) {
    if (error.code === '23503') {
      return NextResponse.json(
        {
          error:
            'No se pudo borrar porque hay transacciones historicas asociadas. Aplica la migracion 175_pasarela_transaccion_integracion_set_null.sql y reintenta.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const legacyError = await desactivarConfigLegacySiCorresponde({
    db,
    tenantId: session.tenantId,
    integracion: current,
  });
  if (legacyError) {
    return NextResponse.json({ error: legacyError }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
