import { NextResponse } from 'next/server';

import { lineaCajaTicketDesdeCajaUuid } from '@/lib/caja/linea-caja-etiqueta';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { auditLogPosnet } from '@/lib/mp-point/audit-log';
import { getMpPointClient, MpPointError } from '@/lib/mp-point/client';
import { decryptAccessToken, loadMpPointConfig } from '@/lib/mp-point/load-config';
import { intentPointFinalizoConPagoId } from '@/lib/mp-point/payment-v1';
import { procesarNotificacionMpPointIntent } from '@/lib/mp-point/procesar-webhook';
import {
  comprobanteEsVentaMpPointCompleta,
  comprobanteTienePagoMpPoint,
} from '@/lib/mp-point/venta-mp-completa';
import { getSupabaseServiceRoleKey } from '@/lib/supabase/env-keys';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { moduloGuard } from '@/lib/modulos/guard';

export const maxDuration = 60;

/** Misma política que GET estado: una acción explícita del usuario no debe spamear MP. */
const ultimaSyncPorComprobante = new Map<string, number>();
const RATE_MS = 5000;

const SEL =
  'id, tenant_id, sucursal_id, tipo, estado, cae, mp_point_intent_id, mp_point_payment_id, metodo_pago, numero, numero_caja, caja_uuid, pdf_url, ultimo_error_arca_mensaje';

/**
 * Ejecutado solo por el usuario ("Consultar estado" en POS).
 * Obtiene estado del intent Point y —si aplica— dispara la misma lógica que el webhook (`procesarNotificacionMpPointIntent`).
 * `GET /api/pagos/mp-point/estado` queda sólo lectura (sin efectos secundarios).
 */
