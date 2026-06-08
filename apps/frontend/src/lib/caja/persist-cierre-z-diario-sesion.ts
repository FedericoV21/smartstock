import {
  calcularSnapshot,
  redondear2,
  type ModoPeriodoCierre,
  type SnapshotCierreZ,
} from '@/lib/caja/cierre-z-calculo';
import {
  crearTicketResumenCierreCaja,
  type ArqueoEfectivoCierre,
  type CierreCajaTicketResumen,
  type GastoCierreGuardado,
} from '@/lib/caja/cierre-ticket-resumen';
import {
  marcarGastosIncluidosEnCierre,
  resolverGastosParaCierreDiario,
} from '@/lib/caja/caja-gastos-sesion';
import { parseGastosItemsCierre } from '@/lib/caja/gastos-cierre';
import {
  cajaAperturaIdDesdePayloadResumen,
  cierreDiarioMismaVentana,
  cierreDiarioMismoRangoDesde,
} from '@/lib/caja/sesion-caja';

export type { ArqueoEfectivoCierre };

export type CierreZDiarioSesionBody = {
  efectivo_contado?: number | string | null;
  gastos_monto?: number | string | null;
  gastos_detalle?: string | null;
  gastos_items?: unknown;
  jornada?: string | null;
  origen_ui?: string | null;
};

export type PersistCierreZDiarioSesionResult =
  | {
      ok: true;
      cierre_id: string;
      snapshot: SnapshotCierreZ;
      arqueo_efectivo: ArqueoEfectivoCierre | null;
      ticket_resumen: CierreCajaTicketResumen;
    }
  | { ok: false; status: number; error: string };

/**
 * Cierre Z diario ligado a `caja_apertura` (misma lógica que POST /api/caja/cierre-z en modo sesión).
 * Usado por `/api/caja/cierre-z` y `/api/caja/turno/cerrar`.
 */
