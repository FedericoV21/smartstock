import { NextResponse } from 'next/server';

import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { elegirCajaSugeridaId } from '@/lib/caja/caja-sugerida-usuario';
import { cajaServerDebug } from '@/lib/caja/debug-caja-logs';
import { usuarioPuedeOperarCaja } from '@/lib/caja/permiso-operar-caja';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { userId } = session;
  cajaServerDebug('disponibles:inicio', {
    userId,
    tenantId: session.tenantId,
    rol: session.rol,
    sucursal_id_query: new URL(request.url).searchParams.get('sucursal_id')?.trim() || null,
  });

  const sucursales = await idsSucursalesOperables(session);
  if (!sucursales.ok) return sucursales.response;
  cajaServerDebug('disponibles:idsSucursalesOperables', {
    count: sucursales.ids.length,
    ids: sucursales.ids,
  });
  if (sucursales.ids.length === 0) {
    cajaServerDebug('disponibles:salida_sin_sucursales', {
      motivo: 'idsSucursalesOperables vacío → no se consulta caja (revisá usuario_sucursal, sucursal_default_id o tenant de una sucursal).',
    });
    return NextResponse.json({ cajas: [], caja_sugerida_id: null });
  }

  const sucursalParam = new URL(request.url).searchParams.get('sucursal_id')?.trim() || '';
  let idsSucursalFiltro = sucursales.ids;
  if (sucursalParam) {
    if (!sucursales.ids.includes(sucursalParam)) {
      cajaServerDebug('disponibles:403_sucursal_no_en_ids_operables', {
        sucursalParam,
        ids_operables: sucursales.ids,
      });
      return NextResponse.json({ error: 'Sucursal no disponible para tu usuario.' }, { status: 403 });
    }
    idsSucursalFiltro = [sucursalParam];
  } else {
    const { data: me } = await (session.supabase as any)
      .from('usuario')
      .select('sucursal_default_id')
      .eq('id', userId)
      .maybeSingle();
    const def = typeof me?.sucursal_default_id === 'string' ? me.sucursal_default_id.trim() : '';
    if (def && sucursales.ids.includes(def)) {
      idsSucursalFiltro = [def];
    } else if (sucursales.ids.length === 1) {
      idsSucursalFiltro = [sucursales.ids[0]];
    }
  }

  cajaServerDebug('disponibles:filtro_sucursal', {
    sucursalParam: sucursalParam || null,
    idsSucursalFiltro,
  });

  const db = session.supabase as any;

  async function filtrarCajasPermitidas(candidatas: typeof rows): Promise<typeof rows> {
    const permitidas: typeof rows = [];
    for (const caja of candidatas ?? []) {
      try {
        if (await usuarioPuedeOperarCaja(db, userId, caja)) {
          permitidas.push(caja);
        }
      } catch (e) {
        throw e;
      }
    }
    return permitidas;
  }

  const { data: rows, error } = await db
    .from('caja')
    .select('id, sucursal_id, numero, nombre, activa, usuario_default_id')
    .eq('tenant_id', session.tenantId)
    .eq('activa', true)
    .in('sucursal_id', idsSucursalFiltro)
    .order('sucursal_id', { ascending: true })
    .order('numero', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const candidatas = rows ?? [];
  cajaServerDebug('disponibles:query_caja', {
    candidatas_count: candidatas.length,
    candidatas: candidatas.map((c: { id: string; sucursal_id: string; numero: number; nombre: string }) => ({
      id: c.id,
      sucursal_id: c.sucursal_id,
      numero: c.numero,
      nombre: c.nombre,
    })),
  });
  if (candidatas.length === 0) {
    cajaServerDebug('disponibles:sin_cajas_en_bd', {
      hint:
        'No hay filas en public.caja para este tenant y sucursal (p. ej. sucursal nueva). Aplicá la migración 111_caja_faltante_por_sucursal.sql en Supabase.',
      tenantId: session.tenantId,
      idsSucursalFiltro,
    });
  }

  let out: typeof rows;
  try {
    out = await filtrarCajasPermitidas(candidatas);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al validar caja';
    cajaServerDebug('disponibles:error_permiso', { message: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (candidatas.length > 0 && out.length === 0) {
    for (const c of candidatas) {
      const sid = String((c as { sucursal_id?: string }).sucursal_id ?? '').trim();
      let rpcSucursal: unknown = null;
      if (sid) {
        const { data } = await db.rpc('usuario_puede_operar_sucursal', { p_sucursal_id: sid });
        rpcSucursal = data;
      }
      cajaServerDebug('disponibles:caja_filtrada', {
        caja_id: (c as { id: string }).id,
        numero: (c as { numero: number }).numero,
        sucursal_id: sid || null,
        rpc_usuario_puede_operar_sucursal: rpcSucursal,
        usuario_default_id: (c as { usuario_default_id?: string | null }).usuario_default_id ?? null,
        coincide_default_usuario:
          (c as { usuario_default_id?: string | null }).usuario_default_id === userId,
      });
    }
  }

  let cajaIdsMiembro: string[] = [];
  const idsPermitidas = out.map((c: { id: string }) => c.id);

  const cajaIdsConTurnoAbierto = new Set<string>();
  if (idsPermitidas.length > 0) {
    const { data: cuRows, error: cuErr } = await db
      .from('caja_usuario')
      .select('caja_id')
      .eq('usuario_id', userId)
      .in('caja_id', idsPermitidas);
    if (cuErr) return NextResponse.json({ error: cuErr.message }, { status: 500 });
    const cuRowsTyped = (cuRows ?? []) as { caja_id: string }[];
    cajaIdsMiembro = [...new Set(cuRowsTyped.map((r) => r.caja_id))];

    const { data: turnosAb, error: tAbErr } = await db
      .from('caja_turno')
      .select('caja_id')
      .eq('tenant_id', session.tenantId)
      .eq('estado', 'abierto')
      .in('caja_id', idsPermitidas);
    if (tAbErr) return NextResponse.json({ error: tAbErr.message }, { status: 500 });
    for (const r of turnosAb ?? []) {
      const cid = (r as { caja_id?: string }).caja_id;
      if (typeof cid === 'string' && cid.trim()) cajaIdsConTurnoAbierto.add(cid.trim());
    }
  }

  const outSinTurnoAbierto = out.filter((c: { id: string }) => !cajaIdsConTurnoAbierto.has(c.id));
  const cajaIdsMiembroLibres = cajaIdsMiembro.filter((id) =>
    outSinTurnoAbierto.some((c: { id: string }) => c.id === id),
  );

  const caja_sugerida_id =
    outSinTurnoAbierto.length > 0
      ? elegirCajaSugeridaId(
          userId,
          outSinTurnoAbierto.map((c: { id: string; numero: number; usuario_default_id?: string | null }) => ({
            id: c.id,
            numero: c.numero,
            usuario_default_id: c.usuario_default_id,
          })),
          cajaIdsMiembroLibres,
        )
      : null;

  const todas_con_turno_abierto = out.length > 0 && outSinTurnoAbierto.length === 0;

  const cajasPayload = (out ?? []).map((c: Record<string, unknown> & { id: string }) => ({
    ...c,
    turno_abierto: cajaIdsConTurnoAbierto.has(c.id),
  }));

  cajaServerDebug('disponibles:salida', {
    permitidas_count: out?.length ?? 0,
    caja_ids: (out ?? []).map((c: { id: string }) => c.id),
    caja_sugerida_id,
    cajas_con_turno_abierto: [...cajaIdsConTurnoAbierto],
    todas_con_turno_abierto,
  });

  return NextResponse.json({
    cajas: cajasPayload,
    caja_sugerida_id,
    todas_con_turno_abierto,
  });
}
