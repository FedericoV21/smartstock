import { NextResponse } from 'next/server';

import { lineaCajaTicketDesdeCajaUuid } from '@/lib/caja/linea-caja-etiqueta';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { getMpPointClient, MpPointError } from '@/lib/mp-point/client';
import { intentPointFinalizoConPagoId } from '@/lib/mp-point/payment-v1';
import { procesarNotificacionMpPointIntent } from '@/lib/mp-point/procesar-webhook';
import {
  comprobanteEsVentaMpPointCompleta,
  comprobanteTienePagoMpPoint,
} from '@/lib/mp-point/venta-mp-completa';
import { getMpQrClient, MpQrError } from '@/lib/mp-qr/client';
import { procesarNotificacionMpQrMerchantOrder } from '@/lib/mp-qr/procesar-webhook';
import {
  mpQrErrorEsConsultaOrdenNoDisponible,
  respuestaSincronizarEsperandoQr,
} from '@/lib/mp-qr/sincronizar-helpers';
import { resolveMpQrPos } from '@/lib/mp-qr/verificar-configuracion';
import {
  comprobanteEsVentaMpQrCompleta,
  comprobanteTienePagoMpQr,
} from '@/lib/mp-qr/venta-mp-qr-completa';
import { moduloGuard } from '@/lib/modulos/guard';
import { getPasarelaSecret, stringFromUnknown } from '@/lib/pasarelas/secrets';
import { getSupabaseServiceRoleKey } from '@/lib/supabase/env-keys';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const maxDuration = 60;

const RATE_MS = 5000;
const ultimaSyncPorComprobante = new Map<string, number>();

const SEL =
  'id, tenant_id, sucursal_id, tipo, estado, cae, mp_point_intent_id, mp_point_payment_id, mp_qr_order_id, mp_qr_payment_id, metodo_pago, total, numero, numero_caja, caja_uuid, pdf_url, ultimo_error_arca_mensaje, ultimo_error_arca_codigo';

async function extrasLineaCajaTicket(db: any, row: { caja_uuid?: string | null; numero_caja?: number | null }) {
  const linea = await lineaCajaTicketDesdeCajaUuid(db, row.caja_uuid ?? null);
  const nc = row.numero_caja;
  const numeroCaja = nc != null && Number.isFinite(Number(nc)) ? Number(nc) : null;
  return {
    ...(numeroCaja != null ? { numero_caja: numeroCaja } : {}),
    ...(linea ? { linea_caja_ticket: linea } : {}),
  };
}

function respuestaFiscalPendiente(comp: any, canal: 'qr' | 'terminal', extras: Record<string, unknown>) {
  const est = String(comp.estado ?? '');
  const medio = canal === 'qr' ? 'QR' : 'Posnet';
  let mensaje =
    `El cobro con ${medio} quedo registrado; el comprobante sigue en proceso. Reconsulta en unos segundos o abri el detalle en Facturacion.`;
  if (est === 'pendiente_arca') {
    mensaje =
      `El cobro con ${medio} quedo registrado. Falta la autorizacion fiscal (CAE). Podes reintentar desde Facturacion o esperar unos segundos y volver a consultar.`;
  } else if (est === 'error_arca') {
    const u = (comp.ultimo_error_arca_mensaje as string | null | undefined)?.trim();
    mensaje = u
      ? `El cobro con ${medio} quedo registrado pero la autorizacion fiscal fallo: ${u}`
      : `El cobro con ${medio} quedo registrado pero la autorizacion fiscal fallo. Revisa Facturacion / bandeja ARCA o reintenta la emision.`;
  }
  return NextResponse.json({
    estado: comp.estado,
    estado_nexus: comp.estado,
    estado_mp: canal === 'terminal' ? 'FINISHED' : undefined,
    payment_type: canal === 'qr' ? 'qr' : null,
    mp_cobro_completo: false,
    pago_mp_registrado: true,
    proceso_qr_ejecutado: false,
    proceso_posnet_ejecutado: false,
    mensaje,
    numero: comp.numero,
    cae: comp.cae ?? null,
    pdf_url: comp.pdf_url ?? null,
    mp_qr_payment_id: comp.mp_qr_payment_id ?? null,
    mp_point_payment_id: comp.mp_point_payment_id ?? null,
    ...extras,
  });
}

