import { NextResponse } from 'next/server';

import { puedeGestionarEstructuraCajas } from '@/lib/api/cajas-config-permissions';
import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { sanitizeIntegracion } from '@/lib/pasarelas/secrets';

type RouteParams = { params: Promise<{ id: string }> };

async function resolveCaja(ctx: RouteParams) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return { ok: false as const, response: guard.response };

  const session = await getTenantSession();
  if ('error' in session) return { ok: false as const, response: session.error };

  const { id } = await ctx.params;
  const cajaId = String(id ?? '').trim();
  if (!cajaId) {
    return { ok: false as const, response: NextResponse.json({ error: 'id invalido' }, { status: 400 }) };
  }

  const db = session.supabase as any;
  const { data: caja, error } = await db
    .from('caja')
    .select('id, tenant_id, sucursal_id, numero, nombre, activa')
    .eq('id', cajaId)
    .maybeSingle();
  if (error) return { ok: false as const, response: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!caja || caja.tenant_id !== session.tenantId) {
    return { ok: false as const, response: NextResponse.json({ error: 'Caja no encontrada' }, { status: 404 }) };
  }

  const operables = await idsSucursalesOperables(session);
  if (!operables.ok) return { ok: false as const, response: operables.response };
  if (!operables.ids.includes(String(caja.sucursal_id))) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'No podes operar esta caja.' }, { status: 403 }),
    };
  }

  return { ok: true as const, session, db, cajaId, caja };
}

function aliasValue(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim().slice(0, 120) : '';
  return raw || null;
}

function ordenValue(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 10000) return fallback;
  return n;
}

export async function GET(request: Request, ctx: RouteParams) {
  const resolved = await resolveCaja(ctx);
  if (!resolved.ok) return resolved.response;
  const { session, db, cajaId, caja } = resolved;

  const soloHabilitadas = new URL(request.url).searchParams.get('solo_habilitadas') === '1';
  const { data: links, error } = await db
    .from('pasarela_caja')
    .select('id, caja_id, integracion_id, habilitado, alias, orden')
    .eq('tenant_id', session.tenantId)
    .eq('caja_id', cajaId)
    .order('orden', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = [...new Set((links ?? []).map((row: any) => String(row.integracion_id)).filter(Boolean))];
  if (ids.length === 0) return NextResponse.json({ pasarelas: [] });

  const { data: integraciones, error: iErr } = await db
    .from('pasarela_integracion')
    .select('*')
    .eq('tenant_id', session.tenantId)
    .in('id', ids);
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  const byId = new Map<string, any>((integraciones ?? []).map((row: any) => [String(row.id), row]));
  const pasarelas = (links ?? [])
    .map((link: any) => {
      const integracion = byId.get(String(link.integracion_id));
      if (!integracion) return null;
      if (String(integracion.sucursal_id) !== String(caja.sucursal_id)) return null;
      if (soloHabilitadas && (!link.habilitado || integracion.estado !== 'activa')) return null;
      const clean = sanitizeIntegracion(integracion) as any;
      const alias = aliasValue(link.alias);
      return {
        ...clean,
        pasarela_caja_id: link.id,
        habilitado: Boolean(link.habilitado),
        alias,
        orden: Number(link.orden ?? 0),
        nombre_integracion: clean.nombre,
        nombre: alias ?? clean.nombre,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ pasarelas });
}

export async function PATCH(request: Request, ctx: RouteParams) {
  const resolved = await resolveCaja(ctx);
  if (!resolved.ok) return resolved.response;
  const { session, db, cajaId, caja } = resolved;

  if (!(await puedeGestionarEstructuraCajas(session))) {
    return NextResponse.json({ error: 'Sin permisos para editar cajas.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const rows = Array.isArray(body.pasarelas) ? body.pasarelas : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: 'pasarelas debe incluir al menos una integracion' }, { status: 400 });
  }

  const integracionIds = [
    ...new Set(
      rows
        .map((row: any) => (typeof row?.integracion_id === 'string' ? row.integracion_id.trim() : ''))
        .filter(Boolean),
    ),
  ];
  if (integracionIds.length !== rows.length) {
    return NextResponse.json({ error: 'Cada fila necesita integracion_id unico' }, { status: 400 });
  }

  const { data: integraciones, error: iErr } = await db
    .from('pasarela_integracion')
    .select('id, tenant_id, sucursal_id')
    .eq('tenant_id', session.tenantId)
    .in('id', integracionIds);
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  const found = new Map<string, any>((integraciones ?? []).map((row: any) => [String(row.id), row]));
  for (const id of integracionIds) {
    const integracion = found.get(id);
    if (!integracion) {
      return NextResponse.json({ error: 'Integracion no encontrada' }, { status: 404 });
    }
    if (String(integracion.sucursal_id) !== String(caja.sucursal_id)) {
      return NextResponse.json(
        { error: 'La integracion debe pertenecer a la misma sucursal que la caja.' },
        { status: 400 },
      );
    }
  }

  const upserts = rows.map((row: any, idx: number) => ({
    tenant_id: session.tenantId,
    caja_id: cajaId,
    integracion_id: String(row.integracion_id).trim(),
    habilitado: row.habilitado !== false,
    alias: aliasValue(row.alias),
    orden: ordenValue(row.orden, idx * 10),
  }));

  const { error } = await db
    .from('pasarela_caja')
    .upsert(upserts, { onConflict: 'caja_id,integracion_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
