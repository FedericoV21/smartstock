import { NextResponse } from 'next/server';

import { puedeGestionarEstructuraCajas } from '@/lib/api/cajas-config-permissions';
import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import {
  isCajaPrefsPayload,
  mergeCajaPrefsPatch,
  normalizeCajaPrefs,
} from '@/lib/caja/prefs';
import { loadEffectiveBusinessPrefs } from '@/lib/business-prefs/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

type RouteParams = { params: Promise<{ id: string }> };

async function requireCajaGestionable(ctx: RouteParams) {
  const session = await getTenantSession();
  if ('error' in session) return { ok: false as const, response: session.error };

  if (!(await puedeGestionarEstructuraCajas(session))) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Sin permisos para editar cajas.' }, { status: 403 }),
    };
  }

  const { id: cajaId } = await ctx.params;
  const id = String(cajaId ?? '').trim();
  if (!id) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'id inválido' }, { status: 400 }),
    };
  }

  const db = createServiceRoleClient() as any;
  const { data: row, error: fErr } = await db
    .from('caja')
    .select('id, tenant_id, sucursal_id, numero')
    .eq('id', id)
    .maybeSingle();

  if (fErr) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: fErr.message }, { status: 500 }),
    };
  }
  if (!row || row.tenant_id !== session.tenantId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Caja no encontrada.' }, { status: 404 }),
    };
  }

  const operables = await idsSucursalesOperables(session);
  if (!operables.ok) return { ok: false as const, response: operables.response };
  if (!operables.ids.includes(String(row.sucursal_id))) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'No podés editar cajas de esa sucursal.' }, { status: 403 }),
    };
  }

  return { ok: true as const, session, db, id, row, operables };
}