async function resolverTransaccion(db: any, tenantId: string, comprobanteId: string, integracionId?: string | null) {
  let q = db
    .from('pasarela_transaccion')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('comprobante_id', comprobanteId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (integracionId) q = q.eq('integracion_id', integracionId);
  return q.maybeSingle();
}

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const comprobanteId = typeof body.comprobante_id === 'string' ? body.comprobante_id.trim() : '';
  const integracionId = typeof body.integracion_id === 'string' ? body.integracion_id.trim() : '';
  if (!comprobanteId) return NextResponse.json({ error: 'comprobante_id requerido' }, { status: 400 });

  const now = Date.now();
  const rateKey = `${integracionId || 'auto'}:${comprobanteId}`;
  const prev = ultimaSyncPorComprobante.get(rateKey) ?? 0;
  if (now - prev < RATE_MS) {
    return NextResponse.json({ error: 'Espera unos segundos antes de volver a sincronizar' }, { status: 429 });
  }
  ultimaSyncPorComprobante.set(rateKey, now);

  const db = session.supabase as any;
  const { data: comp, error: compErr } = await db.from('comprobante').select(SEL).eq('id', comprobanteId).maybeSingle();
  if (compErr || !comp || comp.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  const { data: tx, error: txErr } = await resolverTransaccion(
    db,
    session.tenantId,
    comprobanteId,
    integracionId || null,
  );
  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });
  if (!tx) return NextResponse.json({ error: 'No hay transaccion de pasarela para sincronizar' }, { status: 400 });

  const { data: integracion, error: iErr } = await db
    .from('pasarela_integracion')
    .select('*')
    .eq('id', tx.integracion_id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  if (!integracion) return NextResponse.json({ error: 'Integracion no encontrada' }, { status: 404 });

  const canal = String(integracion.canal) === 'qr' ? 'qr' : 'terminal';
  const extras = await extrasLineaCajaTicket(db, comp);
  if (canal === 'terminal' && comprobanteEsVentaMpPointCompleta(comp)) {
    return NextResponse.json({
      estado_mp: 'FINISHED',
      estado_nexus: 'emitido',
      payment_type: null,
      mp_cobro_completo: true,
      proceso_posnet_ejecutado: false,
      numero: comp.numero,
      pdf_url: comp.pdf_url ?? null,
      ...extras,
    });
  }
  if (canal === 'qr' && comprobanteEsVentaMpQrCompleta(comp)) {
    return NextResponse.json({
      estado: comp.estado,
      estado_nexus: comp.estado,
      mp_cobro_completo: true,
      proceso_qr_ejecutado: false,
      numero: comp.numero,
      pdf_url: comp.pdf_url ?? null,
      mp_qr_payment_id: comp.mp_qr_payment_id,
      payment: comp.mp_qr_payment_id != null ? { id: comp.mp_qr_payment_id } : undefined,
      ...extras,
    });
  }
  if (canal === 'terminal' && comprobanteTienePagoMpPoint(comp) && !comprobanteEsVentaMpPointCompleta(comp)) {
    return respuestaFiscalPendiente(comp, canal, extras);
  }
  if (canal === 'qr' && comprobanteTienePagoMpQr(comp) && !comprobanteEsVentaMpQrCompleta(comp)) {
    return respuestaFiscalPendiente(comp, canal, extras);
  }

  if (canal === 'terminal') {
    if (!comp.mp_point_intent_id) {
      return NextResponse.json({ error: 'No hay intent de terminal para sincronizar' }, { status: 400 });
    }
    const token = getPasarelaSecret(integracion, 'access_token');
    const deviceId = stringFromUnknown(integracion.config_publica?.device_id);
    if (!token || !deviceId) return NextResponse.json({ error: 'Configuracion de terminal incompleta' }, { status: 400 });

    try {
      const intent = await getMpPointClient(token).getPaymentIntent(deviceId, comp.mp_point_intent_id);
      let procesoPosnetEjecutado = false;
      if (
        comp.estado === 'pendiente_posnet' &&
        comp.mp_point_payment_id == null &&
        intentPointFinalizoConPagoId(intent) &&
        getSupabaseServiceRoleKey()
      ) {
        await procesarNotificacionMpPointIntent(createServiceRoleClient(), { intentId: comp.mp_point_intent_id });
        procesoPosnetEjecutado = true;
      }

      const { data: finalRow } = await db.from('comprobante').select(SEL).eq('id', comprobanteId).maybeSingle();
      const row = finalRow ?? comp;
      const extras2 = await extrasLineaCajaTicket(db, row);
      if (comprobanteEsVentaMpPointCompleta(row)) {
        return NextResponse.json({
          estado_mp: 'FINISHED',
          estado_nexus: 'emitido',
          payment_type: null,
          mp_cobro_completo: true,
          proceso_posnet_ejecutado: procesoPosnetEjecutado,
          numero: row.numero,
          pdf_url: row.pdf_url ?? null,
          ...extras2,
        });
      }
      return NextResponse.json({
        estado_mp: intent.state,
        estado_nexus: row.estado,
        payment_type: intent.payment?.type ?? null,
        proceso_posnet_ejecutado: procesoPosnetEjecutado,
        ...extras2,
      });
    } catch (e) {
      if (e instanceof MpPointError) {
        return NextResponse.json({ error: e.message, mp_error_code: e.code }, { status: e.status >= 500 ? 503 : 400 });
      }
      console.error('[pasarela sincronizar terminal]', e);
      return NextResponse.json({ error: 'Error al sincronizar con la terminal' }, { status: 503 });
    }
  }

  const token = getPasarelaSecret(integracion, 'access_token');
  const userId = stringFromUnknown(integracion.config_publica?.user_id);
  let externalPosId = stringFromUnknown(integracion.config_publica?.external_pos_id);
  let externalStoreId = stringFromUnknown(integracion.config_publica?.external_store_id);
  if (!token || !userId || !externalPosId) {
    return NextResponse.json({ error: 'Configuracion de QR incompleta' }, { status: 400 });
  }

  try {
    const externalPosIdInicial = externalPosId;
    const resolvedPos = await resolveMpQrPos({
        access_token: token,
        user_id: userId,
        external_pos_id: externalPosIdInicial,
        external_store_id: externalStoreId,
      }).catch(() => ({
        external_pos_id: externalPosIdInicial,
        external_store_id: externalStoreId,
        resolved_from_internal_id: false,
      }));
    externalPosId = resolvedPos.external_pos_id;
    externalStoreId = resolvedPos.external_store_id;
    const client = getMpQrClient(token, userId);
    const ordenActiva = await client.getOrder(externalPosId, { externalStoreId });
    return NextResponse.json({
      estado: 'pendiente_qr',
      estado_nexus: 'pendiente_qr',
      proceso_qr_ejecutado: false,
      numero: comp.numero,
      pdf_url: comp.pdf_url ?? null,
      orden_activa: ordenActiva,
    });
  } catch (e) {
    const merchantOrderId = comp.mp_qr_order_id || tx.external_order_id;
    const puedeFallback =
      merchantOrderId &&
      e instanceof MpQrError &&
      (e.status === 403 || e.status === 404 || e.status === 405 || e.status === 429 || e.status >= 500);

    if (puedeFallback) {
      let procesoQrEjecutado = false;
      try {
        const client = getMpQrClient(token, userId);
        const mo = await client.getMerchantOrder(merchantOrderId);
        const totalOrden = Number(mo.total_amount ?? 0);
        const hayAprobado = (mo.payments ?? []).some(
          (p) => p.status === 'approved' && (Number(p.transaction_amount) || 0) + 0.015 >= totalOrden - 0.015,
        );
        if (hayAprobado && getSupabaseServiceRoleKey()) {
          await procesarNotificacionMpQrMerchantOrder(createServiceRoleClient(), {
            merchantOrderId,
            tenantId: session.tenantId,
            sucursalId: comp.sucursal_id,
            integracionId: integracion.id,
          });
          procesoQrEjecutado = true;
        }
        const { data: finalRow } = await db.from('comprobante').select(SEL).eq('id', comprobanteId).maybeSingle();
        const row = finalRow ?? comp;
        const extras2 = await extrasLineaCajaTicket(db, row);
        if (comprobanteEsVentaMpQrCompleta(row)) {
          return NextResponse.json({
            estado: row.estado,
            estado_nexus: row.estado,
            mp_cobro_completo: true,
            proceso_qr_ejecutado: procesoQrEjecutado,
            numero: row.numero,
            pdf_url: row.pdf_url ?? null,
            mp_qr_payment_id: row.mp_qr_payment_id,
            payment: row.mp_qr_payment_id != null ? { id: row.mp_qr_payment_id } : undefined,
            ...extras2,
          });
        }
        return NextResponse.json({
          estado: row.estado,
          estado_nexus: row.estado,
          proceso_qr_ejecutado: procesoQrEjecutado,
          numero: row.numero,
          pdf_url: row.pdf_url ?? null,
          mp_qr_payment_id: row.mp_qr_payment_id ?? null,
          merchant_order: mo,
          ...extras2,
        });
      } catch (e2) {
        if (e2 instanceof MpQrError) return NextResponse.json({ error: e2.message }, { status: 503 });
        throw e2;
      }
    }
    if (mpQrErrorEsConsultaOrdenNoDisponible(e)) {
      const extras2 = await extrasLineaCajaTicket(db, comp);
      return NextResponse.json(
        respuestaSincronizarEsperandoQr({
          numero: comp.numero,
          pdf_url: comp.pdf_url ?? null,
          ...extras2,
        }),
      );
    }
    if (e instanceof MpQrError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error('[pasarela sincronizar qr]', e);
    return NextResponse.json({ error: 'Error al sincronizar QR' }, { status: 503 });
  }
}