export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const comprobanteId =
    body && typeof body === 'object' && 'comprobante_id' in body
      ? String((body as { comprobante_id?: unknown }).comprobante_id ?? '').trim()
      : '';
  if (!comprobanteId) {
    return NextResponse.json({ error: 'comprobante_id requerido' }, { status: 400 });
  }

  const now = Date.now();
  const prev = ultimaSyncPorComprobante.get(comprobanteId) ?? 0;
  if (now - prev < RATE_MS) {
    return NextResponse.json(
      { error: 'Esperá unos segundos antes de volver a sincronizar' },
      { status: 429 },
    );
  }
  ultimaSyncPorComprobante.set(comprobanteId, now);

  const { data: comp, error: cErr } = await session.supabase
    .from('comprobante')
    .select(SEL)
    .eq('id', comprobanteId)
    .maybeSingle();

  if (cErr || !comp || comp.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (comprobanteEsVentaMpPointCompleta(comp)) {
    const row = comp as unknown as { caja_uuid?: string | null; numero_caja?: number | null };
    const linea = await lineaCajaTicketDesdeCajaUuid(session.supabase, row.caja_uuid ?? null);
    const nc = row.numero_caja;
    const numeroCaja = nc != null && Number.isFinite(Number(nc)) ? Number(nc) : null;
    return NextResponse.json({
      estado_mp: 'FINISHED' as const,
      estado_nexus: 'emitido' as const,
      payment_type: null,
      mp_cobro_completo: true,
      proceso_posnet_ejecutado: false,
      numero: comp.numero,
      pdf_url: (comp as { pdf_url?: string | null }).pdf_url ?? null,
      ...(numeroCaja != null ? { numero_caja: numeroCaja } : {}),
      ...(linea ? { linea_caja_ticket: linea } : {}),
    });
  }

  if (!comp.mp_point_intent_id) {
    if (comp.estado === 'pendiente_posnet') {
      return NextResponse.json(
        {
          error:
            'Este comprobante quedó pendiente de Posnet sin intent asociado. Cancelá e iniciá de nuevo, o contactá soporte.',
        },
        { status: 400 },
      );
    }
    if (comprobanteTienePagoMpPoint(comp) && !comprobanteEsVentaMpPointCompleta(comp)) {
      const row = comp as unknown as { caja_uuid?: string | null; numero_caja?: number | null };
      const linea = await lineaCajaTicketDesdeCajaUuid(session.supabase, row.caja_uuid ?? null);
      const nc = row.numero_caja;
      const numeroCaja = nc != null && Number.isFinite(Number(nc)) ? Number(nc) : null;
      const est = String(comp.estado ?? '');
      let mensaje: string;
      if (est === 'pendiente_arca') {
        mensaje =
          'El cobro con Posnet quedó registrado. Falta la autorización fiscal (CAE). Podés reintentar desde Facturación o esperar unos segundos y volver a consultar.';
      } else if (est === 'error_arca') {
        const u = (comp as { ultimo_error_arca_mensaje?: string | null }).ultimo_error_arca_mensaje?.trim();
        mensaje = u
          ? `El cobro con Posnet quedó registrado pero la autorización fiscal falló: ${u}`
          : 'El cobro con Posnet quedó registrado pero la autorización fiscal falló. Revisá Facturación / bandeja ARCA o reintentá la emisión.';
      } else if (est === 'emitido') {
        mensaje =
          'El cobro quedó registrado; el comprobante fiscal aún no cumple los requisitos de cierre (verificá CAE y datos). Consultá en Facturación.';
      } else {
        mensaje =
          'El cobro con Posnet quedó registrado; el comprobante sigue en proceso. Reconsultá en unos segundos o abrí el detalle en Facturación.';
      }
      return NextResponse.json({
        estado_mp: 'FINISHED' as const,
        estado_nexus: comp.estado,
        payment_type: null,
        mp_cobro_completo: false,
        pago_mp_registrado: true,
        proceso_posnet_ejecutado: false,
        mensaje,
        numero: comp.numero,
        cae: comp.cae ?? null,
        pdf_url: (comp as { pdf_url?: string | null }).pdf_url ?? null,
        ...(numeroCaja != null ? { numero_caja: numeroCaja } : {}),
        ...(linea ? { linea_caja_ticket: linea } : {}),
      });
    }
    return NextResponse.json(
      { error: 'No hay cobro pendiente para este comprobante' },
      { status: 400 },
    );
  }

  const { data: cfg, error: cfgErr } = await loadMpPointConfig(
    session.supabase,
    session.tenantId,
    comp.sucursal_id,
  );
  if (cfgErr || !cfg?.access_token || !cfg.device_id) {
    return NextResponse.json({ error: 'Configuración de MP Point incompleta' }, { status: 400 });
  }

  const tokenPlain = decryptAccessToken(cfg.access_token);
  if (!tokenPlain) {
    return NextResponse.json({ error: 'Configuración de MP Point incompleta' }, { status: 400 });
  }

  try {
    const client = getMpPointClient(tokenPlain);
    const intent = await client.getPaymentIntent(cfg.device_id, comp.mp_point_intent_id);
    const paymentType = intent.payment?.type;
    let procesoPosnetEjecutado = false;

    if (
      comp.estado === 'pendiente_posnet' &&
      comp.mp_point_payment_id == null &&
      intentPointFinalizoConPagoId(intent)
    ) {
      if (getSupabaseServiceRoleKey()) {
        auditLogPosnet('sincronizar_manual_dispara_procesar', {
          comprobante_id: comprobanteId,
          intent_id: comp.mp_point_intent_id,
        });
        await procesarNotificacionMpPointIntent(createServiceRoleClient(), {
          intentId: comp.mp_point_intent_id,
        });
        procesoPosnetEjecutado = true;
      } else {
        auditLogPosnet('sincronizar_sin_service_role', { comprobante_id: comprobanteId });
      }
    }

    const { data: compPost } = await session.supabase
      .from('comprobante')
      .select(SEL)
      .eq('id', comprobanteId)
      .maybeSingle();

    const finalRow = compPost ?? comp;

    if (finalRow && comprobanteEsVentaMpPointCompleta(finalRow)) {
      const row = finalRow as unknown as { caja_uuid?: string | null; numero_caja?: number | null };
      const linea = await lineaCajaTicketDesdeCajaUuid(session.supabase, row.caja_uuid ?? null);
      const nc = row.numero_caja;
      const numeroCaja = nc != null && Number.isFinite(Number(nc)) ? Number(nc) : null;
      return NextResponse.json({
        estado_mp: 'FINISHED' as const,
        estado_nexus: 'emitido' as const,
        payment_type: null,
        mp_cobro_completo: true,
        proceso_posnet_ejecutado: procesoPosnetEjecutado,
        numero: finalRow.numero,
        pdf_url: (finalRow as { pdf_url?: string | null }).pdf_url ?? null,
        ...(numeroCaja != null ? { numero_caja: numeroCaja } : {}),
        ...(linea ? { linea_caja_ticket: linea } : {}),
      });
    }

    return NextResponse.json({
      estado_mp: intent.state,
      estado_nexus: finalRow.estado ?? comp.estado,
      payment_type: paymentType ?? null,
      proceso_posnet_ejecutado: procesoPosnetEjecutado,
    });
  } catch (e) {
    if (e instanceof MpPointError) {
      return NextResponse.json(
        { error: e.message, mp_error_code: e.code },
        { status: e.status >= 500 ? 503 : 400 },
      );
    }
    console.error('[POST /api/pagos/mp-point/sincronizar]', e);
    return NextResponse.json({ error: 'Error al sincronizar con Mercado Pago' }, { status: 503 });
  }
}
