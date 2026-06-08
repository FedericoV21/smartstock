import { buildPublicAppAbsoluteUrl } from '@/lib/supabase/env-keys';
import { getMpPointClient, MpPointError } from '@/lib/mp-point/client';
import { getMpQrClient, MpQrError } from '@/lib/mp-qr/client';
import {
  resolveMpQrPos,
  runMpQrVerificacionMpQr,
} from '@/lib/mp-qr/verificar-configuracion';
import { verifyMercadoPagoWebhookSignature } from '@/lib/mp-point/webhook-signature';

import { getPasarelaSecret, stringFromUnknown } from './secrets';
import type {
  JsonRecord,
  PasarelaAdapter,
  PasarelaComprobantePago,
  PasarelaCreatePaymentResult,
  PasarelaIntegracionRow,
  PasarelaVerificacionResult,
} from './types';

function redondearPesos(n: number): number {
  return Math.round(n * 100) / 100;
}

function configString(integracion: PasarelaIntegracionRow, key: string): string | null {
  return stringFromUnknown(integracion.config_publica?.[key]);
}

function totalComprobante(comprobante: PasarelaComprobantePago, fallback: number): number {
  const total = Number(comprobante.total);
  return Number.isFinite(total) && total > 0 ? total : fallback;
}

function mpQrEndpointDebug(params: {
  userId: string;
  externalPosId: string;
  externalStoreId?: string | null;
}): { endpoint_kind: string; endpoint_path: string } {
  const uid = encodeURIComponent(params.userId.trim());
  const pos = encodeURIComponent(params.externalPosId.trim());
  const store = params.externalStoreId?.trim();
  if (store) {
    return {
      endpoint_kind: 'instore_order_with_store',
      endpoint_path: `/instore/qr/seller/collectors/${uid}/stores/${encodeURIComponent(store)}/pos/${pos}/orders`,
    };
  }
  return {
    endpoint_kind: 'dynamic_qr_without_store',
    endpoint_path: `/instore/orders/qr/seller/collectors/${uid}/pos/${pos}/qrs`,
  };
}

function mpPointErrorToResult(e: unknown): PasarelaCreatePaymentResult {
  if (e instanceof MpPointError) {
    if (e.status === 401) {
      return { ok: false, status: 400, error: 'Token de MP invalido o vencido', code: e.code };
    }
    const status = e.status >= 500 ? 503 : e.status === 422 ? 400 : 503;
    return {
      ok: false,
      status,
      error: e.message || 'Error de Mercado Pago Point',
      code: e.code,
    };
  }
  console.error('[pasarelas/mp-point] createPayment', e);
  return { ok: false, status: 503, error: 'Error al crear el cobro en la terminal' };
}

function mpQrErrorToResult(
  e: unknown,
  requestPayload?: JsonRecord | null,
): PasarelaCreatePaymentResult {
  if (e instanceof MpQrError) {
    const responsePayload: JsonRecord = {
      mp_status: e.status,
      mp_code: e.code,
      mp_message: e.message,
      mp_details: e.details ?? null,
    };
    if (e.status === 401) {
      return {
        ok: false,
        status: 400,
        error: 'Token de MP invalido o vencido',
        code: e.code,
        request_payload: requestPayload ?? null,
        response_payload: responsePayload,
      };
    }
    if (e.status === 409 || /orden activa|in_use|occupied/i.test(e.message)) {
      return {
        ok: false,
        status: 409,
        error: 'Hay una venta en curso en esta caja, espera o cancelala',
        code: e.code,
        request_payload: requestPayload ?? null,
        response_payload: responsePayload,
      };
    }
    return {
      ok: false,
      status: e.status >= 500 ? 503 : 503,
      error: e.message || 'Error de Mercado Pago QR',
      code: e.code,
      request_payload: requestPayload ?? null,
      response_payload: responsePayload,
    };
  }
  console.error('[pasarelas/mp-qr] createPayment', e);
  return {
    ok: false,
    status: 503,
    error: 'Error al iniciar cobro QR',
    request_payload: requestPayload ?? null,
    response_payload: { error: String(e) },
  };
}

