import { NextResponse } from 'next/server';

import { puedeGestionarEstructuraCajas } from '@/lib/api/cajas-config-permissions';
import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { normalizeCajaPrefs } from '@/lib/caja/prefs';
import { createServiceRoleClient } from '@/lib/supabase/server';

function labelUsuario(u: {
  nombre?: string | null;
  apellido?: string | null;
  email?: string | null;
  username_local?: string | null;
}): string {
  const n = [u.nombre, u.apellido].filter(Boolean).join(' ').trim();
  if (n) return n;
  if (u.username_local) return String(u.username_local);
  return String(u.email ?? '').trim() || '—';
}

type CajaConfigApiRow = {
  id: string;
  sucursal_id: string;
  numero: number;
  nombre: string;
  activa: boolean;
  usuario_default_id: string | null;
  auto_cierre_horas?: number | null;
};

async function enriquecerCajasConTurnoAbierto(db: any, tenantId: string, cajas: CajaConfigApiRow[]) {
  const cajaIds = cajas.map((c) => c.id);
  if (cajaIds.length === 0) return cajas;

  const { data: turnos, error: tErr } = await db
    .from('caja_turno')
    .select('id, caja_id, usuario_id, abierto_at')
    .eq('tenant_id', tenantId)
    .eq('estado', 'abierto')
    .in('caja_id', cajaIds);
  if (tErr) throw new Error(tErr.message);

  const turnosRows = (turnos ?? []) as { id: string; caja_id: string; usuario_id: string; abierto_at: string }[];
  const usuarioIds = [...new Set(turnosRows.map((t) => t.usuario_id).filter(Boolean))];
  const usuariosById = new Map<string, string>();

  if (usuarioIds.length > 0) {
    const { data: users, error: uErr } = await db
      .from('usuario')
      .select('id, nombre, apellido, email')
      .eq('tenant_id', tenantId)
      .in('id', usuarioIds);
    if (uErr) throw new Error(uErr.message);

    const { data: creds, error: cErr } = await db
      .from('usuario_credencial_local')
      .select('usuario_id, username_local')
      .in('usuario_id', usuarioIds);
    if (cErr) throw new Error(cErr.message);

    const credMap = new Map(
      ((creds ?? []) as { usuario_id: string; username_local: string | null }[]).map((c) => [
        c.usuario_id,
        c.username_local,
      ]),
    );
    for (const u of (users ?? []) as {
      id: string;
      nombre?: string | null;
      apellido?: string | null;
      email?: string | null;
    }[]) {
      usuariosById.set(
        u.id,
        labelUsuario({
          nombre: u.nombre ?? null,
          apellido: u.apellido ?? null,
          email: u.email ?? null,
          username_local: credMap.get(u.id) ?? null,
        }),
      );
    }
  }

  const turnoByCaja = new Map(turnosRows.map((t) => [t.caja_id, t]));
  return cajas.map((c) => {
    const turno = turnoByCaja.get(c.id);
    const row = c as CajaConfigApiRow & { prefs?: unknown };
    return {
      ...c,
      prefs: normalizeCajaPrefs(row.prefs),
      estado_turno: turno ? 'abierta' : 'cerrada',
      turno_abierto: turno
        ? {
            id: turno.id,
            abierto_at: turno.abierto_at,
            usuario_id: turno.usuario_id,
            usuario_label: usuariosById.get(turno.usuario_id) ?? 'Usuario sin nombre',
          }
        : null,
    };
  });
}

/**
 * GET ?sucursal_id= — cajas del tenant en esa sucursal (debe ser operable por el usuario).
 * Sin query: lista sucursales operables + misma info mínima para armar el selector inicial.
 */
