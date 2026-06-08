import type { SupabaseClient } from '@supabase/supabase-js';

import { emitirComprobante } from '@/lib/facturacion/emitir-comprobante';
import { emitirBodyDesdeBorrador } from '@/lib/mp-point/borrador-body';
import { tipoComprobanteRequiereCaeAfip } from '@/lib/mp-point/tipo-requiere-cae';
import { reintentarCaeAutomaticoServidor } from '@/lib/facturacion/reintentar-cae-automatico';
import { broadcastMpQrEvent } from '@/lib/mp-qr/broadcast';
import { getMpQrClient } from '@/lib/mp-qr/client';
import { decryptMpQrAccessToken, loadMpQrConfig } from '@/lib/mp-qr/load-config';
import {
  buscarMerchantOrderIdPorExternalReference,
  fetchMercadoPagoPaymentV1Detalle,
  pagoV1AunProcesandose,
  pagoV1FueRechazadoOAnulado,
  pagoV1PermiteEmitirComprobante,
} from '@/lib/mp-qr/payment-v1';
import { getPasarelaSecret, stringFromUnknown } from '@/lib/pasarelas/secrets';
import { actualizarTransaccionPasarelaPorComprobante } from '@/lib/pasarelas/transacciones';
import type { Database } from '@/types/database';
import type { MpQrMerchantOrderPayment } from '@/types/mp-qr';

const ORPHAN_CANCEL_MS = 30_000;
const AMOUNT_EPS = 0.015;

type MpQrRuntime = {
  accessToken: string;
  userId: string;
  externalPosId: string;
  externalStoreId?: string | null;
};

async function loadMpQrRuntime(
  admin: SupabaseClient<Database>,
  params: { tenantId: string; sucursalId?: string | null; integracionId?: string | null },
): Promise<MpQrRuntime | null> {
  if (params.integracionId) {
    try {
      const { data: integracion } = await (admin as any)
        .from('pasarela_integracion')
        .select('*')
        .eq('id', params.integracionId)
        .eq('tenant_id', params.tenantId)
        .maybeSingle();
      const accessToken = integracion ? getPasarelaSecret(integracion, 'access_token') : null;
      const userId = integracion ? stringFromUnknown(integracion.config_publica?.user_id) : null;
      const externalPosId = integracion ? stringFromUnknown(integracion.config_publica?.external_pos_id) : null;
      const externalStoreId = integracion
        ? stringFromUnknown(integracion.config_publica?.external_store_id)
        : null;
      if (accessToken && userId && externalPosId) {
        return { accessToken, userId, externalPosId, externalStoreId };
      }
    } catch {
      /* fallback legacy */
    }
  }

  const { data: cfg, error: cfgErr } = await loadMpQrConfig(admin, params.tenantId, params.sucursalId);
  if (cfgErr || !cfg?.access_token) {
    console.error('[mp-qr webhook] sin config', params.tenantId, cfgErr);
    return null;
  }
  const token = decryptMpQrAccessToken(cfg.access_token);
  if (!token || !cfg.user_id?.trim() || !cfg.external_pos_id?.trim()) {
    console.error('[mp-qr webhook] credenciales incompletas', params.tenantId);
    return null;
  }
  return {
    accessToken: token,
    userId: cfg.user_id.trim(),
    externalPosId: cfg.external_pos_id.trim(),
    externalStoreId: null,
  };
}

async function cargarInStoreOrderIdDesdeTransaccion(
  admin: SupabaseClient<Database>,
  params: { tenantId: string; comprobanteId: string; integracionId?: string | null },
): Promise<string | null> {
  try {
    let q = (admin as any)
      .from('pasarela_transaccion')
      .select('external_order_id')
      .eq('tenant_id', params.tenantId)
      .eq('comprobante_id', params.comprobanteId)
      .eq('canal', 'qr')
      .order('created_at', { ascending: false })
      .limit(1);
    if (params.integracionId) q = q.eq('integracion_id', params.integracionId);
    const { data, error } = await q.maybeSingle();
    if (error) return null;
    return stringFromUnknown(data?.external_order_id);
  } catch {
    return null;
  }
}