async function tenantNombre(db: any, tenantId: string): Promise<string> {
  const { data } = await db.from('tenant').select('nombre').eq('id', tenantId).maybeSingle();
  const nombre = typeof data?.nombre === 'string' ? data.nombre.trim() : '';
  return nombre || 'Comercio';
}

function verificacionIncompleta(mensaje: string): PasarelaVerificacionResult {
  return {
    ok: false,
    mensaje,
    checks: {
      configuracion: { ok: false, mensaje },
    },
  };
}

const mpPointAdapter: PasarelaAdapter = {
  proveedor: 'mercado_pago',
  tipo: 'mp_point',
  canal: 'terminal',
  validateConfig(integracion) {
    const token = getPasarelaSecret(integracion, 'access_token');
    const deviceId = configString(integracion, 'device_id');
    if (!token || !deviceId) {
      return { ok: false, error: 'Configuracion de MP Point incompleta' };
    }
    return { ok: true };
  },
  async verifyConfig({ integracion }) {
    const accessToken = getPasarelaSecret(integracion, 'access_token');
    const deviceId = configString(integracion, 'device_id');
    if (!accessToken || !deviceId) {
      return verificacionIncompleta('Configuracion de MP Point incompleta');
    }

    try {
      const devices = await getMpPointClient(accessToken).listDevices();
      const tokenCheck = {
        ok: true,
        mensaje: `Token valido. Mercado Pago devolvio ${devices.length} terminal(es).`,
      };
      const device = devices.find((d) => d.id === deviceId);
      if (!device) {
        const disponibles = devices.map((d) => d.id).filter(Boolean).join(', ');
        return {
          ok: false,
          mensaje: 'No se encontro la terminal configurada en Mercado Pago.',
          checks: {
            token_valido: tokenCheck,
            terminal_existe: {
              ok: false,
              mensaje: disponibles
                ? `No se encontro Device ID "${deviceId}". Disponibles: ${disponibles}`
                : `No se encontro Device ID "${deviceId}".`,
              sugerencia: 'Copia el Device ID exacto desde Mercado Pago Point o elegilo desde el listado.',
            },
            modo_pdv: { ok: false, mensaje: 'No ejecutado: la terminal no existe.' },
          },
        };
      }

      const terminalOk = {
        ok: true,
        mensaje: `Terminal encontrada${device.name ? `: ${device.name}` : ''}.`,
        device_id: device.id,
        pos_id: device.pos_id,
        external_pos_id: device.external_pos_id,
      };
      if (device.operating_mode === 'STANDALONE') {
        return {
          ok: false,
          mensaje: 'La terminal esta en modo autonomo.',
          checks: {
            token_valido: tokenCheck,
            terminal_existe: terminalOk,
            modo_pdv: {
              ok: false,
              mensaje: 'La terminal esta en modo STANDALONE.',
              sugerencia: 'Cambiala a modo PDV desde la app o el panel de Mercado Pago.',
            },
          },
        };
      }

      return {
        ok: true,
        mensaje: 'Conexion MP Point verificada.',
        checks: {
          token_valido: tokenCheck,
          terminal_existe: terminalOk,
          modo_pdv: {
            ok: true,
            mensaje: 'La terminal esta en modo PDV.',
          },
        },
      };
    } catch (e) {
      if (e instanceof MpPointError) {
        const mensaje = e.status === 401 ? 'Token de MP invalido o vencido' : e.message;
        return {
          ok: false,
          mensaje,
          checks: {
            token_valido: {
              ok: false,
              mensaje,
            },
            terminal_existe: { ok: false, mensaje: 'No ejecutado: fallo la validacion del token.' },
            modo_pdv: { ok: false, mensaje: 'No ejecutado: fallo la validacion del token.' },
          },
        };
      }
      console.error('[pasarelas/mp-point] verifyConfig', e);
      return {
        ok: false,
        mensaje: 'No se pudo verificar MP Point. Reintenta en unos segundos.',
      };
    }
  },
  async createPayment({ integracion, comprobante, monto }) {
    const accessToken = getPasarelaSecret(integracion, 'access_token');
    const deviceId = configString(integracion, 'device_id');
    if (!accessToken || !deviceId) {
      return { ok: false, status: 400, error: 'Configuracion de MP Point incompleta' };
    }

    const totalDb = totalComprobante(comprobante, monto);
    const cents = Math.round(totalDb * 100);
    const client = getMpPointClient(accessToken);

    if (comprobante.mp_point_intent_id) {
      try {
        const prev = await client.getPaymentIntent(deviceId, comprobante.mp_point_intent_id);
        if (prev.state === 'OPEN' || prev.state === 'ON_TERMINAL' || prev.state === 'PROCESSING') {
          await client.cancelPaymentIntent(deviceId, comprobante.mp_point_intent_id);
        }
      } catch (e) {
        if (e instanceof MpPointError && (e.status === 422 || e.status === 404)) {
          /* intent inexistente o ya cerrado */
        } else if (e instanceof MpPointError) {
          console.error('[pasarelas/mp-point] cancel prev intent', e.status, e.code);
        }
      }
    }

    try {
      const devices = await client.listDevices();
      const device = devices.find((d) => d.id === deviceId);
      if (device?.operating_mode === 'STANDALONE') {
        return {
          ok: false,
          status: 400,
          error:
            'La terminal esta en modo autonomo (STANDALONE). Cambiala a modo PDV desde la app de Mercado Pago.',
          code: 'standalone_mode',
        };
      }

      const intent = await client.createPaymentIntent(deviceId, {
        amount: cents,
        additional_info: {
          external_reference: comprobante.id,
          print_on_terminal: true,
        },
      });

      return {
        ok: true,
        estadoComprobante: 'pendiente_posnet',
        updateComprobante: {
          mp_point_intent_id: intent.id,
          estado: 'pendiente_posnet',
        },
        transaccion: {
          estado: 'pendiente',
          external_intent_id: intent.id,
          external_reference: comprobante.id,
          response_payload: {
            intent_id: intent.id,
            amount: intent.amount,
            state: intent.state,
          },
        },
        response: {
          intent_id: intent.id,
          estado: 'pendiente_posnet',
          monto_terminal_pesos: totalDb,
        },
      };
    } catch (e) {
      return mpPointErrorToResult(e);
    }
  },
  async cancelPayment({ integracion, comprobante }) {
    const accessToken = getPasarelaSecret(integracion, 'access_token');
    const deviceId = configString(integracion, 'device_id');
    if (!accessToken || !deviceId || !comprobante.mp_point_intent_id) {
      return { ok: false, status: 400, error: 'No hay intent de MP Point para cancelar' };
    }
    try {
      await getMpPointClient(accessToken).cancelPaymentIntent(deviceId, comprobante.mp_point_intent_id);
      return { ok: true };
    } catch (e) {
      if (e instanceof MpPointError && (e.status === 404 || e.status === 422)) return { ok: true };
      if (e instanceof MpPointError) return { ok: false, status: e.status, error: e.message };
      return { ok: false, status: 503, error: 'No se pudo cancelar el intent' };
    }
  },
  async listDevices({ integracion }) {
    const accessToken = getPasarelaSecret(integracion, 'access_token');
    if (!accessToken) return { ok: false, status: 400, error: 'Token de MP Point no configurado' };
    try {
      const devices = await getMpPointClient(accessToken).listDevices();
      return { ok: true, devices: devices as unknown as JsonRecord[] };
    } catch (e) {
      if (e instanceof MpPointError) return { ok: false, status: e.status, error: e.message };
      return { ok: false, status: 503, error: 'No se pudieron listar terminales' };
    }
  },
  async verifyWebhook({ integracion, rawBody, bodyJson, headers, url }) {
    const secret = getPasarelaSecret(integracion, 'webhook_secret');
    if (!secret) return false;
    return verifyMercadoPagoWebhookSignature({
      rawBody,
      bodyJson,
      xSignature: headers.get('x-signature'),
      xRequestId: headers.get('x-request-id'),
      queryDataId: url.searchParams.get('data.id'),
      secret,
    });
  },
};