export async function persistCierreZDiarioSesion(opts: {
  supabase: any;
  tenantId: string;
  userId: string;
  sucursalId: string;
  cajaIdNormalizada: string;
  sesionAperturaId: string;
  fechaOperativa: string;
  rangoDesde: string;
  rangoHasta: string;
  fondoApertura: number;
  modoPeriodo: ModoPeriodoCierre;
  body: CierreZDiarioSesionBody;
  /** `payload_resumen.origen` para trazabilidad */
  payloadOrigen: string;
  /**
   * Cierra tomando efectivo contado = esperado ajustado (sin diferencia de arqueo).
   * Solo debe usarse tras validación aparte (p. ej. horas máximas de turno).
   */
  usarEfectivoEsperadoComoContado?: boolean;
}): Promise<PersistCierreZDiarioSesionResult> {
  const {
    supabase,
    tenantId,
    userId,
    sucursalId,
    cajaIdNormalizada,
    sesionAperturaId,
    fechaOperativa,
    rangoDesde,
    rangoHasta,
    fondoApertura,
    modoPeriodo,
    body,
    payloadOrigen,
    usarEfectivoEsperadoComoContado = false,
  } = opts;

  const { data: yaRows, error: sesErr } = await supabase
    .from('cierre_z')
    .select('id, caja_apertura_id, payload_resumen')
    .eq('tipo_cierre', 'diario')
    .eq('caja_id', cajaIdNormalizada)
    .eq('sucursal_id', sucursalId)
    .order('created_at', { ascending: false })
    .limit(40);
  if (sesErr) return { ok: false, status: 500, error: sesErr.message };
  const yaSesion = (yaRows ?? []).find(
    (row: { id: string; caja_apertura_id?: string | null; payload_resumen?: unknown }) =>
      row.caja_apertura_id === sesionAperturaId ||
      cajaAperturaIdDesdePayloadResumen(row.payload_resumen) === sesionAperturaId,
  );
  if (yaSesion?.id) {
    return {
      ok: false,
      status: 409,
      error:
        'Ya registraste el cierre final de esta apertura de caja. Abrí caja de nuevo para iniciar otra sesión.',
    };
  }
  const { data: candidatosDup, error: dupPerErr } = await supabase
    .from('cierre_z')
    .select('id, rango_desde, rango_hasta')
    .eq('tipo_cierre', 'diario')
    .eq('caja_id', cajaIdNormalizada)
    .eq('sucursal_id', sucursalId)
    .order('created_at', { ascending: false })
    .limit(25);
  if (dupPerErr) return { ok: false, status: 500, error: dupPerErr.message };
  const dupMismoPeriodo = (candidatosDup ?? []).find(
    (row: { id: string; rango_desde: string; rango_hasta: string }) =>
      cierreDiarioMismaVentana(row.rango_desde, row.rango_hasta, rangoDesde, rangoHasta) ||
      cierreDiarioMismoRangoDesde(row.rango_desde, rangoDesde),
  );
  if (dupMismoPeriodo?.id) {
    return {
      ok: false,
      status: 409,
      error:
        'Ya existe un cierre final con el mismo período para esta caja. Abrí caja de nuevo para una sesión nueva.',
    };
  }

  const snapshot = await calcularSnapshot(supabase, {
    fechaOperativa,
    cajaIdNormalizada,
    sucursalId,
    rangoDesdeIso: rangoDesde,
    rangoHastaIso: rangoHasta,
    fondoApertura,
    modoPeriodo,
    sesionAperturaId,
  });

  const gastosResueltos = await resolverGastosParaCierreDiario(
    supabase,
    sesionAperturaId,
    body.gastos_items,
  );
  if (!gastosResueltos.ok) {
    return { ok: false, status: 400, error: gastosResueltos.error };
  }
  let gastosMonto = gastosResueltos.total;
  const gastosItemsGuardados: GastoCierreGuardado[] | null = gastosResueltos.itemsGuardados;

  if (!gastosItemsGuardados?.length) {
    const gastosRaw = body.gastos_monto;
    if (gastosRaw !== null && gastosRaw !== undefined && gastosRaw !== '') {
      const g = Number(gastosRaw);
      if (Number.isFinite(g) && g > 0) gastosMonto = redondear2(g);
    }
  }

  const esperadoSistema = snapshot.efectivo_esperado;
  const esperadoAjustado = redondear2(esperadoSistema - gastosMonto);

  let contadoNum: number;
  if (usarEfectivoEsperadoComoContado) {
    contadoNum = esperadoAjustado;
    if (!Number.isFinite(contadoNum) || contadoNum < 0) {
      return {
        ok: false,
        status: 400,
        error: 'No se pudo calcular el efectivo esperado para el cierre automático.',
      };
    }
  } else {
    const contadoRaw = body.efectivo_contado;
    const parsed =
      contadoRaw === null || contadoRaw === undefined || contadoRaw === '' ? null : Number(contadoRaw);
    if (parsed === null || !Number.isFinite(parsed) || parsed < 0) {
      return {
        ok: false,
        status: 400,
        error: 'En el cierre final del día debés ingresar el efectivo contado en caja (número ≥ 0).',
      };
    }
    contadoNum = parsed;
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

  const arqueo: ArqueoEfectivoCierre = {
    fondo_apertura: snapshot.fondo_apertura,
    efectivo_ventas_periodo: snapshot.efectivo_ventas_periodo,
    esperado_sistema: esperadoSistema,
    gastos_monto: gastosMonto,
    gastos_detalle: gastosDetalleResumen,
    esperado_ajustado: esperadoAjustado,
    contado: redondear2(contadoNum),
    diferencia: redondear2(contadoNum - esperadoAjustado),
    esperado: esperadoAjustado,
  };

  const { data: cierre, error: insErr } = await supabase
    .from('cierre_z')
    .insert({
      tenant_id: tenantId,
      sucursal_id: sucursalId,
      caja_id: cajaIdNormalizada,
      fecha_operativa: fechaOperativa,
      caja_apertura_id: sesionAperturaId,
      tipo_cierre: 'diario',
      rango_desde: rangoDesde,
      rango_hasta: rangoHasta,
      total_comprobantes: snapshot.total_comprobantes,
      ventas_brutas: snapshot.ventas_brutas,
      notas_credito_total: snapshot.notas_credito_total,
      ventas_netas: snapshot.ventas_netas,
      pagos_cta_cte_total: snapshot.pagos_cta_cte_total,
      usuario_cierre_id: userId,
      payload_resumen: {
        origen: payloadOrigen,
        version: 4,
        sucursal_id: sucursalId,
        tipo_cierre: 'diario',
        modo_periodo: modoPeriodo,
        caja_apertura_id: sesionAperturaId,
        rango_desde_hora: '',
        rango_hasta_hora: '',
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
      return {
        ok: false,
        status: 409,
        error:
          'Ya registraste el cierre final de esta apertura de caja. Abrí caja de nuevo para iniciar otra sesión.',
      };
    }
    return { ok: false, status: 500, error: insErr.message };
  }

  try {
    await marcarGastosIncluidosEnCierre(supabase, sesionAperturaId, cierre.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'No se pudieron vincular los gastos del turno al cierre';
    return { ok: false, status: 500, error: msg };
  }

  if (snapshot.medios.length > 0) {
    const { error: medInsErr } = await supabase.from('cierre_z_medio_pago').insert(
      snapshot.medios.map((m: { metodo_pago: string; monto_neto: number; cantidad_comprobantes: number }) => ({
        tenant_id: tenantId,
        cierre_z_id: cierre.id,
        metodo_pago: m.metodo_pago,
        monto_neto: m.monto_neto,
        cantidad_comprobantes: m.cantidad_comprobantes,
      })),
    );
    if (medInsErr) return { ok: false, status: 500, error: medInsErr.message };
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

  return {
    ok: true,
    cierre_id: cierre.id,
    snapshot,
    arqueo_efectivo: arqueo,
    ticket_resumen: ticketResumen,
  };
}