async function comprobanteYaSalioDeQrPendiente(
  admin: SupabaseClient<Database>,
  params: { tenantId: string; comprobanteId: string },
): Promise<boolean> {
  const { data } = await admin
    .from('comprobante')
    .select('estado, mp_qr_payment_id')
    .eq('id', params.comprobanteId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle();
  if (!data) return false;
  if (data.estado !== 'pendiente_qr') return true;
  return data.mp_qr_payment_id != null && Number(data.mp_qr_payment_id) > 0;
}

function montoAprobadoSuficiente(
  payments: MpQrMerchantOrderPayment[],
  totalOrden: number,
): { ok: boolean; paymentId: number; paymentType?: string } {
  for (const p of payments) {
    if (p.status === 'approved' && p.transaction_amount + AMOUNT_EPS >= totalOrden - AMOUNT_EPS) {
      return {
        ok: true,
        paymentId: p.id > 0 ? p.id : 0,
        paymentType: [p.payment_type_id, p.payment_method_id].filter(Boolean).join(' · ') || undefined,
      };
    }
  }
  return { ok: false, paymentId: 0 };
}

function todosPagosRechazadosOCancelados(payments: MpQrMerchantOrderPayment[]): boolean {
  if (!payments.length) return false;
  return payments.every((p) => p.status === 'rejected' || p.status === 'cancelled');
}

function hayPendiente(payments: MpQrMerchantOrderPayment[]): boolean {
  return payments.some((p) => p.status === 'pending');
}

export async function procesarNotificacionMpQrMerchantOrder(
  admin: SupabaseClient<Database>,
  params: { merchantOrderId: string | number; tenantId: string; sucursalId?: string | null; integracionId?: string | null },
): Promise<void> {
  const { tenantId, merchantOrderId, sucursalId } = params;

  const runtime = await loadMpQrRuntime(admin, params);
  if (!runtime) return;

  const client = getMpQrClient(runtime.accessToken, runtime.userId);
  let mo: Awaited<ReturnType<typeof client.getMerchantOrder>>;
  try {
    mo = await client.getMerchantOrder(merchantOrderId);
  } catch (e) {
    console.error('[mp-qr webhook] getMerchantOrder', e);
    return;
  }

  const extRef = mo.external_reference?.trim();
  if (!extRef) {
    console.warn('[mp-qr webhook] merchant_order sin external_reference', merchantOrderId);
    return;
  }

  const { data: comp, error: qErr } = await admin
    .from('comprobante')
    .select(
      'id, tenant_id, estado, numero, mp_qr_payment_id, mp_qr_cancelado_at, usuario_id, mp_qr_pago_huerfano',
    )
    .eq('id', extRef)
    .maybeSingle();

  if (qErr || !comp || comp.tenant_id !== tenantId) {
    console.warn('[mp-qr webhook] comprobante no encontrado', extRef, qErr?.message);
    return;
  }
  const compOk = comp;

  const orderIdStr = String(mo.id);

  async function marcarPasarela(
    estado: Parameters<typeof actualizarTransaccionPasarelaPorComprobante>[1]['estado'],
    extra?: {
      externalPaymentId?: string | number | null;
      ultimoError?: string | null;
      responsePayload?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await actualizarTransaccionPasarelaPorComprobante(admin, {
      tenantId,
      comprobanteId: compOk.id,
      proveedor: 'mercado_pago',
      canal: 'qr',
      estado,
      externalOrderId: orderIdStr,
      externalPaymentId: extra?.externalPaymentId ?? null,
      ultimoError: extra?.ultimoError ?? null,
      responsePayload: extra?.responsePayload,
    });
  }

  if (comp.estado === 'emitido' && comp.numero != null) {
    return;
  }

  if (comp.mp_qr_payment_id != null && comp.estado === 'emitido') {
    return;
  }

  if (mo.status === 'expired' && comp.estado === 'pendiente_qr') {
    await admin
      .from('comprobante')
      .update({
        estado: 'borrador' as never,
        mp_qr_order_id: null,
      })
      .eq('id', comp.id)
      .eq('tenant_id', tenantId);
    await marcarPasarela('expirada', {
      responsePayload: { merchant_order_status: mo.status },
    });
    try {
      await broadcastMpQrEvent(comp.id, { estado: 'cancelado', payment_type: 'qr' });
    } catch {
      /* noop */
    }
    return;
  }

  if (comp.estado === 'pendiente_qr') {
    await admin
      .from('comprobante')
      .update({ mp_qr_order_id: orderIdStr })
      .eq('id', comp.id)
      .eq('tenant_id', tenantId);
  }

  const payments = mo.payments ?? [];
  const totalOrden = Number(mo.total_amount ?? 0);
  const aprobado = montoAprobadoSuficiente(payments, totalOrden);

  if (aprobado.ok && aprobado.paymentId > 0) {
    const cancelAt = comp.mp_qr_cancelado_at ? new Date(comp.mp_qr_cancelado_at).getTime() : 0;
    const recienteCancel =
      comp.estado === 'borrador' &&
      cancelAt > 0 &&
      Date.now() - cancelAt < ORPHAN_CANCEL_MS;

    if (recienteCancel) {
      await admin
        .from('comprobante')
        .update({
          mp_qr_pago_huerfano: true,
          mp_qr_payment_id: aprobado.paymentId,
          mp_qr_order_id: orderIdStr,
        })
        .eq('id', comp.id)
        .eq('tenant_id', tenantId);
      await marcarPasarela('aprobada', {
        externalPaymentId: aprobado.paymentId,
        ultimoError: 'Pago aprobado despues de cancelar el cobro en POS',
        responsePayload: { merchant_order_status: mo.status, huerfano: true },
      });
      try {
        await broadcastMpQrEvent(comp.id, {
          estado: 'pago_huerfano',
          payment_id: aprobado.paymentId,
          payment_type: 'qr',
        });
      } catch {
        /* noop */
      }
      return;
    }

    if (comp.estado !== 'pendiente_qr') {
      return;
    }

    let uid = comp.usuario_id;
    if (!uid) {
      const { data: u } = await admin
        .from('usuario')
        .select('id')
        .eq('tenant_id', comp.tenant_id)
        .limit(1)
        .maybeSingle();
      uid = u?.id ?? null;
    }
    if (!uid) {
      console.error('[mp-qr webhook] sin usuario', comp.tenant_id);
      return;
    }

    const body = await emitirBodyDesdeBorrador(admin, comp.tenant_id, comp.id);
    if (!body) {
      if (await comprobanteYaSalioDeQrPendiente(admin, { tenantId, comprobanteId: comp.id })) {
        return;
      }
      console.error('[mp-qr webhook] no body borrador', comp.id);
      await marcarPasarela('fiscal_error', {
        externalPaymentId: aprobado.paymentId,
        ultimoError: 'No se pudo armar el body desde el borrador',
      });
      return;
    }

    await marcarPasarela('fiscalizando', {
      externalPaymentId: aprobado.paymentId,
      responsePayload: { merchant_order_status: mo.status, payment_type: aprobado.paymentType ?? 'qr' },
    });

    const result = await emitirComprobante(
      admin,
      { tenantId: comp.tenant_id, userId: uid },
      body,
      {
        reemplazarComprobanteBorradorId: comp.id,
        mpQrPaymentId: aprobado.paymentId,
        clienteSinRestriccionSucursal: true,
      },
    );

    if (!result.ok) {
      if (await comprobanteYaSalioDeQrPendiente(admin, { tenantId, comprobanteId: comp.id })) {
        return;
      }
      console.error('[mp-qr webhook] emitir falló', result.error);
      await marcarPasarela('fiscal_error', {
        externalPaymentId: aprobado.paymentId,
        ultimoError: String(result.error),
      });
      try {
        await broadcastMpQrEvent(comp.id, {
          estado: 'error',
          motivo:
            typeof result.error === 'string' && result.error.trim() !== ''
              ? result.error.trim()
              : 'No se pudo emitir el comprobante tras cobrar con QR.',
          payment_type: 'qr',
        });
      } catch {
        /* noop */
      }
      return;
    }

    const emitido = result.data.comprobante;
    const tipoEmitido = String(emitido.tipo ?? '');
    const exigeCae = tipoComprobanteRequiereCaeAfip(tipoEmitido);
    let caeStr = String((emitido as { cae?: string | null }).cae ?? '').trim();
    let fiscalEmitidoOk =
      !exigeCae || (String(emitido.estado ?? '') === 'emitido' && caeStr.length > 0);

    if (!fiscalEmitidoOk && exigeCae) {
      await reintentarCaeAutomaticoServidor(admin, { tenantId: comp.tenant_id }, comp.id);
      const { data: postRow } = await admin
        .from('comprobante')
        .select('estado, cae, ultimo_error_arca_mensaje, ultimo_error_arca_codigo')
        .eq('id', comp.id)
        .maybeSingle();
      caeStr = String(postRow?.cae ?? '').trim();
      fiscalEmitidoOk = String(postRow?.estado ?? '') === 'emitido' && caeStr.length === 14;
      if (postRow) {
        (emitido as { estado?: string }).estado = postRow.estado as never;
        (emitido as { cae?: string | null }).cae = postRow.cae;
        (emitido as { ultimo_error_arca_mensaje?: string | null }).ultimo_error_arca_mensaje =
          postRow.ultimo_error_arca_mensaje;
        (emitido as { ultimo_error_arca_codigo?: string | null }).ultimo_error_arca_codigo =
          postRow.ultimo_error_arca_codigo;
      }
    }

    try {
      const inStoreOrderId = await cargarInStoreOrderIdDesdeTransaccion(admin, {
        tenantId,
        comprobanteId: comp.id,
        integracionId: params.integracionId,
      });
      await client.cancelOrder(runtime.externalPosId, {
        externalStoreId: runtime.externalStoreId,
        orderId: inStoreOrderId,
      });
    } catch (e) {
      console.error('[mp-qr webhook] cancelOrder post-emitir', e);
    }

    try {
      if (!fiscalEmitidoOk && exigeCae) {
        const ultimo =
          (emitido as { ultimo_error_arca_mensaje?: string | null }).ultimo_error_arca_mensaje?.trim() ??
          '';
        const motivo =
          ultimo ||
          (String(emitido.estado) === 'pendiente_arca'
            ? 'El pago se acreditó pero la factura no tiene CAE (AFIP pendiente o sin respuesta).'
            : 'El pago se acreditó pero la factura no quedó autorizada con CAE.');
        await marcarPasarela(
          String(emitido.estado) === 'pendiente_arca' ? 'fiscal_pendiente' : 'fiscal_error',
          {
            externalPaymentId: aprobado.paymentId,
            ultimoError: motivo,
            responsePayload: {
              comprobante_estado: emitido.estado,
              cae: (emitido as { cae?: string | null }).cae ?? null,
            },
          },
        );
        await broadcastMpQrEvent(comp.id, {
          estado: 'error',
          motivo,
          codigo: (emitido as { ultimo_error_arca_codigo?: string | null }).ultimo_error_arca_codigo ?? null,
          payment_type: aprobado.paymentType ?? 'qr',
          payment_id: aprobado.paymentId,
        });
      } else {
        await marcarPasarela('completa', {
          externalPaymentId: aprobado.paymentId,
          responsePayload: {
            comprobante_estado: emitido.estado,
            cae: (emitido as { cae?: string | null }).cae ?? null,
          },
        });
        await broadcastMpQrEvent(comp.id, {
          estado: 'aprobado',
          payment_type: aprobado.paymentType ?? 'qr',
          payment_id: aprobado.paymentId,
        });
      }
    } catch {
      /* noop */
    }
    return;
  }

  if (todosPagosRechazadosOCancelados(payments) && comp.estado === 'pendiente_qr') {
    await admin
      .from('comprobante')
      .update({
        estado: 'borrador' as never,
        mp_qr_order_id: null,
      })
      .eq('id', comp.id)
      .eq('tenant_id', tenantId);
    await marcarPasarela('rechazada', {
      ultimoError: 'Todos los pagos fueron rechazados o cancelados',
      responsePayload: {
        merchant_order_status: mo.status,
        payments: payments.map((p) => ({ id: p.id, status: p.status, status_detail: p.status_detail })),
      },
    });
    try {
      await broadcastMpQrEvent(comp.id, { estado: 'rechazado', payment_type: 'qr' });
    } catch {
      /* noop */
    }
    return;
  }

  if (hayPendiente(payments) && comp.estado === 'pendiente_qr') {
    return;
  }
}

/**
 * MP notifica `type=payment` con `data.id` = payment id (no merchant_order).
 * Resolvemos el merchant_order vía GET /v1/payments/{id} o emitimos por external_reference.
 */
export async function procesarNotificacionMpQrPayment(
  admin: SupabaseClient<Database>,
  params: {
    paymentId: string | number;
    tenantId: string;
    sucursalId?: string | null;
    integracionId?: string | null;
  },
): Promise<void> {
  const runtime = await loadMpQrRuntime(admin, params);
  if (!runtime) return;

  const pay = await fetchMercadoPagoPaymentV1Detalle(runtime.accessToken, params.paymentId);
  if (!pay) {
    console.warn('[mp-qr webhook] payment v1 no disponible', params.paymentId);
    return;
  }

  const payCtx = { id: pay.id, status: pay.status, status_detail: pay.status_detail };

  if (pagoV1AunProcesandose(payCtx)) {
    return;
  }

  if (pay.merchant_order_id) {
    await procesarNotificacionMpQrMerchantOrder(admin, {
      merchantOrderId: pay.merchant_order_id,
      tenantId: params.tenantId,
      sucursalId: params.sucursalId,
      integracionId: params.integracionId,
    });
    return;
  }

  const extRef = pay.external_reference?.trim();
  if (!extRef) {
    console.warn('[mp-qr webhook] payment sin merchant_order ni external_reference', pay.id);
    return;
  }

  const { data: comp } = await admin
    .from('comprobante')
    .select('id, tenant_id, estado, mp_qr_order_id')
    .eq('id', extRef)
    .maybeSingle();

  if (!comp || comp.tenant_id !== params.tenantId) {
    console.warn('[mp-qr webhook] payment external_reference sin comprobante', extRef);
    return;
  }

  if (comp.mp_qr_order_id) {
    await procesarNotificacionMpQrMerchantOrder(admin, {
      merchantOrderId: comp.mp_qr_order_id,
      tenantId: params.tenantId,
      sucursalId: params.sucursalId,
      integracionId: params.integracionId,
    });
    return;
  }

  if (pagoV1FueRechazadoOAnulado(payCtx) && comp.estado === 'pendiente_qr') {
    await admin
      .from('comprobante')
      .update({ estado: 'borrador' as never, mp_qr_order_id: null })
      .eq('id', comp.id)
      .eq('tenant_id', params.tenantId);
    await actualizarTransaccionPasarelaPorComprobante(admin, {
      tenantId: params.tenantId,
      comprobanteId: comp.id,
      proveedor: 'mercado_pago',
      canal: 'qr',
      estado: 'rechazada',
      externalPaymentId: pay.id,
      ultimoError: pay.status_detail ?? pay.status,
    });
    try {
      await broadcastMpQrEvent(comp.id, { estado: 'rechazado', payment_type: 'qr' });
    } catch {
      /* noop */
    }
    return;
  }

  if (!pagoV1PermiteEmitirComprobante(payCtx)) {
    return;
  }

  const merchantFromSearch = await buscarMerchantOrderIdPorExternalReference(runtime.accessToken, extRef);
  if (merchantFromSearch) {
    await procesarNotificacionMpQrMerchantOrder(admin, {
      merchantOrderId: merchantFromSearch,
      tenantId: params.tenantId,
      sucursalId: params.sucursalId,
      integracionId: params.integracionId,
    });
    return;
  }

  console.warn('[mp-qr webhook] payment aprobado sin merchant_order resoluble', {
    comprobante_id: comp.id,
    payment_id: pay.id,
    external_reference: extRef,
  });
}