const mpQrAdapter: PasarelaAdapter = {
  proveedor: 'mercado_pago',
  tipo: 'mp_qr',
  canal: 'qr',
  validateConfig(integracion) {
    const token = getPasarelaSecret(integracion, 'access_token');
    const userId = configString(integracion, 'user_id');
    const externalPosId = configString(integracion, 'external_pos_id');
    if (!token || !userId || !externalPosId) {
      return { ok: false, error: 'Configuracion de MP QR incompleta' };
    }
    return { ok: true };
  },
  async verifyConfig({ integracion }) {
    const accessToken = getPasarelaSecret(integracion, 'access_token');
    const userId = configString(integracion, 'user_id');
    const externalPosId = configString(integracion, 'external_pos_id');
    const externalStoreId = configString(integracion, 'external_store_id');
    if (!accessToken || !userId || !externalPosId) {
      return verificacionIncompleta('Configuracion de MP QR incompleta');
    }

    try {
      const resolved = await resolveMpQrPos({
        access_token: accessToken,
        user_id: userId,
        external_pos_id: externalPosId,
        external_store_id: externalStoreId,
      }).catch(() => ({
        external_pos_id: externalPosId,
        external_store_id: externalStoreId,
        resolved_from_internal_id: false,
      }));
      const result = await runMpQrVerificacionMpQr({
        access_token: accessToken,
        user_id: userId,
        external_pos_id: resolved.external_pos_id,
        external_store_id: resolved.external_store_id,
      });
      return {
        ...result,
        mensaje: result.ok ? 'Conexion MP QR verificada.' : 'No se pudo verificar MP QR.',
        detalles: resolved.resolved_from_internal_id || resolved.external_store_id
          ? {
              external_pos_id_original: externalPosId,
              external_pos_id_resuelto: resolved.external_pos_id,
              external_store_id: resolved.external_store_id,
            }
          : undefined,
      };
    } catch (e) {
      console.error('[pasarelas/mp-qr] verifyConfig', e);
      return {
        ok: false,
        mensaje: 'No se pudo verificar MP QR. Reintenta en unos segundos.',
      };
    }
  },
  async createPayment({ db, tenantId, integracion, comprobante, monto }) {
    const accessToken = getPasarelaSecret(integracion, 'access_token');
    const userId = configString(integracion, 'user_id');
    let externalPosId = configString(integracion, 'external_pos_id');
    let externalStoreId = configString(integracion, 'external_store_id');
    if (!accessToken || !userId || !externalPosId) {
      return { ok: false, status: 400, error: 'Configuracion de MP QR incompleta' };
    }

    const notificationUrl = buildPublicAppAbsoluteUrl(
      `/api/pagos/webhook/mercado_pago/${encodeURIComponent(integracion.webhook_public_id)}`,
    );
    if (!notificationUrl) {
      return {
        ok: false,
        status: 400,
        error:
          'No se pudo armar la URL del webhook para Mercado Pago. Revisa NEXT_PUBLIC_SITE_URL o NEXT_PUBLIC_APP_URL.',
      };
    }

    const totalPesos = redondearPesos(totalComprobante(comprobante, monto));
    const externalPosIdInicial = externalPosId;
    const resolvedPos = await resolveMpQrPos({
      access_token: accessToken,
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
    const client = getMpQrClient(accessToken, userId);

    if (comprobante.estado === 'pendiente_qr') {
      try {
        await client.cancelOrder(externalPosId, { externalStoreId });
      } catch (e) {
        if (e instanceof MpQrError && (e.status === 404 || e.status === 422)) {
          /* sin orden activa */
        } else if (e instanceof MpQrError) {
          console.error('[pasarelas/mp-qr] cancel prev', e.status, e.code);
        }
      }
    }

    const nombreTenant = await tenantNombre(db, tenantId);
    const numeroOrden = comprobante.numero_orden ?? comprobante.id.slice(0, 8);
    const title = `Venta #${numeroOrden}`;
    const payload = {
      external_reference: comprobante.id,
      title,
      description: `${title} - ${nombreTenant}`,
      notification_url: notificationUrl,
      total_amount: totalPesos,
      items: [
        {
          title,
          description: 'Cobro POS Nexus',
          unit_price: totalPesos,
          quantity: 1,
          unit_measure: 'unit' as const,
          total_amount: totalPesos,
        },
      ],
    };
    const endpointDebug = mpQrEndpointDebug({
      userId,
      externalPosId,
      externalStoreId,
    });
    const requestPayload: JsonRecord = {
      proveedor: 'mercado_pago',
      tipo: 'mp_qr',
      integracion_id: integracion.id,
      webhook_public_id: integracion.webhook_public_id,
      tenant_id: tenantId,
      sucursal_id: comprobante.sucursal_id,
      comprobante_id: comprobante.id,
      external_pos_id_configurado: externalPosIdInicial,
      external_pos_id_usado: externalPosId,
      external_store_id: externalStoreId ?? null,
      resolved_from_internal_id: resolvedPos.resolved_from_internal_id,
      ...endpointDebug,
      payload,
    };

    try {
      console.info('[pasarelas/mp-qr] create order request', requestPayload);
      const order = await client.createOrder(externalPosId, payload, { externalStoreId });
      return {
        ok: true,
        estadoComprobante: 'pendiente_qr',
        updateComprobante: {
          estado: 'pendiente_qr',
          mp_qr_cancelado_at: null,
          mp_qr_pago_huerfano: false,
        },
        transaccion: {
          estado: 'pendiente',
          external_order_id: stringFromUnknown(order.in_store_order_id),
          external_reference: comprobante.id,
          request_payload: requestPayload,
          response_payload: {
            in_store_order_id: order.in_store_order_id,
            qr: order.qr,
          },
        },
        response: {
          estado: 'pendiente_qr',
          monto_terminal_pesos: totalPesos,
          in_store_order_id: order.in_store_order_id,
        },
      };
    } catch (e) {
      if (e instanceof MpQrError) {
        console.error('[pasarelas/mp-qr] create order failed', {
          ...requestPayload,
          mp_status: e.status,
          mp_code: e.code,
          mp_message: e.message,
          mp_details: e.details ?? null,
        });
      } else {
        console.error('[pasarelas/mp-qr] create order failed', requestPayload, e);
      }
      return mpQrErrorToResult(e, requestPayload);
    }
  },
  async cancelPayment({ integracion, comprobante }) {
    const accessToken = getPasarelaSecret(integracion, 'access_token');
    const userId = configString(integracion, 'user_id');
    let externalPosId = configString(integracion, 'external_pos_id');
    let externalStoreId = configString(integracion, 'external_store_id');
    if (!accessToken || !userId || !externalPosId) {
      return { ok: false, status: 400, error: 'Configuracion de MP QR incompleta' };
    }
    try {
      const externalPosIdInicial = externalPosId;
      const resolvedPos = await resolveMpQrPos({
          access_token: accessToken,
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
      await getMpQrClient(accessToken, userId).cancelOrder(externalPosId, {
        externalStoreId,
        orderId: comprobante.mp_qr_order_id ?? null,
      });
      return { ok: true };
    } catch (e) {
      if (e instanceof MpQrError && (e.status === 404 || e.status === 422)) return { ok: true };
      if (
        e instanceof MpQrError &&
        (e.code === 'in_store_order_delete_error' ||
          e.code === 'instore_order_locked_error' ||
          e.code === 'order_already_canceled')
      ) {
        return { ok: true };
      }
      if (e instanceof MpQrError) return { ok: false, status: e.status, error: e.message };
      return { ok: false, status: 503, error: 'No se pudo cancelar la orden QR' };
    }
  },
};

const ADAPTERS = new Map<string, PasarelaAdapter>(
  [mpPointAdapter, mpQrAdapter].map((adapter) => [adapter.tipo, adapter]),
);

export function getPasarelaAdapter(tipo: string): PasarelaAdapter | null {
  return ADAPTERS.get(tipo) ?? null;
}

export function listPasarelaAdapters(): PasarelaAdapter[] {
  return [...ADAPTERS.values()];
}
