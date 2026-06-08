import type { SupabaseClient } from '@supabase/supabase-js';

import { auditLogPosnet } from '@/lib/mp-point/audit-log';
import {
  resolverNumeroParaSolicitudCae,
  type ArcaConfigEmision,
  type ResolverNumeroCaeOk,
} from '@/lib/facturacion/arca/numeracion-pre-cae';
import { enriquecerMensajeSiError10016Alineacion } from '@/lib/facturacion/arca/enriquecer-mensaje-rechazo-afip';
import { solicitarCAE, type SolicitudCAE } from '@/lib/facturacion/arca/wsfe';
import { hoyEnAR, sumarDiasYmdAR } from '@/lib/utils/formatters';
import type { Database } from '@/types/database';

type ResultadoCaeSoap = Awaited<ReturnType<typeof solicitarCAE>>;

function textoAfipSinTildes(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Solo reintentamos con nuevo número ante desalineación de serie (no otros 10016, ej. DocNro).
 * AFIP suele devolverlo en `<Obs>`; mensajes mezclan con/sin tildes ("proximo" vs "próximo").
 */
/** Compara ISO YYYY-MM-DD por orden léxico seguro mismo largo. */
function maxIsoYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * `CbteFch` debe ser ≥ max(fecha comprobante, hoy Argentina, fecha último mismo PtoVta/tipo vía FECompConsultar).
 * Así cubre «no anterior al último emitido» incluso si hubo fecha «futura» en la autorización previa.
 */
function fechaEmisionConCorrelativaAfip(fechaComprobanteYmd: string, fechaMinCorrelativaAfip: string | null): string {
  const hoy = hoyEnAR();
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(fechaComprobanteYmd) ? fechaComprobanteYmd : hoy;
  let d = maxIsoYmd(raw, hoy);
  if (fechaMinCorrelativaAfip && /^\d{4}-\d{2}-\d{2}$/.test(fechaMinCorrelativaAfip)) {
    d = maxIsoYmd(d, fechaMinCorrelativaAfip);
  }
  return d;
}

function esRechazoNumeracionProximoAutorizar(r: ResultadoCaeSoap): boolean {
  if (r.aprobado) return false;
  for (const e of [...r.errores, ...r.observaciones]) {
    const code = String(e.codigo ?? '').trim();
    if (code === '10016') return true;
    const msg = String(e.mensaje ?? '').trim();
    if (!msg) continue;
    const t = textoAfipSinTildes(msg);
    if (t.includes('fecompultimoautorizado')) return true;
    if (t.includes('proximo') && t.includes('autorizar')) return true;
    if (t.includes('numero') && t.includes('fecha') && t.includes('corresponde')) return true;
    if (t.includes('no se corresponde') && t.includes('proximo')) return true;
    if (t.includes('consultar') && t.includes('fecomp')) return true;
  }
  return false;
}

export type SolicitarCaeYAsignarNumeroOk = {
  ok: true;
  numero: number;
  cae: string;
  caeVencimiento: string | null;
};

export type SolicitarCaeYAsignarNumeroFail =
  | { ok: false; kind: 'network'; message: string }
  | { ok: false; kind: 'reject'; message: string; codigo?: string }
  | { ok: false; kind: 'config'; message: string };

export type SolicitarCaeYAsignarNumeroResult =
  | SolicitarCaeYAsignarNumeroOk
  | SolicitarCaeYAsignarNumeroFail;

/**
 * Bloquea `arca_config`, obtiene el próximo número (AFIP + local), llama a FECAESolicitar y
 * persiste número + CAE solo si ARCA aprueba (modelo v9).
 */
export async function solicitarCaeYAsignarNumero(
  supabase: SupabaseClient<Database>,
  arcaConfig: ArcaConfigEmision,
  comprobanteId: string,
  solicitudSinNumero: Omit<SolicitudCAE, 'numero' | 'tenantId' | 'tipo'>,
): Promise<SolicitarCaeYAsignarNumeroResult> {
  const { data: row, error: loadErr } = await supabase
    .from('comprobante')
    .select('id, tenant_id, sucursal_id, tipo, estado, intentos_arca, numero, cae')
    .eq('id', comprobanteId)
    .maybeSingle();

  if (loadErr || !row) {
    return { ok: false, kind: 'config', message: loadErr?.message ?? 'Comprobante no encontrado' };
  }

  if (row.tenant_id !== arcaConfig.tenant_id) {
    return { ok: false, kind: 'config', message: 'Tenant no coincide' };
  }

  if (!['pendiente_arca', 'error_arca'].includes(row.estado)) {
    return {
      ok: false,
      kind: 'config',
      message: 'El comprobante no está pendiente de ARCA ni en error.',
    };
  }

  const intentosPrev = row.intentos_arca ?? 0;
  const nextIntentos = intentosPrev + 1;
  const nowIso = new Date().toISOString();

  const { error: lockErr } = await supabase.rpc('lock_arca_config_for_update', {
    p_tenant_id: row.tenant_id,
  });
  if (lockErr) {
    return { ok: false, kind: 'config', message: `Lock ARCA: ${lockErr.message}` };
  }

  const numeroResultRaw = await resolverNumeroParaSolicitudCae(
    supabase,
    { tenantId: row.tenant_id, sucursalId: row.sucursal_id },
    row.tipo,
    arcaConfig,
  );
  if ('error' in numeroResultRaw) {
    return { ok: false, kind: 'reject', message: numeroResultRaw.error, codigo: 'NUMERACION' };
  }
  let numeroRes: ResolverNumeroCaeOk = numeroResultRaw;

  const buildSolicitud = (numero: number, opts?: { fecha?: string }) => {
    const base = {
      ...solicitudSinNumero,
      tenantId: row.tenant_id,
      tipo: row.tipo,
      numero,
    };
    return opts?.fecha ? { ...base, fecha: opts.fecha } : base;
  };

  /** Fecha efectiva enviada en el último `FECAESolicitar` (para persistir en comprobante si difiere del borrador). */
  let fechaEmitidaConCae: string | undefined;

  const fechaInicialSoap = fechaEmisionConCorrelativaAfip(
    solicitudSinNumero.fecha,
    numeroRes.fechaMinCorrelativaAfip,
  );
  fechaEmitidaConCae = fechaInicialSoap;

  if (process.env.NODE_ENV === 'development') {
    console.log('[ARCA][solicitarCaeYAsignarNumero] primera FECAESolicitar', {
      comprobante_id: comprobanteId,
      tipo: row.tipo,
      ambiente: arcaConfig.ambiente,
      punto_de_venta: arcaConfig.punto_de_venta,
      cbte_desde_hasta: numeroRes.numero,
      fecha_comprobante_borrador: solicitudSinNumero.fecha,
      cbte_fch_efectiva_ymd: fechaInicialSoap,
      hoy_ar: hoyEnAR(),
    });
  }

  let resultado = await solicitarCAE(
    supabase,
    arcaConfig,
    buildSolicitud(numeroRes.numero, { fecha: fechaInicialSoap }),
    comprobanteId,
  );

  let intentosAlineacion = 0;
  const MAX_ALINEACION = 12;
  while (
    !resultado.aprobado &&
    esRechazoNumeracionProximoAutorizar(resultado) &&
    intentosAlineacion < MAX_ALINEACION
  ) {
    intentosAlineacion++;
    const prevNum = numeroRes.numero;
    const otra = await resolverNumeroParaSolicitudCae(
      supabase,
      { tenantId: row.tenant_id, sucursalId: row.sucursal_id },
      row.tipo,
      arcaConfig,
    );
    if ('error' in otra) break;

    /** Siempre el número que devuelve el resolver (basado en FECompUltimo+1). No forzar `prevNum+1`: eso saltaba el correlativo que exige AFIP. */
    const candidato = otra.numero;

    numeroRes = { numero: candidato, fechaMinCorrelativaAfip: otra.fechaMinCorrelativaAfip };
    const baseFecha = fechaEmisionConCorrelativaAfip(
      solicitudSinNumero.fecha,
      otra.fechaMinCorrelativaAfip,
    );
    /** A partir del 3.er reintento, sumamos días civiles (10016 por fecha vs último autorizado). */
    let fechaSoap = baseFecha;
    if (intentosAlineacion >= 3) {
      const diasExtra = intentosAlineacion - 2;
      fechaSoap = maxIsoYmd(baseFecha, sumarDiasYmdAR(baseFecha, diasExtra));
    }
    fechaEmitidaConCae = fechaSoap;
    if (process.env.NODE_ENV === 'development') {
      console.log('[ARCA][solicitarCaeYAsignarNumero] reintento alineación', {
        intento: intentosAlineacion,
        cbte_desde_hasta: numeroRes.numero,
        cbte_fch_efectiva_ymd: fechaSoap,
      });
    }
    resultado = await solicitarCAE(
      supabase,
      arcaConfig,
      buildSolicitud(numeroRes.numero, { fecha: fechaSoap }),
      comprobanteId,
    );
  }

  if (resultado.aprobado && resultado.cae) {
    const updateRow: Record<string, unknown> = {
      numero: numeroRes.numero,
      cae: resultado.cae,
      cae_vencimiento: resultado.caeVencimiento,
      estado: 'emitido',
      intentos_arca: nextIntentos,
      ultimo_intento_arca_at: nowIso,
      ultimo_error_arca_codigo: null,
      ultimo_error_arca_mensaje: null,
    };
    if (fechaEmitidaConCae) {
      updateRow.fecha = fechaEmitidaConCae;
    }

    const { data: updated, error: updErr } = await supabase
      .from('comprobante')
      .update(updateRow as never)
      .eq('id', comprobanteId)
      .in('estado', ['pendiente_arca', 'error_arca'])
      .select('id')
      .maybeSingle();

    if (updErr || !updated) {
      return {
        ok: false,
        kind: 'reject',
        message:
          'No se pudo confirmar el CAE en base (posible condición de carrera). Reintentá desde la bandeja.',
        codigo: 'RACE',
      };
    }

    await supabase
      .from('arca_config')
      .update({ ultimo_comprobante: numeroRes.numero })
      .eq('tenant_id', row.tenant_id)
      .eq('sucursal_id', row.sucursal_id);

    return {
      ok: true,
      numero: numeroRes.numero,
      cae: resultado.cae,
      caeVencimiento: resultado.caeVencimiento,
    };
  }

  if (resultado.errores.some((e) => e.codigo === 'NETWORK')) {
    await supabase
      .from('comprobante')
      .update({
        estado: 'pendiente_arca' as never,
        intentos_arca: nextIntentos,
        ultimo_intento_arca_at: nowIso,
        ultimo_error_arca_codigo: 'NETWORK',
        ultimo_error_arca_mensaje: resultado.errores[0]?.mensaje ?? 'Sin respuesta de ARCA',
      })
      .eq('id', comprobanteId);

    auditLogPosnet('arca_cae_network', {
      comprobante_id: comprobanteId,
      tenant_id: row.tenant_id,
      message: resultado.errores[0]?.mensaje ?? 'Sin respuesta de ARCA',
    });
    return {
      ok: false,
      kind: 'network',
      message: resultado.errores[0]?.mensaje ?? 'Sin respuesta de ARCA',
    };
  }

  const firstErr = resultado.errores[0] ?? resultado.observaciones[0];
  const mensajeRechazo = enriquecerMensajeSiError10016Alineacion(
    firstErr?.mensaje ?? 'ARCA rechazó la solicitud',
    firstErr?.codigo ?? null,
  );
  auditLogPosnet('arca_cae_rechazo', {
    comprobante_id: comprobanteId,
    tenant_id: row.tenant_id,
    tipo: row.tipo,
    codigo: firstErr?.codigo ?? null,
    mensaje: firstErr?.mensaje ?? null,
  });
  await supabase
    .from('comprobante')
    .update({
      estado: 'error_arca' as never,
      ultimo_error_arca_codigo: firstErr?.codigo ?? null,
      ultimo_error_arca_mensaje: mensajeRechazo,
      intentos_arca: nextIntentos,
      ultimo_intento_arca_at: nowIso,
    })
    .eq('id', comprobanteId);

  return {
    ok: false,
    kind: 'reject',
    message: mensajeRechazo,
    codigo: firstErr?.codigo,
  };
}
