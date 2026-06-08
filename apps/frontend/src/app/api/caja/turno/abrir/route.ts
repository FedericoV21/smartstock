import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { redondear2 } from '@/lib/caja/cierre-z-calculo';
import { obtenerAperturaVigente } from '@/lib/caja/sesion-caja';
import { cajaServerDebug } from '@/lib/caja/debug-caja-logs';
import { usuarioPuedeOperarCaja } from '@/lib/caja/permiso-operar-caja';
import { cajaUuidComoCajaIdText } from '@/lib/caja/turno-caja';
import { moduloGuard } from '@/lib/modulos/guard';
import { hoyEnAR } from '@/lib/utils/formatters';

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: { caja_id?: string | null; monto_inicial?: number | string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const cajaId = String(body.caja_id || '').trim();
  cajaServerDebug('turno/abrir:inicio', { userId: session.userId, tenantId: session.tenantId, cajaId });
  if (!cajaId) {
    return NextResponse.json({ error: 'caja_id es obligatorio (UUID de la caja).' }, { status: 400 });
  }

  const rawMonto = body.monto_inicial;
  const montoNum =
    rawMonto === null || rawMonto === undefined || rawMonto === '' ? NaN : Number(rawMonto);
  if (!Number.isFinite(montoNum) || montoNum < 0) {
    return NextResponse.json({ error: 'monto_inicial debe ser un número ≥ 0.' }, { status: 400 });
  }

  const db = session.supabase as any;

  const { data: caja, error: cajaErr } = await db
    .from('caja')
    .select('id, tenant_id, sucursal_id, activa, usuario_default_id, numero, nombre')
    .eq('id', cajaId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (cajaErr) return NextResponse.json({ error: cajaErr.message }, { status: 500 });
  if (!caja || !caja.activa) {
    cajaServerDebug('turno/abrir:404_caja', { cajaId, tiene_fila: Boolean(caja), activa: caja?.activa ?? null });
    return NextResponse.json({ error: 'Caja no encontrada o inactiva.' }, { status: 404 });
  }

  const sucursalScope = await resolveAndValidateSucursalScope(session, caja.sucursal_id);
  if (!sucursalScope.ok) {
    cajaServerDebug('turno/abrir:alcance_sucursal_error', {
      caja_sucursal_id: caja.sucursal_id,
      respuesta: 'resolveAndValidateSucursalScope no ok',
    });
    return sucursalScope.response;
  }
  if (sucursalScope.sucursalId !== caja.sucursal_id) {
    cajaServerDebug('turno/abrir:403_sucursal_scope', {
      caja_sucursal_id: caja.sucursal_id,
      scope_resuelto: sucursalScope.sucursalId,
    });
    return NextResponse.json({ error: 'No tenés permisos para operar en la sucursal de esta caja.' }, { status: 403 });
  }

  try {
    const puedeCaja = await usuarioPuedeOperarCaja(db, session.userId, caja);
    if (!puedeCaja) {
      let rpcSucursal: unknown = null;
      const sid = String(caja.sucursal_id ?? '').trim();
      if (sid) {
        const { data } = await db.rpc('usuario_puede_operar_sucursal', { p_sucursal_id: sid });
        rpcSucursal = data;
      }
      cajaServerDebug('turno/abrir:403_permiso_caja', {
        caja_id: caja.id,
        caja_sucursal_id: sid || null,
        rpc_usuario_puede_operar_sucursal: rpcSucursal,
        usuario_default_id: caja.usuario_default_id ?? null,
      });
      return NextResponse.json(
        { error: 'No estás habilitado para operar en esta caja. Pedile al administrador que te asigne.' },
        { status: 403 },
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al validar permisos';
    cajaServerDebug('turno/abrir:error_permiso_excepcion', { message: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const { data: turnoAbiertoUsuario, error: tuErr } = await db
    .from('caja_turno')
    .select('id, caja_id')
    .eq('tenant_id', session.tenantId)
    .eq('usuario_id', session.userId)
    .eq('estado', 'abierto')
    .maybeSingle();
  if (tuErr) return NextResponse.json({ error: tuErr.message }, { status: 500 });
  if (turnoAbiertoUsuario) {
    const { data: cajaTurnoVigente } = await db
      .from('caja')
      .select('id, nombre, numero, sucursal_id')
      .eq('id', turnoAbiertoUsuario.caja_id)
      .eq('tenant_id', session.tenantId)
      .maybeSingle();

    let sucursalTurnoNombre: string | null = null;
    const sidTurno = cajaTurnoVigente?.sucursal_id ? String(cajaTurnoVigente.sucursal_id).trim() : '';
    if (sidTurno) {
      const { data: sur } = await db
        .from('sucursal')
        .select('nombre, codigo')
        .eq('tenant_id', session.tenantId)
        .eq('id', sidTurno)
        .maybeSingle();
      const srow = sur as { nombre?: string | null; codigo?: string | null } | null;
      const nom = typeof srow?.nombre === 'string' ? srow.nombre.trim() : '';
      const cod = typeof srow?.codigo === 'string' ? srow.codigo.trim() : '';
      if (nom || cod) sucursalTurnoNombre = cod ? `${nom || 'Sucursal'} (${cod})` : nom || null;
    }

    const distintaQueElegida =
      Boolean(cajaTurnoVigente) &&
      String((cajaTurnoVigente as { sucursal_id?: string }).sucursal_id ?? '') !==
        String((caja as { sucursal_id?: string }).sucursal_id ?? '');
    const cajaEtiqueta = cajaTurnoVigente
      ? `Caja ${String((cajaTurnoVigente as { numero?: number }).numero ?? 1).padStart(2, '0')} — ${String((cajaTurnoVigente as { nombre?: string }).nombre ?? 'Caja')}`
      : 'otra caja';

    let errorMsg =
      distintaQueElegida && sucursalTurnoNombre
        ? `Tenés un turno abierto en ${sucursalTurnoNombre} (${cajaEtiqueta}). Para abrir una caja acá cerrá ese turno con cierre Z.`
        : `Ya tenés un turno de caja abierto (${cajaEtiqueta}${sucursalTurnoNombre ? ` · ${sucursalTurnoNombre}` : ''}). Cerralo con Z antes de abrir otro.`;

    if (!distintaQueElegida && !sucursalTurnoNombre) {
      errorMsg = 'Ya tenés un turno de caja abierto. Cerralo con Z antes de abrir otro.';
    }

    return NextResponse.json(
      {
        error: errorMsg,
        codigo: 'turno_usuario_ya_abierto',
        puede_cerrar_turno_actual: true,
        turno_abierto_en:
          cajaTurnoVigente && sidTurno
            ? {
                caja_id: (cajaTurnoVigente as { id: string }).id,
                sucursal_id: sidTurno,
                sucursal_nombre: sucursalTurnoNombre,
                caja_numero: Number((cajaTurnoVigente as { numero?: number }).numero) || 1,
                caja_nombre: String((cajaTurnoVigente as { nombre?: string }).nombre ?? 'Caja'),
                distinta_sucursal_que_la_pedida: distintaQueElegida,
              }
            : null,
      },
      { status: 409 },
    );
  }

  const { data: turnoAbiertoCaja, error: tcErr } = await db
    .from('caja_turno')
    .select('id')
    .eq('tenant_id', session.tenantId)
    .eq('caja_id', caja.id)
    .eq('estado', 'abierto')
    .maybeSingle();
  if (tcErr) return NextResponse.json({ error: tcErr.message }, { status: 500 });
  if (turnoAbiertoCaja) {
    return NextResponse.json(
      { error: 'Esta caja ya tiene un turno abierto. Esperá al cierre o usá otra caja.' },
      { status: 409 },
    );
  }

  const cajaIdText = cajaUuidComoCajaIdText(caja.id);
  try {
    const vigente = await obtenerAperturaVigente(db, cajaIdText, caja.sucursal_id);
    if (vigente) {
      return NextResponse.json(
        {
          error:
            'Hay una sesión de caja abierta sin cierre Z para esta caja. Cerrala desde Cierre de caja o contactá al administrador.',
        },
        { status: 409 },
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al consultar apertura';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const fechaOperativa = hoyEnAR();
  const { data: apertura, error: apErr } = await db
    .from('caja_apertura')
    .insert({
      tenant_id: session.tenantId,
      sucursal_id: caja.sucursal_id,
      caja_id: cajaIdText,
      fecha_operativa: fechaOperativa,
      fondo_efectivo: redondear2(montoNum),
      usuario_id: session.userId,
    })
    .select('id, opened_at, fondo_efectivo, fecha_operativa')
    .single();
  if (apErr) {
    return NextResponse.json({ error: apErr.message }, { status: 500 });
  }

  const { data: turno, error: turnoErr } = await db
    .from('caja_turno')
    .insert({
      tenant_id: session.tenantId,
      caja_id: caja.id,
      usuario_id: session.userId,
      estado: 'abierto',
      monto_inicial: redondear2(montoNum),
    })
    .select('id, abierto_at, monto_inicial, estado')
    .single();

  if (turnoErr) {
    await db.from('caja_apertura').delete().eq('id', apertura.id);
    const msg = String((turnoErr as any)?.message || '');
    const code = String((turnoErr as any)?.code || '');
    const constraint = String((turnoErr as any)?.details || '') + ' ' + String((turnoErr as any)?.hint || '');
    const isUniqueViolation =
      code === '23505' ||
      msg.toLowerCase().includes('duplicate key value') ||
      msg.includes('uk_caja_turno_usuario_abierto') ||
      msg.includes('uk_caja_turno_caja_abierto') ||
      constraint.includes('uk_caja_turno_usuario_abierto') ||
      constraint.includes('uk_caja_turno_caja_abierto');
    if (isUniqueViolation) {
      return NextResponse.json(
        {
          error:
            'No se pudo abrir el turno porque ya existe un turno abierto (tuyo o de la caja elegida). Actualizá la página y cerrá el turno vigente con Z.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg || 'Error al abrir turno' }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      turno,
      caja: { id: caja.id, nombre: caja.nombre, numero: caja.numero, sucursal_id: caja.sucursal_id },
      apertura,
      caja_id_text: cajaIdText,
    },
    { status: 201 },
  );
}
