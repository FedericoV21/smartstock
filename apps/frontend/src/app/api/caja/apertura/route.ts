import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { cajaServerDebug } from '@/lib/caja/debug-caja-logs';
import { usuarioPuedeOperarCaja } from '@/lib/caja/permiso-operar-caja';
import { redondear2 } from '@/lib/caja/cierre-z-calculo';
import { hoyEnAR } from '@/lib/utils/formatters';
import {
  normalizarCajaIdParam,
  obtenerAperturaVigente,
  obtenerUltimoContadoCierreDiario,
} from '@/lib/caja/sesion-caja';

export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const requestedSucursalId = new URL(request.url).searchParams.get('sucursal_id');
  const sucursalScope = await resolveAndValidateSucursalScope(session, requestedSucursalId);
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const cajaId = normalizarCajaIdParam(new URL(request.url).searchParams.get('caja_id'));

  try {
    const [vigente, ultimo_cierre_contado] = await Promise.all([
      obtenerAperturaVigente(session.supabase as any, cajaId, sucursalScope.sucursalId),
      obtenerUltimoContadoCierreDiario(session.supabase as any, cajaId, sucursalScope.sucursalId),
    ]);
    return NextResponse.json({ vigente, ultimo_cierre_contado });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al consultar';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: {
    caja_id?: string | null;
    sucursal_id?: string | null;
    fecha_operativa?: string | null;
    fondo_efectivo?: number | string | null;
    notas?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    cajaServerDebug('apertura:POST:json_invalido', { userId: session.userId, tenantId: session.tenantId });
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  cajaServerDebug('apertura:POST:inicio', {
    userId: session.userId,
    tenantId: session.tenantId,
    rol: session.rol,
    caja_id_solicitada: body.caja_id ?? null,
    sucursal_id_solicitada: body.sucursal_id ?? null,
    fecha_operativa_solicitada: body.fecha_operativa ?? null,
    fondo_efectivo_raw: body.fondo_efectivo ?? null,
  });

  const sucursalScope = await resolveAndValidateSucursalScope(session, body.sucursal_id ?? null);
  if (!sucursalScope.ok) {
    cajaServerDebug('apertura:POST:sucursal_scope_no_ok', {
      userId: session.userId,
      tenantId: session.tenantId,
      sucursal_id_solicitada: body.sucursal_id ?? null,
    });
    return sucursalScope.response;
  }
  if (!sucursalScope.sucursalId) {
    cajaServerDebug('apertura:POST:sin_sucursal_operativa', {
      userId: session.userId,
      tenantId: session.tenantId,
    });
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const fechaOperativa = String(body.fecha_operativa || '').trim() || hoyEnAR();

  const rawFondo = body.fondo_efectivo;
  const fondoNum =
    rawFondo === null || rawFondo === undefined || rawFondo === '' ? NaN : Number(rawFondo);
  if (!Number.isFinite(fondoNum) || fondoNum < 0) {
    cajaServerDebug('apertura:POST:fondo_invalido', {
      userId: session.userId,
      tenantId: session.tenantId,
      rawFondo,
      fondoNum,
    });
    return NextResponse.json(
      { error: 'fondo_efectivo debe ser un número ≥ 0 (cuánto efectivo hay al abrir).' },
      { status: 400 },
    );
  }

  // `caja_id` del cliente se ignora: la caja operativa se resuelve en backend por usuario.
  let cajaId = '__sin_caja__';
  const notas = String(body.notas || '')
    .trim()
    .slice(0, 500) || null;

  const db = session.supabase as any;

  const { data: cajaSugerida, error: cajaSugeridaErr } = await db
    .from('caja')
    .select('id')
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', sucursalScope.sucursalId)
    .eq('activa', true)
    .eq('usuario_default_id', session.userId)
    .order('numero', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (cajaSugeridaErr) {
    cajaServerDebug('apertura:POST:caja_sugerida_error', {
      userId: session.userId,
      tenantId: session.tenantId,
      sucursal_id: sucursalScope.sucursalId,
      message: cajaSugeridaErr.message,
    });
    return NextResponse.json({ error: cajaSugeridaErr.message }, { status: 500 });
  }

  if (cajaSugerida?.id) {
    cajaId = String(cajaSugerida.id).trim();
    cajaServerDebug('apertura:POST:caja_sugerida_resuelta', {
      userId: session.userId,
      tenantId: session.tenantId,
      sucursal_id: sucursalScope.sucursalId,
      cajaId,
    });
  } else {
    cajaServerDebug('apertura:POST:sin_caja_sugerida_busca_fallback', {
      userId: session.userId,
      tenantId: session.tenantId,
      sucursal_id: sucursalScope.sucursalId,
    });
    const { data: cajaFallback, error: cajaFallbackErr } = await db
      .from('caja')
      .select('id')
      .eq('tenant_id', session.tenantId)
      .eq('sucursal_id', sucursalScope.sucursalId)
      .eq('activa', true)
      .order('numero', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (cajaFallbackErr) {
      cajaServerDebug('apertura:POST:caja_fallback_error', {
        userId: session.userId,
        tenantId: session.tenantId,
        sucursal_id: sucursalScope.sucursalId,
        message: cajaFallbackErr.message,
      });
      return NextResponse.json({ error: cajaFallbackErr.message }, { status: 500 });
    }
    if (cajaFallback?.id) {
      cajaId = String(cajaFallback.id).trim();
      cajaServerDebug('apertura:POST:caja_fallback_resuelta', {
        userId: session.userId,
        tenantId: session.tenantId,
        sucursal_id: sucursalScope.sucursalId,
        cajaId,
      });
    } else {
      cajaServerDebug('apertura:POST:sin_caja_configurada', {
        userId: session.userId,
        tenantId: session.tenantId,
        sucursal_id: sucursalScope.sucursalId,
      });
    }
  }

  let aperturaData: { id: string; opened_at: string; fondo_efectivo: number; fecha_operativa: string } | null =
    null;

  let aperturaVigente: { id: string; opened_at: string; fondo_efectivo: number; fecha_operativa: string } | null;
  try {
    aperturaVigente = await obtenerAperturaVigente(db, cajaId, sucursalScope.sucursalId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al consultar apertura vigente';
    cajaServerDebug('apertura:POST:consulta_apertura_vigente_error', {
      userId: session.userId,
      tenantId: session.tenantId,
      sucursal_id: sucursalScope.sucursalId,
      cajaId,
      message: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  if (aperturaVigente) {
    cajaServerDebug('apertura:POST:usa_apertura_vigente', {
      userId: session.userId,
      tenantId: session.tenantId,
      sucursal_id: sucursalScope.sucursalId,
      cajaId,
      apertura_id: aperturaVigente.id,
    });
    aperturaData = aperturaVigente;
  } else {
    cajaServerDebug('apertura:POST:insert_apertura_intento', {
      userId: session.userId,
      tenantId: session.tenantId,
      sucursal_id: sucursalScope.sucursalId,
      cajaId,
      fechaOperativa,
      fondo_efectivo: redondear2(fondoNum),
      tiene_notas: notas !== null,
    });
    const { data, error } = await db
      .from('caja_apertura')
      .insert({
        tenant_id: session.tenantId,
        sucursal_id: sucursalScope.sucursalId,
        caja_id: cajaId,
        fecha_operativa: fechaOperativa,
        fondo_efectivo: redondear2(fondoNum),
        notas,
        usuario_id: session.userId,
      })
      .select('id, opened_at, fondo_efectivo, fecha_operativa')
      .single();

    if (error) {
      const hint =
        error.message?.includes('caja_apertura') || error.code === '42P01'
          ? ' Falta la migración 060_caja_apertura en la base.'
          : '';
      cajaServerDebug('apertura:POST:insert_apertura_error', {
        userId: session.userId,
        tenantId: session.tenantId,
        sucursal_id: sucursalScope.sucursalId,
        cajaId,
        code: error.code ?? null,
        message: error.message,
      });
      return NextResponse.json({ error: `${error.message}${hint}` }, { status: 500 });
    }
    cajaServerDebug('apertura:POST:insert_apertura_ok', {
      userId: session.userId,
      tenantId: session.tenantId,
      sucursal_id: sucursalScope.sucursalId,
      cajaId,
      apertura_id: data.id,
    });
    aperturaData = data;
  }

  let turno:
    | { id: string; estado: string; caja_id: string; abierto_at: string; monto_inicial: number }
    | null = null;

  if (cajaId !== '__sin_caja__') {
    const { data: caja, error: cajaErr } = await db
      .from('caja')
      .select('id, sucursal_id, activa, usuario_default_id')
      .eq('id', cajaId)
      .eq('tenant_id', session.tenantId)
      .maybeSingle();
    if (cajaErr || !caja) {
      cajaServerDebug('apertura:POST:caja_validacion_no_encontrada', {
        userId: session.userId,
        tenantId: session.tenantId,
        cajaId,
        message: cajaErr?.message ?? null,
      });
      if (!aperturaVigente && aperturaData?.id) {
        await db.from('caja_apertura').delete().eq('id', aperturaData.id);
      }
      return NextResponse.json({ error: cajaErr?.message ?? 'Caja no encontrada para apertura.' }, { status: 400 });
    }
    if (!caja.activa) {
      cajaServerDebug('apertura:POST:caja_inactiva', {
        userId: session.userId,
        tenantId: session.tenantId,
        cajaId,
      });
      if (!aperturaVigente && aperturaData?.id) {
        await db.from('caja_apertura').delete().eq('id', aperturaData.id);
      }
      return NextResponse.json({ error: 'La caja seleccionada está inactiva.' }, { status: 400 });
    }
    if (caja.sucursal_id !== sucursalScope.sucursalId) {
      cajaServerDebug('apertura:POST:caja_sucursal_mismatch', {
        userId: session.userId,
        tenantId: session.tenantId,
        cajaId,
        caja_sucursal_id: caja.sucursal_id,
        scope_sucursal_id: sucursalScope.sucursalId,
      });
      if (!aperturaVigente && aperturaData?.id) {
        await db.from('caja_apertura').delete().eq('id', aperturaData.id);
      }
      return NextResponse.json({ error: 'La caja no pertenece a la sucursal operativa.' }, { status: 400 });
    }

    let puedeOperarCaja = false;
    try {
      puedeOperarCaja = await usuarioPuedeOperarCaja(db, session.userId, caja);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al validar permisos de caja';
      cajaServerDebug('apertura:POST:permiso_caja_excepcion', {
        userId: session.userId,
        tenantId: session.tenantId,
        cajaId,
        message: msg,
      });
      if (!aperturaVigente && aperturaData?.id) {
        await db.from('caja_apertura').delete().eq('id', aperturaData.id);
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    if (!puedeOperarCaja) {
      cajaServerDebug('apertura:POST:403_permiso_caja', {
        userId: session.userId,
        tenantId: session.tenantId,
        cajaId,
        caja_sucursal_id: caja.sucursal_id,
        usuario_default_id: caja.usuario_default_id ?? null,
      });
      if (!aperturaVigente && aperturaData?.id) {
        await db.from('caja_apertura').delete().eq('id', aperturaData.id);
      }
      return NextResponse.json(
        { error: 'No estás habilitado para operar en esta caja.' },
        { status: 403 },
      );
    }

    const { data: turnoAbiertoUsuario, error: turnoUsuarioErr } = await db
      .from('caja_turno')
      .select('id, estado, caja_id, abierto_at, monto_inicial')
      .eq('tenant_id', session.tenantId)
      .eq('usuario_id', session.userId)
      .eq('estado', 'abierto')
      .maybeSingle();
    if (turnoUsuarioErr) {
      cajaServerDebug('apertura:POST:turno_usuario_error', {
        userId: session.userId,
        tenantId: session.tenantId,
        cajaId,
        message: turnoUsuarioErr.message,
      });
      if (!aperturaVigente && aperturaData?.id) {
        await db.from('caja_apertura').delete().eq('id', aperturaData.id);
      }
      return NextResponse.json({ error: turnoUsuarioErr.message }, { status: 500 });
    }

    if (turnoAbiertoUsuario) {
      if (turnoAbiertoUsuario.caja_id === caja.id) {
        cajaServerDebug('apertura:POST:usa_turno_usuario_existente', {
          userId: session.userId,
          tenantId: session.tenantId,
          cajaId,
          turno_id: turnoAbiertoUsuario.id,
        });
        turno = turnoAbiertoUsuario;
      } else {
        cajaServerDebug('apertura:POST:409_turno_usuario_otra_caja', {
          userId: session.userId,
          tenantId: session.tenantId,
          cajaId,
          turno_id: turnoAbiertoUsuario.id,
          turno_caja_id: turnoAbiertoUsuario.caja_id,
        });
        if (!aperturaVigente && aperturaData?.id) {
          await db.from('caja_apertura').delete().eq('id', aperturaData.id);
        }
        return NextResponse.json(
          { error: 'Ya tenés un turno abierto. Cerralo antes de abrir otro.' },
          { status: 409 },
        );
      }
    }

    if (!turno) {
      const { data: turnoAbiertoCaja, error: turnoCajaErr } = await db
        .from('caja_turno')
        .select('id')
        .eq('tenant_id', session.tenantId)
        .eq('caja_id', caja.id)
        .eq('estado', 'abierto')
        .maybeSingle();
      if (turnoCajaErr) {
        cajaServerDebug('apertura:POST:turno_caja_error', {
          userId: session.userId,
          tenantId: session.tenantId,
          cajaId,
          message: turnoCajaErr.message,
        });
        if (!aperturaVigente && aperturaData?.id) {
          await db.from('caja_apertura').delete().eq('id', aperturaData.id);
        }
        return NextResponse.json({ error: turnoCajaErr.message }, { status: 500 });
      }
      if (turnoAbiertoCaja) {
        cajaServerDebug('apertura:POST:409_turno_caja_existente', {
          userId: session.userId,
          tenantId: session.tenantId,
          cajaId,
          turno_id: turnoAbiertoCaja.id,
        });
        if (!aperturaVigente && aperturaData?.id) {
          await db.from('caja_apertura').delete().eq('id', aperturaData.id);
        }
        return NextResponse.json(
          { error: 'Esta caja ya tiene un turno abierto. Esperá al cierre o usá otra caja.' },
          { status: 409 },
        );
      }
    }

    if (!turno) {
      cajaServerDebug('apertura:POST:insert_turno_intento', {
        userId: session.userId,
        tenantId: session.tenantId,
        cajaId,
        monto_inicial: redondear2(fondoNum),
      });
      const { data: turnoCreado, error: turnoCreateErr } = await db
        .from('caja_turno')
        .insert({
          tenant_id: session.tenantId,
          caja_id: caja.id,
          usuario_id: session.userId,
          estado: 'abierto',
          monto_inicial: redondear2(fondoNum),
        })
        .select('id, estado, caja_id, abierto_at, monto_inicial')
        .single();
      if (turnoCreateErr) {
        cajaServerDebug('apertura:POST:insert_turno_error', {
          userId: session.userId,
          tenantId: session.tenantId,
          cajaId,
          code: turnoCreateErr.code ?? null,
          message: turnoCreateErr.message,
        });
        if (!aperturaVigente && aperturaData?.id) {
          await db.from('caja_apertura').delete().eq('id', aperturaData.id);
        }
        return NextResponse.json(
          { error: `No se pudo abrir el turno asociado a la apertura: ${turnoCreateErr.message}` },
          { status: 500 },
        );
      }
      cajaServerDebug('apertura:POST:insert_turno_ok', {
        userId: session.userId,
        tenantId: session.tenantId,
        cajaId,
        turno_id: turnoCreado.id,
      });
      turno = turnoCreado;
    }
  }

  cajaServerDebug('apertura:POST:ok', {
    userId: session.userId,
    tenantId: session.tenantId,
    sucursal_id: sucursalScope.sucursalId,
    cajaId,
    apertura_id: aperturaData?.id ?? null,
    turno_id: turno?.id ?? null,
  });

  return NextResponse.json(
    { ok: true, apertura: aperturaData, turno, sucursal_id: sucursalScope.sucursalId },
    { status: 201 },
  );
}
