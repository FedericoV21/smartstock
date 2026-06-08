import { NextResponse } from 'next/server';

import { lineaCajaTicketDesdeCajaUuid } from '@/lib/caja/linea-caja-etiqueta';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { getMpPointClient, MpPointError } from '@/lib/mp-point/client';
import { decryptAccessToken, loadMpPointConfig } from '@/lib/mp-point/load-config';
import {
  comprobanteEsVentaMpPointCompleta,
  comprobanteTienePagoMpPoint,
} from '@/lib/mp-point/venta-mp-completa';
import { moduloGuard } from '@/lib/modulos/guard';

const ultimaConsultaPorComprobante = new Map<string, number>();
const RATE_MS = 5000;

/**
 * Solo lectura: estado del intent Point y del comprobante.
 * Para aplicar cobro/emisión cuando el webhook tardó o falló, usar `POST /api/pagos/mp-point/sincronizar`.
 */
export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const url = new URL(request.url);
  const comprobanteId = url.searchParams.get('comprobante_id')?.trim();
  if (!comprobanteId) {
    return NextResponse.json({ error: 'comprobante_id requerido' }, { status: 400 });
  }

  const now = Date.now();
  const prev = ultimaConsultaPorComprobante.get(comprobanteId) ?? 0;
  if (now - prev < RATE_MS) {
    return NextResponse.json(
      { error: 'Esperá unos segundos antes de volver a consultar' },
      { status: 429 },
    );
  }
  ultimaConsultaPorComprobante.set(comprobanteId, now);

  const { data: comp, error: cErr } = await session.supabase
    .from('comprobante')
    .select(
      'id, tenant_id, sucursal_id, tipo, estado, cae, mp_point_intent_id, mp_point_payment_id, metodo_pago, numero, numero_caja, caja_uuid, pdf_url, ultimo_error_arca_mensaje',
    )
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
      /** Ya no hay intent en fila: venta MP registrada. */
      mp_cobro_completo: true,
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
    /**
     * Tras `emitirComprobante` el intent se limpia pero la venta MP puede seguir
     * incompleta (p. ej. `pendiente_arca` o fiscal sin CAE). Antes devolvíamos 400
     * «No hay cobro pendiente», que confundía con el Posnet ya aprobado.
     */
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

  const { data: cfg, error: cfgErr } = await loadMpPointConfig(session.supabase, session.tenantId, comp.sucursal_id);
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

    return NextResponse.json({
      estado_mp: intent.state,
      estado_nexus: comp.estado,
      payment_type: paymentType,
    });
  } catch (e) {
    if (e instanceof MpPointError) {
      return NextResponse.json(
        { error: e.message, mp_error_code: e.code },
        { status: e.status >= 500 ? 503 : 400 },
      );
    }
    console.error('[GET /api/pagos/mp-point/estado]', e);
    return NextResponse.json({ error: 'Error al consultar Mercado Pago' }, { status: 503 });
  }
}
