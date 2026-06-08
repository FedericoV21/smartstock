import { NextResponse } from 'next/server';

import { lineaCajaTicketDesdeCajaUuid } from '@/lib/caja/linea-caja-etiqueta';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { auditLogPosnet } from '@/lib/mp-point/audit-log';
import { getMpQrClient, MpQrError } from '@/lib/mp-qr/client';
import { decryptMpQrAccessToken, loadMpQrConfig } from '@/lib/mp-qr/load-config';
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
import { getSupabaseServiceRoleKey } from '@/lib/supabase/env-keys';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { moduloGuard } from '@/lib/modulos/guard';
import type { SupabaseClient } from '@supabase/supabase-js';

type CompTicketExtras = { caja_uuid?: string | null; numero_caja?: number | null };

async function extrasLineaCajaTicket(
  supabase: SupabaseClient,
  row: CompTicketExtras | null | undefined,
) {
  if (!row) return {};
  const linea = await lineaCajaTicketDesdeCajaUuid(supabase, row.caja_uuid ?? null);
  const nc = row.numero_caja;
  const numeroCaja = nc != null && Number.isFinite(Number(nc)) ? Number(nc) : null;
  return {
    ...(numeroCaja != null ? { numero_caja: numeroCaja } : {}),
    ...(linea ? { linea_caja_ticket: linea } : {}),
  };
}

export const maxDuration = 60;

const ultimaSyncPorComprobante = new Map<string, number>();
const RATE_MS = 5000;

const SEL =
  'id, tenant_id, sucursal_id, tipo, estado, cae, mp_qr_order_id, total, mp_qr_payment_id, numero, numero_caja, caja_uuid, pdf_url, ultimo_error_arca_mensaje, ultimo_error_arca_codigo';

