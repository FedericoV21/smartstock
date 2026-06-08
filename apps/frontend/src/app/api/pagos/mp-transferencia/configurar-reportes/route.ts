import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { getMpTransferenciaClient, MpTransferenciaClientError } from '@/lib/mp-transferencia/client';
import { loadMpTransferenciaAccessToken } from '@/lib/mp-transferencia/service';
import { moduloGuard } from '@/lib/modulos/guard';

const COLUMNAS_TRANSFERENCIA_MP = [
  'SOURCE_ID',
  'TRANSACTION_DATE',
  'SETTLEMENT_DATE',
  'TRANSACTION_AMOUNT',
  'SETTLEMENT_NET_AMOUNT',
  'TRANSACTION_CURRENCY',
  'SETTLEMENT_CURRENCY',
  'TRANSACTION_TYPE',
  'PAYMENT_METHOD',
  'PAYMENT_METHOD_TYPE',
  'DESCRIPTION',
  'PAYER_NAME',
  'PAYER_ID_NUMBER',
  'PAY_BANK_TRANSFER_ID',
  'PURCHASE_ID',
  'ORDER_MP',
  'TRANSACTION_INTENT_ID',
] as const;

function payloadConfigReportesMp() {
  return {
    file_name_prefix: 'smartstock-transferencias-mp',
    columns: COLUMNAS_TRANSFERENCIA_MP.map((key) => ({ key })),
    frequency: {
      type: 'monthly' as const,
      value: 1,
      hour: 0,
    },
    separator: ',',
    display_timezone: 'GMT-03',
    report_translation: 'en',
    header_language: 'en',
    scheduled: false,
    include_withdraw: false,
    refund_detailed: false,
    shipping_detail: false,
    coupon_detailed: false,
    show_chargeback_cancel: false,
    show_fee_prevision: false,
  };
}

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const body = (await request.json().catch(() => ({}))) as {
    sucursal_id?: string;
    actualizar?: boolean;
  };

  const scope = await resolveAndValidateSucursalScope(session, body.sucursal_id?.trim() || null);
  if (!scope.ok) return scope.response;
  if (!scope.sucursalId) {
    return NextResponse.json({ ok: false, error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const token = await loadMpTransferenciaAccessToken(session.supabase, {
    tenantId: session.tenantId,
    sucursalId: scope.sucursalId,
  });
  if (!token.ok) {
    return NextResponse.json({ ok: false, error: token.error }, { status: token.status });
  }

  const client = getMpTransferenciaClient(token.token);
  const payload = payloadConfigReportesMp();

  try {
    let existeConfig = false;
    try {
      await client.getConfig();
      existeConfig = true;
    } catch (e) {
      if (!(e instanceof MpTransferenciaClientError) || e.status !== 404) throw e;
    }

    const raw = existeConfig
      ? body.actualizar === true
        ? await client.updateConfig(payload)
        : null
      : await client.createConfig(payload);

    return NextResponse.json({
      ok: true,
      accion: existeConfig ? (body.actualizar === true ? 'actualizada' : 'ya_existia') : 'creada',
      mensaje:
        existeConfig && body.actualizar !== true
          ? 'La configuracion de reportes MP ya existia. No se modifico.'
          : 'Configuracion de reportes MP lista para Transferencia MP.',
      columnas: COLUMNAS_TRANSFERENCIA_MP,
      raw_response: raw,
    });
  } catch (e) {
    if (e instanceof MpTransferenciaClientError) {
      console.error('[mp-transferencia configurar-reportes]', {
        tenant_id: session.tenantId,
        sucursal_id: scope.sucursalId,
        mp_status: e.status,
        mp_message: e.message,
        mp_details: e.details ?? null,
      });
      return NextResponse.json(
        {
          ok: false,
          error: e.message,
          mp_status: e.status,
          mp_details: e.details ?? null,
        },
        { status: e.status === 401 || e.status === 403 ? 400 : e.status >= 500 ? 503 : 400 },
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[mp-transferencia configurar-reportes]', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
}
