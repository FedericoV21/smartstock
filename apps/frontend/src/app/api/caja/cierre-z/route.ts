import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import {
  calcularSnapshot,
  csvEscape,
  minutosToIsoUtc,
  normalizarCaja,
  parseHoraToMinutes,
  redondear2,
  type ModoPeriodoCierre,
  type TipoCierre,
} from '@/lib/caja/cierre-z-calculo';
import {
  crearTicketResumenCierreCaja,
  type GastoCierreGuardado,
} from '@/lib/caja/cierre-ticket-resumen';
import { listarGastosSesionVigentes, sumarGastosSesion } from '@/lib/caja/caja-gastos-sesion';
import { parseGastosItemsCierre } from '@/lib/caja/gastos-cierre';
import { persistCierreZDiarioSesion } from '@/lib/caja/persist-cierre-z-diario-sesion';
import { obtenerAperturaVigente } from '@/lib/caja/sesion-caja';
import { cajaUuidComoCajaIdText } from '@/lib/caja/turno-caja';
import { hoyEnAR } from '@/lib/utils/formatters';

export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const sp = new URL(request.url).searchParams;
  const sucursalScope = await resolveAndValidateSucursalScope(session, sp.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }
  const preview = sp.get('preview') === '1';
  const fechaOperativa = (sp.get('fecha_operativa') || '').trim();
  const cajaId = normalizarCaja(sp.get('caja_id'));
  const exportFmt = (sp.get('export') || '').toLowerCase();

  if (preview) {
    const modoPeriodo: ModoPeriodoCierre =
      sp.get('modo_periodo') === 'sesion_apertura' ? 'sesion_apertura' : 'jornada_fecha';
    const tipoCierre: TipoCierre = sp.get('tipo_cierre') === 'parcial' ? 'parcial' : 'diario';

    if (modoPeriodo === 'sesion_apertura' && tipoCierre === 'parcial') {
      return NextResponse.json(
        { error: 'El modo “desde última apertura” no se combina con cierre parcial por hora.' },
        { status: 400 },
      );
    }

    let rangoDesde: string;
    let rangoHasta: string;
    let fondoApertura = 0;
    let sesionAperturaId: string | null = null;
    let modoSnapshot: ModoPeriodoCierre;
    let fechaParaComprobantes: string;

    if (tipoCierre === 'parcial') {
      fechaParaComprobantes = fechaOperativa || hoyEnAR();
      let rangoDesdeMin = 0;
      let rangoHastaMin = 23 * 60 + 59;
      const desdeMin = parseHoraToMinutes(sp.get('rango_desde_hora'));
      const hastaMin = parseHoraToMinutes(sp.get('rango_hasta_hora'));
      if (desdeMin == null || hastaMin == null) {
        return NextResponse.json(
          { error: 'En cierre parcial se requiere rango_desde_hora y rango_hasta_hora (HH:mm).' },
          { status: 400 },
        );
      }
      if (hastaMin <= desdeMin) {
        return NextResponse.json(
          { error: 'rango_hasta_hora debe ser mayor a rango_desde_hora.' },
          { status: 400 },
        );
      }
      rangoDesdeMin = desdeMin;
      rangoHastaMin = hastaMin;
      rangoDesde = minutosToIsoUtc(fechaParaComprobantes, rangoDesdeMin);
      rangoHasta = minutosToIsoUtc(fechaParaComprobantes, rangoHastaMin);
      modoSnapshot = modoPeriodo;
    } else {
      try {
        const ap = await obtenerAperturaVigente(
          session.supabase as any,
          cajaId,
          sucursalScope.sucursalId,
        );
        if (!ap) {
          return NextResponse.json(
            {
              error:
                'No hay sesión de caja abierta (sin cierre final). Registrá la apertura con el efectivo inicial y volvé a intentar.',
            },
            { status: 400 },
          );
        }
        fechaParaComprobantes = String(ap.fecha_operativa);
        rangoDesde = ap.opened_at;
        /** Modo sesión: contar desde apertura hasta ahora (no recortar al fin del día de apertura). */
        rangoHasta = new Date().toISOString();
        const tDesde = new Date(rangoDesde).getTime();
        const tHasta = new Date(rangoHasta).getTime();
        if (Number.isFinite(tDesde) && Number.isFinite(tHasta) && tHasta < tDesde) {
          rangoHasta = new Date(tDesde + 1000).toISOString();
        }
        fondoApertura = ap.fondo_efectivo;
        sesionAperturaId = ap.id;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error al resolver sesión';
        return NextResponse.json({ error: msg }, { status: 500 });
      }
      modoSnapshot = 'sesion_apertura';
    }

    try {
      const snapshot = await calcularSnapshot(session.supabase as any, {
        fechaOperativa: fechaParaComprobantes,
        cajaIdNormalizada: cajaId,
        sucursalId: sucursalScope.sucursalId,
        rangoDesdeIso: rangoDesde,
        rangoHastaIso: rangoHasta,
        fondoApertura,
        modoPeriodo: modoSnapshot,
        sesionAperturaId,
      });

      let gastosSesion: Awaited<ReturnType<typeof listarGastosSesionVigentes>> = [];
      let totalGastosSesion = 0;
      if (sesionAperturaId && tipoCierre === 'diario') {
        gastosSesion = await listarGastosSesionVigentes(session.supabase as any, sesionAperturaId);
        totalGastosSesion = await sumarGastosSesion(session.supabase as any, sesionAperturaId);
      }

      return NextResponse.json({ snapshot, gastos_sesion: gastosSesion, total_gastos_sesion: totalGastosSesion });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al calcular';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  let q = (session.supabase as any)
    .from('cierre_z')
    .select('*')
    .eq('sucursal_id', sucursalScope.sucursalId)
    .order('caja_id', { ascending: true })
    .order('rango_desde', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(60);
  if (fechaOperativa) q = q.eq('fecha_operativa', fechaOperativa);
  if (cajaId && cajaId !== '__sin_caja__') q = q.eq('caja_id', cajaId);

  const { data: cierres, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const cierreIds = (cierres ?? []).map((c: { id: string }) => c.id);
  const { data: mediosRows, error: medErr } = cierreIds.length
    ? await (session.supabase as any)
        .from('cierre_z_medio_pago')
        .select('cierre_z_id, metodo_pago, monto_neto, cantidad_comprobantes')
        .in('cierre_z_id', cierreIds)
    : { data: [], error: null };
  if (medErr) return NextResponse.json({ error: medErr.message }, { status: 500 });

  const porCierre = new Map<string, any[]>();
  for (const m of (mediosRows ?? []) as any[]) {
    const arr = porCierre.get(m.cierre_z_id) ?? [];
    arr.push(m);
    porCierre.set(m.cierre_z_id, arr);
  }

  const enriched = (cierres ?? []).map((c: any) => ({
    ...c,
    medios: porCierre.get(c.id) ?? [],
  }));

  if (exportFmt === 'csv') {
    const lines = [
      'fecha_operativa,caja_id,total_comprobantes,ventas_brutas,notas_credito_total,ventas_netas,pagos_cta_cte_total,created_at',
      ...enriched.map((c: any) =>
        [
          csvEscape(c.fecha_operativa),
          csvEscape(c.caja_id),
          csvEscape(c.total_comprobantes),
          csvEscape(c.ventas_brutas),
          csvEscape(c.notas_credito_total),
          csvEscape(c.ventas_netas),
          csvEscape(c.pagos_cta_cte_total),
          csvEscape(c.created_at),
        ].join(','),
      ),
    ];
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="cierres-caja-${fechaOperativa || 'historial'}.csv"`,
      },
    });
  }

  return NextResponse.json({
    cierres: enriched.map((c: any) => ({
      ...c,
      medios: c.medios,
    })),
  });
}

export async function POST(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: {
    sucursal_id?: string | null;
    fecha_operativa?: string;
    caja_id?: string | null;
    tipo_cierre?: TipoCierre;
    modo_periodo?: ModoPeriodoCierre | string | null;
    rango_desde_hora?: string | null;
    rango_hasta_hora?: string | null;
    efectivo_contado?: number | string | null;
    gastos_monto?: number | string | null;
    gastos_detalle?: string | null;
    gastos_items?: unknown;
    jornada?: string | null;
    origen_ui?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const sucursalScope = await resolveAndValidateSucursalScope(session, body.sucursal_id ?? null);
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  let fechaOperativa = String(body.fecha_operativa || '').trim();
  const tipoCierre: TipoCierre = body.tipo_cierre === 'parcial' ? 'parcial' : 'diario';
  const modoPeriodo: ModoPeriodoCierre =
    body.modo_periodo === 'sesion_apertura' ? 'sesion_apertura' : 'jornada_fecha';

  if (modoPeriodo === 'sesion_apertura' && tipoCierre === 'parcial') {
    return NextResponse.json(
      { error: 'El modo “desde última apertura” no se combina con cierre parcial por hora.' },
      { status: 400 },
    );
  }

  const cajaIdNormalizada = normalizarCaja(body.caja_id ?? null);

  let rangoDesde: string;
  let rangoHasta: string;
  let fondoApertura = 0;
  let sesionAperturaId: string | null = null;
  let modoSnapshot: ModoPeriodoCierre;

  if (tipoCierre === 'parcial') {
    if (!fechaOperativa) fechaOperativa = hoyEnAR();
    let rangoDesdeMin = 0;
    let rangoHastaMin = 23 * 60 + 59;
    const desdeMin = parseHoraToMinutes(body.rango_desde_hora);
    const hastaMin = parseHoraToMinutes(body.rango_hasta_hora);
    if (desdeMin == null || hastaMin == null) {
      return NextResponse.json(
        { error: 'En cierre parcial se requiere rango_desde_hora y rango_hasta_hora (HH:mm).' },
        { status: 400 },
      );
    }
    if (hastaMin <= desdeMin) {
      return NextResponse.json(
        { error: 'rango_hasta_hora debe ser mayor a rango_desde_hora.' },
        { status: 400 },
      );
    }
    rangoDesdeMin = desdeMin;
    rangoHastaMin = hastaMin;
    rangoDesde = minutosToIsoUtc(fechaOperativa, rangoDesdeMin);
    rangoHasta = minutosToIsoUtc(fechaOperativa, rangoHastaMin);
    modoSnapshot = modoPeriodo;
  } else {
    try {
      const ap = await obtenerAperturaVigente(
        session.supabase as any,
        cajaIdNormalizada,
        sucursalScope.sucursalId,
      );
      if (!ap) {
        return NextResponse.json(
          {
            error:
              'No hay sesión de caja abierta (sin cierre final). Registrá la apertura con el efectivo inicial y volvé a intentar.',
          },
          { status: 400 },
        );
      }
      fechaOperativa = String(ap.fecha_operativa);
      rangoDesde = ap.opened_at;
      /** Modo sesión: cerrar con todo lo operado hasta este instante. */
      rangoHasta = new Date().toISOString();
      const tDesdePost = new Date(rangoDesde).getTime();
      const tHastaPost = new Date(rangoHasta).getTime();
      if (Number.isFinite(tDesdePost) && Number.isFinite(tHastaPost) && tHastaPost < tDesdePost) {
        rangoHasta = new Date(tDesdePost + 1000).toISOString();
      }
      fondoApertura = ap.fondo_efectivo;
      sesionAperturaId = ap.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al resolver sesión';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    modoSnapshot = 'sesion_apertura';
  }

  if (tipoCierre === 'diario' && sesionAperturaId) {
    const persisted = await persistCierreZDiarioSesion({
      supabase: session.supabase as any,
      tenantId: session.tenantId,
      userId: session.userId,
      sucursalId: sucursalScope.sucursalId,
      cajaIdNormalizada,
      sesionAperturaId,
      fechaOperativa,
      rangoDesde,
      rangoHasta,
      fondoApertura,
      modoPeriodo: modoSnapshot,
      body,
      payloadOrigen: 'api/caja/cierre-z',
    });
    if (!persisted.ok) {
      return NextResponse.json({ error: persisted.error }, { status: persisted.status });
    }

    const db = session.supabase as any;
    if (cajaIdNormalizada !== '__sin_caja__') {
      const { data: turnoAbierto, error: tunSelErr } = await db
        .from('caja_turno')
        .select('id, caja_id')
        .eq('tenant_id', session.tenantId)
        .eq('usuario_id', session.userId)
        .eq('estado', 'abierto')
        .maybeSingle();
      if (!tunSelErr && turnoAbierto?.id && turnoAbierto.caja_id) {
        const turnoCajaText = cajaUuidComoCajaIdText(String(turnoAbierto.caja_id));
        if (turnoCajaText === cajaIdNormalizada) {
          const cerradoAt = new Date().toISOString();
          const { error: updTurnoErr } = await db
            .from('caja_turno')
            .update({
              estado: 'cerrado',
              cerrado_at: cerradoAt,
              cierre_z_id: persisted.cierre_id,
            })
            .eq('id', turnoAbierto.id)
            .eq('estado', 'abierto');
          if (updTurnoErr) {
            console.error('[cierre-z] Cierre Z OK pero no se pudo cerrar caja_turno:', updTurnoErr.message);
          }
        }
      }
    }

    return NextResponse.json(
      {
        ok: true,
        cierre_id: persisted.cierre_id,
        sucursal_id: sucursalScope.sucursalId,
        snapshot: persisted.snapshot,
        arqueo_efectivo: persisted.arqueo_efectivo,
        ticket_resumen: persisted.ticket_resumen,
      },
      { status: 201 },
    );
  }

  if (tipoCierre === 'parcial') {
    const { data: parciales, error: parcErr } = await (session.supabase as any)
      .from('cierre_z')
      .select('id, rango_desde, rango_hasta')
      .eq('fecha_operativa', fechaOperativa)
      .eq('caja_id', cajaIdNormalizada)
      .eq('sucursal_id', sucursalScope.sucursalId)
      .eq('tipo_cierre', 'parcial');
    if (parcErr) return NextResponse.json({ error: parcErr.message }, { status: 500 });
    for (const p of (parciales ?? []) as any[]) {
      const a = new Date(rangoDesde).getTime();
      const b = new Date(rangoHasta).getTime();
      const x = new Date(p.rango_desde).getTime();
      const y = new Date(p.rango_hasta).getTime();
      if (a < y && b > x) {
        return NextResponse.json(
          { error: 'El rango parcial se solapa con otro cierre existente para esa caja/fecha.' },
          { status: 409 },
        );
      }
    }
  }

  const snapshot = await calcularSnapshot(session.supabase as any, {
    fechaOperativa,
    cajaIdNormalizada,
    sucursalId: sucursalScope.sucursalId,
    rangoDesdeIso: rangoDesde,
    rangoHastaIso: rangoHasta,
    fondoApertura,
    modoPeriodo: modoSnapshot,
    sesionAperturaId,
  });

  const contadoRaw = body.efectivo_contado;
  const contadoNum =
    contadoRaw === null || contadoRaw === undefined || contadoRaw === ''
      ? null
      : Number(contadoRaw);

  const parsedItems = parseGastosItemsCierre(body.gastos_items);
  let gastosMonto = parsedItems.total;
  const gastosItemsGuardados: GastoCierreGuardado[] | null =
    parsedItems.items.length > 0 ? parsedItems.items : null;

  if (!gastosItemsGuardados?.length) {
    const gastosRaw = body.gastos_monto;
    if (gastosRaw !== null && gastosRaw !== undefined && gastosRaw !== '') {
      const g = Number(gastosRaw);
      if (Number.isFinite(g) && g > 0) gastosMonto = redondear2(g);
    }
  }

  const gastosDetalleLegacy = String(body.gastos_detalle || '')
    .trim()
    .slice(0, 500);
  const gastosDetalleResumen =
    gastosItemsGuardados?.length
      ? gastosItemsGuardados.map((i) => `${i.concepto}: ${i.monto}`).join('; ').slice(0, 500)
      : gastosDetalleLegacy || null;
  const jornada = String(body.jornada || '').trim().slice(0, 32) || null;
  const origenUi = String(body.origen_ui || '').trim().slice(0, 48) || null;

  if (tipoCierre === 'diario') {
    if (contadoNum === null || !Number.isFinite(contadoNum) || contadoNum < 0) {
      return NextResponse.json(
        { error: 'En el cierre final del día debés ingresar el efectivo contado en caja (número ≥ 0).' },
        { status: 400 },
      );
    }
  }

  const esperadoSistema = snapshot.efectivo_esperado;
  const esperadoAjustado = redondear2(esperadoSistema - gastosMonto);

  const arqueo =
    contadoNum !== null && Number.isFinite(contadoNum) && contadoNum >= 0
      ? {
          fondo_apertura: snapshot.fondo_apertura,
          efectivo_ventas_periodo: snapshot.efectivo_ventas_periodo,
          esperado_sistema: esperadoSistema,
          gastos_monto: gastosMonto,
          gastos_detalle: gastosDetalleResumen,
          esperado_ajustado: esperadoAjustado,
          contado: redondear2(contadoNum),
          diferencia: redondear2(contadoNum - esperadoAjustado),
          esperado: esperadoAjustado,
        }
      : null;

  const { data: cierre, error: insErr } = await (session.supabase as any)
    .from('cierre_z')
    .insert({
      tenant_id: session.tenantId,
      sucursal_id: sucursalScope.sucursalId,
      caja_id: cajaIdNormalizada,
      fecha_operativa: fechaOperativa,
      caja_apertura_id: tipoCierre === 'diario' ? sesionAperturaId : null,
      tipo_cierre: tipoCierre,
      rango_desde: rangoDesde,
      rango_hasta: rangoHasta,
      total_comprobantes: snapshot.total_comprobantes,
      ventas_brutas: snapshot.ventas_brutas,
      notas_credito_total: snapshot.notas_credito_total,
      ventas_netas: snapshot.ventas_netas,
      pagos_cta_cte_total: snapshot.pagos_cta_cte_total,
      usuario_cierre_id: session.userId,
      payload_resumen: {
        origen: 'api/caja/cierre-z',
        version: 4,
        sucursal_id: sucursalScope.sucursalId,
        tipo_cierre: tipoCierre,
        modo_periodo: modoPeriodo,
        caja_apertura_id: sesionAperturaId,
        rango_desde_hora: String(body.rango_desde_hora || ''),
        rango_hasta_hora: String(body.rango_hasta_hora || ''),
        jornada,
        origen_ui: origenUi,
        gastos_items: gastosItemsGuardados,
        arqueo_efectivo: arqueo,
      },
    })
    .select('id, created_at')
    .single();

  if (insErr) {
    const code = (insErr as { code?: string }).code;
    if (code === '23505') {
      return NextResponse.json(
        {
          error:
            'Ya registraste el cierre final de esta apertura de caja. Abrí caja de nuevo para iniciar otra sesión.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  if (snapshot.medios.length > 0) {
    const { error: medInsErr } = await (session.supabase as any).from('cierre_z_medio_pago').insert(
      snapshot.medios.map((m: any) => ({
        tenant_id: session.tenantId,
        cierre_z_id: cierre.id,
        metodo_pago: m.metodo_pago,
        monto_neto: m.monto_neto,
        cantidad_comprobantes: m.cantidad_comprobantes,
      })),
    );
    if (medInsErr) return NextResponse.json({ error: medInsErr.message }, { status: 500 });
  }

  const ticketResumen = crearTicketResumenCierreCaja({
    cierreId: cierre.id,
    fechaOperativa,
    cajaIdNormalizada,
    rangoDesde,
    rangoHasta,
    createdAt: String(cierre.created_at ?? new Date().toISOString()),
    snapshot,
    arqueo,
    gastosItems: gastosItemsGuardados,
  });

  return NextResponse.json(
    {
      ok: true,
      cierre_id: cierre.id,
      sucursal_id: sucursalScope.sucursalId,
      snapshot,
      arqueo_efectivo: arqueo,
      ticket_resumen: ticketResumen,
    },
    { status: 201 },
  );
}
