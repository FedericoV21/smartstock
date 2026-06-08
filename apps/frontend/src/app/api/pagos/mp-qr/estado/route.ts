import { NextResponse } from 'next/server';

import { lineaCajaTicketDesdeCajaUuid } from '@/lib/caja/linea-caja-etiqueta';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { getMpQrClient, MpQrError } from '@/lib/mp-qr/client';
import { decryptMpQrAccessToken, loadMpQrConfig } from '@/lib/mp-qr/load-config';
import { resolveMpQrExternalPosId } from '@/lib/mp-qr/verificar-configuracion';
import { moduloGuard } from '@/lib/modulos/guard';
import type { SupabaseClient } from '@supabase/supabase-js';

type CompTicketExtras = { caja_uuid?: string | null; numero_caja?: number | null };

/**
 * Solo lectura: orden Point/QR y estado del comprobante.
 * Para recuperar cobro si el webhook falló: `POST /api/pagos/mp-qr/sincronizar`.
 */

async function extrasLineaCajaTicket(supabase: SupabaseClient, row: CompTicketExtras | null | undefined) {
  if (!row) return {};
  const linea = await lineaCajaTicketDesdeCajaUuid(supabase, row.caja_uuid ?? null);
  const nc = row.numero_caja;
  const numeroCaja = nc != null && Number.isFinite(Number(nc)) ? Number(nc) : null;
  return {
    ...(numeroCaja != null ? { numero_caja: numeroCaja } : {}),
    ...(linea ? { linea_caja_ticket: linea } : {}),
  };
}

export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const comprobanteId = new URL(request.url).searchParams.get('comprobante_id')?.trim();
  if (!comprobanteId) {
    return NextResponse.json({ error: 'comprobante_id es obligatorio' }, { status: 400 });
  }

  const { data: comp, error: compErr } = await session.supabase
    .from('comprobante')
    .select(
      'id, tenant_id, sucursal_id, tipo, estado, cae, mp_qr_order_id, total, mp_qr_payment_id, numero, numero_caja, caja_uuid, pdf_url, ultimo_error_arca_mensaje, ultimo_error_arca_codigo',
    )
    .eq('id', comprobanteId)
    .maybeSingle();

  if (compErr || !comp || comp.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Comprobante no encontrado' }, { status: 404 });
  }

  if (comp.estado !== 'pendiente_qr') {
    const ticketExtras = await extrasLineaCajaTicket(session.supabase, comp);
    const cAny = comp as {
      ultimo_error_arca_mensaje?: string | null;
      ultimo_error_arca_codigo?: string | null;
    };
    return NextResponse.json({
      estado: comp.estado,
      estado_nexus: comp.estado,
      tipo: comp.tipo,
      cae: comp.cae ?? null,
      numero: comp.numero,
      pdf_url: comp.pdf_url,
      mp_qr_payment_id: comp.mp_qr_payment_id,
      ultimo_error_arca_mensaje: cAny.ultimo_error_arca_mensaje ?? null,
      ultimo_error_arca_codigo: cAny.ultimo_error_arca_codigo ?? null,
      payment: comp.mp_qr_payment_id != null ? { id: comp.mp_qr_payment_id } : undefined,
      ...ticketExtras,
    });
  }

  const { data: cfg, error: cfgErr } = await loadMpQrConfig(session.supabase, session.tenantId, comp.sucursal_id);
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
  const resolvedPos = await resolveMpQrExternalPosId({
    access_token: token,
    user_id: userId,
    external_pos_id: cfg.external_pos_id.trim(),
  }).catch(() => ({ external_pos_id: cfg.external_pos_id!.trim(), resolved_from_internal_id: false }));
  const client = getMpQrClient(token, userId);
  const posId = resolvedPos.external_pos_id;

  try {
    const ordenActiva = await client.getOrder(posId);
    return NextResponse.json({
      estado: 'pendiente_qr',
      estado_nexus: 'pendiente_qr',
      numero: comp.numero,
      pdf_url: comp.pdf_url,
      orden_activa: ordenActiva,
    });
  } catch (e) {
    if (e instanceof MpQrError && e.status === 404) {
      if (comp.mp_qr_order_id) {
        try {
          const mo = await client.getMerchantOrder(comp.mp_qr_order_id);

          const { data: comp2 } = await session.supabase
            .from('comprobante')
            .select(
              'tipo, estado, cae, mp_qr_payment_id, numero, numero_caja, caja_uuid, pdf_url, ultimo_error_arca_mensaje, ultimo_error_arca_codigo',
            )
            .eq('id', comprobanteId)
            .maybeSingle();

          const ticketExtras2 = await extrasLineaCajaTicket(session.supabase, comp2 ?? comp);

          const comp2Any = comp2 as
            | ({
                ultimo_error_arca_mensaje?: string | null;
                ultimo_error_arca_codigo?: string | null;
              } & typeof comp2)
            | null
            | undefined;
          return NextResponse.json({
            estado: comp2?.estado ?? comp.estado,
            estado_nexus: comp2?.estado ?? comp.estado,
            tipo: comp2?.tipo ?? comp.tipo,
            cae: comp2?.cae ?? comp.cae ?? null,
            numero: comp2?.numero ?? comp.numero,
            pdf_url: comp2?.pdf_url ?? comp.pdf_url,
            mp_qr_payment_id: comp2?.mp_qr_payment_id ?? comp.mp_qr_payment_id ?? null,
            ultimo_error_arca_mensaje: comp2Any?.ultimo_error_arca_mensaje ?? null,
            ultimo_error_arca_codigo: comp2Any?.ultimo_error_arca_codigo ?? null,
            payment:
              comp2?.mp_qr_payment_id != null
                ? { id: comp2.mp_qr_payment_id }
                : comp.mp_qr_payment_id != null
                  ? { id: comp.mp_qr_payment_id }
                  : undefined,
            merchant_order: mo,
            ...ticketExtras2,
          });
        } catch (e2) {
          if (e2 instanceof MpQrError) {
            return NextResponse.json({ error: e2.message }, { status: 503 });
          }
        }
      }
      const ticketExtrasFallback = await extrasLineaCajaTicket(session.supabase, comp);
      return NextResponse.json({
        estado: comp.estado,
        estado_nexus: comp.estado,
        tipo: comp.tipo,
        cae: comp.cae ?? null,
        numero: comp.numero,
        pdf_url: comp.pdf_url,
        merchant_order: null,
        ...ticketExtrasFallback,
      });
    }
    if (e instanceof MpQrError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    return NextResponse.json({ error: 'Error al consultar MP' }, { status: 503 });
  }
}