/**
 * Acción explícita del usuario ("Consultar estado" en POS QR).
 * Si el pago figura aprobado en MP y el webhook no corrió, dispara `procesarNotificacionMpQrMerchantOrder`.
 * `GET /api/pagos/mp-qr/estado` queda sólo lectura.
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
    return NextResponse.json({ error: 'comprobante_id es obligatorio' }, { status: 400 });
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

  const { data: comp, error: compErr } = await session.supabase
    .from('comprobante')
    .select(SEL)
    .eq('id', comprobanteId)
    .maybeSingle();

  if (compErr || !comp || comp.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (comprobanteEsVentaMpQrCompleta(comp)) {
    const ticketExtras = await extrasLineaCajaTicket(session.supabase, comp);
    return NextResponse.json({
      estado: comp.estado,
      estado_nexus: comp.estado,
      mp_cobro_completo: true,
      proceso_qr_ejecutado: false,
      numero: comp.numero,
      pdf_url: comp.pdf_url,
      mp_qr_payment_id: comp.mp_qr_payment_id,
      payment: comp.mp_qr_payment_id != null ? { id: comp.mp_qr_payment_id } : undefined,
      ...ticketExtras,
    });
  }

  if (comp.estado !== 'pendiente_qr') {
    if (comprobanteTienePagoMpQr(comp) && !comprobanteEsVentaMpQrCompleta(comp)) {
      const ticketExtras = await extrasLineaCajaTicket(session.supabase, comp);
      const est = String(comp.estado ?? '');
      let mensaje: string;
      if (est === 'pendiente_arca') {
        mensaje =
          'El cobro con QR quedó registrado. Falta la autorización fiscal (CAE). Podés reintentar desde Facturación o esperar unos segundos y volver a consultar.';
      } else if (est === 'error_arca') {
        const u = (comp as { ultimo_error_arca_mensaje?: string | null }).ultimo_error_arca_mensaje?.trim();
        mensaje = u
          ? `El cobro con QR quedó registrado pero la autorización fiscal falló: ${u}`
          : 'El cobro con QR quedó registrado pero la autorización fiscal falló. Revisá Facturación / bandeja ARCA o reintentá la emisión.';
      } else if (est === 'emitido') {
        mensaje =
          'El cobro quedó registrado; el comprobante fiscal aún no cumple los requisitos de cierre (verificá CAE y datos). Consultá en Facturación.';
      } else {
        mensaje =
          'El cobro con QR quedó registrado; el comprobante sigue en proceso. Reconsultá en unos segundos o abrí el detalle en Facturación.';
      }
      return NextResponse.json({
        estado: comp.estado,
        estado_nexus: comp.estado,
        mp_cobro_completo: false,
        pago_mp_registrado: true,
        proceso_qr_ejecutado: false,
        mensaje,
        numero: comp.numero,
        pdf_url: comp.pdf_url,
        cae: comp.cae ?? null,
        mp_qr_payment_id: comp.mp_qr_payment_id,
        ...ticketExtras,
      });
    }
    const ticketExtras = await extrasLineaCajaTicket(session.supabase, comp);
    return NextResponse.json({
      error: 'No hay cobro QR pendiente de sincronizar para este comprobante',
      estado: comp.estado,
      estado_nexus: comp.estado,
      proceso_qr_ejecutado: false,
      ...ticketExtras,
    }, { status: 400 });
  }

  const { data: cfg, error: cfgErr } = await loadMpQrConfig(
    session.supabase,
    session.tenantId,
    comp.sucursal_id,
  );
  if (cfgErr) {
    return NextResponse.json({ error: cfgErr }, { status: 500 });
  }
  if (!cfg?.access_token || !cfg.user_id?.trim() || !cfg.external_pos_id?.trim()) {
    return NextResponse.json({ error: 'Configuración de MP QR incompleta' }, { status: 400 });
  }

  const token = decryptMpQrAccessToken(cfg.access_token);
  if (!token) {
    return NextResponse.json({ error: 'Configuración de MP QR incompleta' }, { status: 400 });
  }

  const userId = cfg.user_id.trim();
  const resolvedPos = await resolveMpQrPos({
    access_token: token,
    user_id: userId,
    external_pos_id: cfg.external_pos_id.trim(),
  }).catch(() => ({
    external_pos_id: cfg.external_pos_id!.trim(),
    external_store_id: null,
    resolved_from_internal_id: false,
  }));
  const client = getMpQrClient(token, userId);
  const posId = resolvedPos.external_pos_id;
  const externalStoreId = resolvedPos.external_store_id;
  let procesoQrEjecutado = false;

  try {
    const ordenActiva = await client.getOrder(posId, { externalStoreId });
    return NextResponse.json({
      estado: 'pendiente_qr',
      estado_nexus: 'pendiente_qr',
      proceso_qr_ejecutado: false,
      numero: comp.numero,
      pdf_url: comp.pdf_url,
      orden_activa: ordenActiva,
    });
  } catch (e) {
    const merchantOrderIdFallback = comp.mp_qr_order_id;
    const puedeFallbackMerchantOrder =
      merchantOrderIdFallback != null &&
      e instanceof MpQrError &&
      // MP puede responder 404 (sin orden activa) o 405/otros HTML transitorios en getOrder.
      // En esos casos intentamos igualmente por merchant_order para no trabar el cierre.
      (e.status === 403 || e.status === 404 || e.status === 405 || e.status === 429 || e.status >= 500);
    if (puedeFallbackMerchantOrder && merchantOrderIdFallback != null) {
      const oid = merchantOrderIdFallback;
      try {
        const mo = await client.getMerchantOrder(oid);
        const payments = mo.payments ?? [];
        const totalOrden = Number(mo.total_amount ?? 0);
        const hayAprobado = payments.some(
          (p) =>
            p.status === 'approved' &&
            (Number(p.transaction_amount) || 0) + 0.015 >= totalOrden - 0.015,
        );
        if (hayAprobado && getSupabaseServiceRoleKey()) {
          auditLogPosnet('sincronizar_qr_manual_procesar', {
            comprobante_id: comprobanteId,
            merchant_order_id: oid,
          });
          try {
            await procesarNotificacionMpQrMerchantOrder(createServiceRoleClient(), {
              merchantOrderId: oid,
              tenantId: session.tenantId,
              sucursalId: comp.sucursal_id,
            });
            procesoQrEjecutado = true;
          } catch (err) {
            console.error('[POST /api/pagos/mp-qr/sincronizar] procesar', err);
          }
        }

        const { data: comp2 } = await session.supabase
          .from('comprobante')
          .select(SEL)
          .eq('id', comprobanteId)
          .maybeSingle();

        const row = comp2 ?? comp;
        if (row && comprobanteEsVentaMpQrCompleta(row)) {
          const ticketExtras2 = await extrasLineaCajaTicket(session.supabase, row);
          return NextResponse.json({
            estado: row.estado,
            estado_nexus: row.estado,
            mp_cobro_completo: true,
            proceso_qr_ejecutado: procesoQrEjecutado,
            numero: row.numero,
            pdf_url: row.pdf_url,
            mp_qr_payment_id: row.mp_qr_payment_id,
            payment: row.mp_qr_payment_id != null ? { id: row.mp_qr_payment_id } : undefined,
            ...ticketExtras2,
          });
        }

        const ticketExtras2 = await extrasLineaCajaTicket(session.supabase, row);
        const cAny = row as {
          ultimo_error_arca_mensaje?: string | null;
          ultimo_error_arca_codigo?: string | null;
        };
        return NextResponse.json({
          estado: row.estado,
          estado_nexus: row.estado,
          proceso_qr_ejecutado: procesoQrEjecutado,
          numero: row.numero,
          pdf_url: row.pdf_url,
          mp_qr_payment_id: row.mp_qr_payment_id ?? null,
          ultimo_error_arca_mensaje: cAny.ultimo_error_arca_mensaje ?? null,
          ultimo_error_arca_codigo: cAny.ultimo_error_arca_codigo ?? null,
          payment:
            row.mp_qr_payment_id != null ? { id: row.mp_qr_payment_id } : undefined,
          merchant_order: mo,
          ...ticketExtras2,
        });
      } catch (e2) {
        if (e2 instanceof MpQrError) {
          return NextResponse.json({ error: e2.message }, { status: 503 });
        }
        throw e2;
      }
    }
    if (mpQrErrorEsConsultaOrdenNoDisponible(e)) {
      const ticketExtras = await extrasLineaCajaTicket(session.supabase, comp);
      return NextResponse.json(
        respuestaSincronizarEsperandoQr({
          numero: comp.numero,
          pdf_url: comp.pdf_url,
          ...ticketExtras,
        }),
      );
    }
    if (e instanceof MpQrError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    console.error('[POST /api/pagos/mp-qr/sincronizar]', e);
    return NextResponse.json({ error: 'Error al sincronizar con Mercado Pago' }, { status: 503 });
  }
}