export async function PATCH(request: Request, ctx: RouteParams) {
  const resolved = await requireCajaGestionable(ctx);
  if (!resolved.ok) return resolved.response;
  const { session, db, id, row, operables } = resolved;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if ('nombre' in body) {
    const nombre = String(body.nombre ?? '').trim().slice(0, 120);
    if (!nombre) {
      return NextResponse.json({ error: 'nombre no puede quedar vacío.' }, { status: 400 });
    }
    patch.nombre = nombre;
  }

  if ('sucursal_id' in body) {
    const destinoId = String(body.sucursal_id ?? '').trim();
    if (!destinoId) {
      return NextResponse.json({ error: 'sucursal_id no puede quedar vacío.' }, { status: 400 });
    }
    if (!operables.ids.includes(destinoId)) {
      return NextResponse.json({ error: 'No podés mover cajas a esa sucursal.' }, { status: 403 });
    }

    const origenId = String(row.sucursal_id);
    if (destinoId !== origenId) {
      const { data: sucursalDestino, error: sErr } = await db
        .from('sucursal')
        .select('id')
        .eq('id', destinoId)
        .eq('tenant_id', session.tenantId)
        .eq('activa', true)
        .maybeSingle();
      if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
      if (!sucursalDestino) {
        return NextResponse.json({ error: 'Sucursal destino no encontrada o inactiva.' }, { status: 400 });
      }

      const { count: turnosAbiertos, error: tErr } = await db
        .from('caja_turno')
        .select('id', { count: 'exact', head: true })
        .eq('caja_id', id)
        .eq('estado', 'abierto');
      if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
      if ((turnosAbiertos ?? 0) > 0) {
        return NextResponse.json(
          { error: 'Hay un turno de caja abierto en esta caja. Cerralo antes de moverla de sucursal.' },
          { status: 409 },
        );
      }

      const { data: duplicada, error: dErr } = await db
        .from('caja')
        .select('id')
        .eq('tenant_id', session.tenantId)
        .eq('sucursal_id', destinoId)
        .eq('numero', row.numero)
        .neq('id', id)
        .maybeSingle();
      if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
      if (duplicada) {
        return NextResponse.json(
          { error: `Ya existe una caja Nº ${row.numero} en la sucursal destino.` },
          { status: 409 },
        );
      }

      patch.sucursal_id = destinoId;
    }
  }

  if ('activa' in body) {
    if (typeof body.activa !== 'boolean') {
      return NextResponse.json({ error: 'activa debe ser booleano.' }, { status: 400 });
    }
    if (body.activa === false) {
      const { count, error: tErr } = await db
        .from('caja_turno')
        .select('id', { count: 'exact', head: true })
        .eq('caja_id', id)
        .eq('estado', 'abierto');
      if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          { error: 'Hay un turno de caja abierto en esta caja. Cerralo antes de desactivarla.' },
          { status: 409 },
        );
      }
    }
    patch.activa = body.activa;
  }

  if ('usuario_default_id' in body) {
    const ud = body.usuario_default_id;
    if (ud === null || ud === '' || (typeof ud === 'string' && !ud.trim())) {
      patch.usuario_default_id = null;
    } else {
      const uid = String(ud).trim();
      const { data: uOk } = await db
        .from('usuario')
        .select('id')
        .eq('id', uid)
        .eq('tenant_id', session.tenantId)
        .maybeSingle();
      if (!uOk) {
        return NextResponse.json({ error: 'Usuario por defecto inválido.' }, { status: 400 });
      }
      patch.usuario_default_id = uid;
    }
  }

  if ('prefs' in body) {
    const rawPrefs = body.prefs;
    if (!isCajaPrefsPayload(rawPrefs)) {
      return NextResponse.json({ error: 'prefs inválido.' }, { status: 400 });
    }
    const biz = await loadEffectiveBusinessPrefs(
      db,
      session.tenantId,
      String(row.sucursal_id),
    );
    if (!biz.cuentaCorrienteDistribuidora.permitirAjustesPorCaja) {
      return NextResponse.json(
        {
          error:
            'Activá «Permitir ajustes por caja» en preferencias de la sucursal antes de configurar esta caja.',
        },
        { status: 409 },
      );
    }
    const { data: cajaPrefsRow, error: pErr } = await db
      .from('caja')
      .select('prefs')
      .eq('id', id)
      .maybeSingle();
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    const current = normalizeCajaPrefs((cajaPrefsRow as { prefs?: unknown } | null)?.prefs);
    const merged = mergeCajaPrefsPatch(current, rawPrefs as Parameters<typeof mergeCajaPrefsPatch>[1]);
    patch.prefs = merged;
  }

  if ('auto_cierre_horas' in body) {
    const v = body.auto_cierre_horas;
    if (v === null || v === '' || v === undefined) {
      patch.auto_cierre_horas = null;
    } else {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 168) {
        return NextResponse.json(
          { error: 'auto_cierre_horas debe ser un entero entre 1 y 168, o vacío para desactivar.' },
          { status: 400 },
        );
      }
      patch.auto_cierre_horas = n;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nada para actualizar.' }, { status: 400 });
  }

  const { data: updated, error } = await db
    .from('caja')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .select('id, sucursal_id, numero, nombre, activa, usuario_default_id, auto_cierre_horas, prefs')
    .single();

  if (updated) {
    (updated as { prefs?: unknown }).prefs = normalizeCajaPrefs(
      (updated as { prefs?: unknown }).prefs,
    );
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, ctx: RouteParams) {
  const resolved = await requireCajaGestionable(ctx);
  if (!resolved.ok) return resolved.response;
  const { session, db, id } = resolved;

  const [
    { count: turnos, error: tErr },
    { count: comprobantes, error: compErr },
    { count: aperturas, error: apErr },
    { count: cierres, error: czErr },
  ] = await Promise.all([
    db
      .from('caja_turno')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', session.tenantId)
      .eq('caja_id', id),
    db
      .from('comprobante')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', session.tenantId)
      .eq('caja_uuid', id),
    db
      .from('caja_apertura')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', session.tenantId)
      .eq('caja_id', id),
    db
      .from('cierre_z')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', session.tenantId)
      .eq('caja_id', id),
  ]);

  const err = tErr ?? compErr ?? apErr ?? czErr;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  const usos = [
    ['turnos', turnos ?? 0],
    ['comprobantes', comprobantes ?? 0],
    ['aperturas', aperturas ?? 0],
    ['cierres', cierres ?? 0],
  ].filter(([, count]) => Number(count) > 0);

  if (usos.length > 0) {
    const detalle = usos.map(([label, count]) => `${count} ${label}`).join(', ');
    return NextResponse.json(
      {
        error: `No se puede borrar esta caja porque tiene historial asociado (${detalle}). Desactivala si ya no se usa.`,
      },
      { status: 409 },
    );
  }

  const { error } = await db
    .from('caja')
    .delete()
    .eq('id', id)
    .eq('tenant_id', session.tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