export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const sp = new URL(request.url).searchParams;
  const sucursalParam = sp.get('sucursal_id')?.trim() || '';

  const operables = await idsSucursalesOperables(session);
  if (!operables.ok) return operables.response;

  const db = createServiceRoleClient() as any;
  const puede = await puedeGestionarEstructuraCajas(session);

  if (operables.ids.length === 0) {
    return NextResponse.json({
      sucursales: [],
      sucursal_id: null,
      cajas: [],
      puede_gestionar: puede,
      usuarios_opciones: [],
    });
  }

  const { data: surs, error: surErr } = await db
    .from('sucursal')
    .select('id, nombre, codigo')
    .eq('tenant_id', session.tenantId)
    .eq('activa', true)
    .in('id', operables.ids)
    .order('nombre', { ascending: true });

  if (surErr) return NextResponse.json({ error: surErr.message }, { status: 500 });

  const sucursales = (surs ?? []) as { id: string; nombre: string; codigo: string }[];
  if (sucursales.length === 0) {
    return NextResponse.json({
      sucursales: [],
      sucursal_id: null,
      cajas: [],
      puede_gestionar: puede,
      usuarios_opciones: [],
    });
  }

  let sucursalId = sucursalParam;
  if (!sucursalId || !operables.ids.includes(sucursalId)) {
    sucursalId = sucursales[0]?.id ?? operables.ids[0] ?? '';
  }
  if (!sucursalId || !operables.ids.includes(sucursalId)) {
    return NextResponse.json({ error: 'Sucursal no disponible.' }, { status: 403 });
  }

  const resolvedSucursalId: string = sucursalId;

  const { data: cajas, error: cErr } = await db
    .from('caja')
    .select('id, sucursal_id, numero, nombre, activa, usuario_default_id, auto_cierre_horas, prefs')
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', resolvedSucursalId)
    .order('numero', { ascending: true });

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  const cajasEnSucursal = (cajas ?? []) as CajaConfigApiRow[];
  let cajas_gestion = cajasEnSucursal;
  if (puede) {
    const { data: cajasTodas, error: cTodasErr } = await db
      .from('caja')
      .select('id, sucursal_id, numero, nombre, activa, usuario_default_id, auto_cierre_horas, prefs')
      .eq('tenant_id', session.tenantId)
      .in('sucursal_id', operables.ids)
      .order('sucursal_id', { ascending: true })
      .order('numero', { ascending: true });
    if (cTodasErr) return NextResponse.json({ error: cTodasErr.message }, { status: 500 });
    cajas_gestion = (cajasTodas ?? []) as CajaConfigApiRow[];
  }

  let cajasGestionConEstado;
  try {
    cajasGestionConEstado = await enriquecerCajasConTurnoAbierto(db, session.tenantId, cajas_gestion);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al consultar estado de cajas';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  let usuarios_opciones: { id: string; label: string }[] = [];
  if (puede) {
    const { data: users, error: uErr } = await db
      .from('usuario')
      .select('id, nombre, apellido, email')
      .eq('tenant_id', session.tenantId)
      .eq('activo', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    const uids = (users ?? []).map((u: { id: string }) => u.id);
    const { data: creds } = uids.length
      ? await db.from('usuario_credencial_local').select('usuario_id, username_local').in('usuario_id', uids)
      : { data: [] };
    const credRows = (creds ?? []) as { usuario_id: string; username_local: string }[];
    const credMap = new Map<string, string>(credRows.map((c) => [c.usuario_id, c.username_local]));
    const userRows = (users ?? []) as {
      id: string;
      nombre?: string | null;
      apellido?: string | null;
      email?: string | null;
    }[];
    usuarios_opciones = userRows.map((u) => {
      const usernameLocal = credMap.get(u.id);
      return {
        id: u.id,
        label: labelUsuario({
          nombre: u.nombre ?? null,
          apellido: u.apellido ?? null,
          email: u.email ?? null,
          username_local: usernameLocal !== undefined ? usernameLocal : null,
        }),
      };
    });
  }

  return NextResponse.json({
    sucursales,
    sucursal_id: resolvedSucursalId,
    cajas: cajasEnSucursal,
    cajas_gestion: cajasGestionConEstado,
    puede_gestionar: puede,
    usuarios_opciones,
  });
}

export async function POST(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  if (!(await puedeGestionarEstructuraCajas(session))) {
    return NextResponse.json({ error: 'Sin permisos para crear cajas.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const sucursalId = String(body.sucursal_id ?? '').trim();
  const nombre = String(body.nombre ?? '').trim().slice(0, 120);
  const numeroRaw = body.numero;
  const numero = typeof numeroRaw === 'number' ? numeroRaw : Number(numeroRaw);

  if (!sucursalId || !nombre) {
    return NextResponse.json({ error: 'sucursal_id y nombre son obligatorios.' }, { status: 400 });
  }
  if (!Number.isInteger(numero) || numero < 1) {
    return NextResponse.json({ error: 'numero debe ser un entero ≥ 1.' }, { status: 400 });
  }

  const operables = await idsSucursalesOperables(session);
  if (!operables.ok) return operables.response;
  if (!operables.ids.includes(sucursalId)) {
    return NextResponse.json({ error: 'No podés crear cajas en esa sucursal.' }, { status: 403 });
  }

  const db = createServiceRoleClient() as any;
  const { data: sRow, error: sErr } = await db
    .from('sucursal')
    .select('id')
    .eq('id', sucursalId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (sErr || !sRow) {
    return NextResponse.json({ error: sErr?.message ?? 'Sucursal no encontrada.' }, { status: 404 });
  }

  let usuarioDefault: string | null = null;
  const ud = body.usuario_default_id;
  if (ud != null && String(ud).trim() !== '') {
    const uid = String(ud).trim();
    const { data: uOk } = await db
      .from('usuario')
      .select('id')
      .eq('id', uid)
      .eq('tenant_id', session.tenantId)
      .maybeSingle();
    if (!uOk) {
      return NextResponse.json({ error: 'Usuario por defecto inválido para este negocio.' }, { status: 400 });
    }
    usuarioDefault = uid;
  }

  const { data: created, error } = await db
    .from('caja')
    .insert({
      tenant_id: session.tenantId,
      sucursal_id: sucursalId,
      numero,
      nombre,
      usuario_default_id: usuarioDefault,
      activa: true,
    })
    .select('id, sucursal_id, numero, nombre, activa, usuario_default_id, auto_cierre_horas')
    .single();

  if (error) {
    const dup = String(error.code) === '23505';
    return NextResponse.json(
      { error: dup ? 'Ya existe una caja con ese número en la sucursal.' : error.message },
      { status: dup ? 409 : 400 },
    );
  }

  return NextResponse.json(created, { status: 201 });
}
