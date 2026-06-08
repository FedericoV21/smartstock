import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Tenant } from '../config/entities/tenant.entity';
import { LegacyFieldCryptoService } from '../common/crypto/legacy-field-crypto.service';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { MpPointError } from '../mp-point/errors/mp-point.error';
import { MpPointClientFactory } from '../mp-point/mp-point-client.factory';
import { verifyMercadoPagoWebhookSignature } from '../mp-point/utils/webhook-signature.util';
import { MpQrError } from '../mp-qr/errors/mp-qr.error';
import { MpQrClientFactory } from '../mp-qr/mp-qr-client.factory';
import { resolveMpQrPos } from '../mp-qr/utils/resolve-mp-qr-pos.util';
import type { PasarelaIntegracion } from './entities/pasarela-integracion.entity';
import { getPasarelaSecret, stringFromUnknown } from './utils/pasarela-secrets.util';

export type PasarelaCreatePaymentResult =
  | {
      ok: true;
      updateComprobante: Partial<Comprobante>;
      transaccion: {
        estado: string;
        external_intent_id?: string | null;
        external_order_id?: string | null;
        external_reference?: string | null;
        request_payload?: Record<string, unknown> | null;
        response_payload?: Record<string, unknown> | null;
      };
      response: Record<string, unknown>;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code?: string | null;
      request_payload?: Record<string, unknown> | null;
      response_payload?: Record<string, unknown> | null;
    };

export type PasarelaCancelPaymentResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

@Injectable()
export class PasarelaPaymentAdaptersService {
  private readonly logger = new Logger(PasarelaPaymentAdaptersService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly fieldCrypto: LegacyFieldCryptoService,
    private readonly mpPointClientFactory: MpPointClientFactory,
    private readonly mpQrClientFactory: MpQrClientFactory,
    private readonly config: ConfigService,
  ) {}

  validateConfig(integracion: PasarelaIntegracion): { ok: true } | { ok: false; error: string } {
    if (integracion.tipo === 'mp_point') return this.validateMpPoint(integracion);
    if (integracion.tipo === 'mp_qr') return this.validateMpQr(integracion);
    return { ok: false, error: `No hay adapter registrado para ${integracion.tipo}` };
  }

  async createPayment(params: {
    integracion: PasarelaIntegracion;
    comprobante: Comprobante;
    monto: number;
    tenantId: string;
  }): Promise<PasarelaCreatePaymentResult> {
    if (params.integracion.tipo === 'mp_point') {
      return this.createMpPointPayment(params);
    }
    if (params.integracion.tipo === 'mp_qr') {
      return this.createMpQrPayment(params);
    }
    return { ok: false, status: 400, error: `Tipo de pasarela no soportado: ${params.integracion.tipo}` };
  }

  async cancelPayment(params: {
    integracion: PasarelaIntegracion;
    comprobante: Comprobante;
    tenantId: string;
    externalOrderId?: string | null;
  }): Promise<PasarelaCancelPaymentResult> {
    if (params.integracion.tipo === 'mp_point') {
      return this.cancelMpPointPayment(params.integracion, params.comprobante);
    }
    if (params.integracion.tipo === 'mp_qr') {
      return this.cancelMpQrPayment(params.integracion, params.comprobante, params.externalOrderId);
    }
    return { ok: false, status: 400, error: 'La pasarela no soporta cancelacion' };
  }

  verifyWebhook(params: {
    integracion: PasarelaIntegracion;
    rawBody: string;
    bodyJson: unknown;
    headers: { get: (name: string) => string | null | undefined };
    queryDataId: string | null;
  }): boolean {
    const secret = getPasarelaSecret(this.fieldCrypto, params.integracion, 'webhook_secret');
    if (!secret) return false;
    return verifyMercadoPagoWebhookSignature({
      bodyJson: params.bodyJson,
      xSignature: params.headers.get('x-signature') ?? null,
      xRequestId: params.headers.get('x-request-id') ?? null,
      queryDataId: params.queryDataId,
      secret,
    });
  }

  private configString(integracion: PasarelaIntegracion, key: string): string | null {
    return stringFromUnknown(integracion.configPublica?.[key]);
  }

  private validateMpPoint(integracion: PasarelaIntegracion) {
    const token = getPasarelaSecret(this.fieldCrypto, integracion, 'access_token');
    const deviceId = this.configString(integracion, 'device_id');
    if (!token || !deviceId) return { ok: false as const, error: 'Configuracion de MP Point incompleta' };
    return { ok: true as const };
  }

  private validateMpQr(integracion: PasarelaIntegracion) {
    const token = getPasarelaSecret(this.fieldCrypto, integracion, 'access_token');
    const userId = this.configString(integracion, 'user_id');
    const externalPosId = this.configString(integracion, 'external_pos_id');
    if (!token || !userId || !externalPosId) {
      return { ok: false as const, error: 'Configuracion de MP QR incompleta' };
    }
    return { ok: true as const };
  }

  private totalComprobante(comprobante: Comprobante, fallback: number): number {
    const total = Number(comprobante.total);
    return Number.isFinite(total) && total > 0 ? total : fallback;
  }

  private redondearPesos(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private buildWebhookUrl(proveedor: string, webhookPublicId: string): string | null {
    const baseRaw = this.config.get<string>('PUBLIC_APP_BASE_URL')?.trim() ?? '';
    if (!baseRaw) return null;
    try {
      const base = baseRaw.endsWith('/') ? baseRaw.slice(0, -1) : baseRaw;
      const prefix = base.includes('/api/v1') ? '' : '/api/v1';
      return `${base}${prefix}/pagos/webhook/${encodeURIComponent(proveedor)}/${encodeURIComponent(webhookPublicId)}`;
    } catch {
      return null;
    }
  }

  private async createMpPointPayment(params: {
    integracion: PasarelaIntegracion;
    comprobante: Comprobante;
    monto: number;
  }): Promise<PasarelaCreatePaymentResult> {
    const { integracion, comprobante } = params;
    const accessToken = getPasarelaSecret(this.fieldCrypto, integracion, 'access_token');
    const deviceId = this.configString(integracion, 'device_id');
    if (!accessToken || !deviceId) {
      return { ok: false, status: 400, error: 'Configuracion de MP Point incompleta' };
    }

    const totalDb = this.totalComprobante(comprobante, params.monto);
    const cents = Math.round(totalDb * 100);
    const client = this.mpPointClientFactory.create(accessToken);

    if (comprobante.mpPointIntentId) {
      try {
        const prev = await client.getPaymentIntent(deviceId, comprobante.mpPointIntentId);
        if (prev.state === 'OPEN' || prev.state === 'ON_TERMINAL' || prev.state === 'PROCESSING') {
          await client.cancelPaymentIntent(deviceId, comprobante.mpPointIntentId);
        }
      } catch (e) {
        if (!(e instanceof MpPointError && (e.status === 422 || e.status === 404))) {
          this.logger.warn('cancel prev mp point intent', e);
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
        updateComprobante: {
          mpPointIntentId: intent.id,
          estado: EstadoComprobante.pendiente_posnet,
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
      return this.mpPointErrorToResult(e);
    }
  }

  private async createMpQrPayment(params: {
    integracion: PasarelaIntegracion;
    comprobante: Comprobante;
    monto: number;
    tenantId: string;
  }): Promise<PasarelaCreatePaymentResult> {
    const { integracion, comprobante, tenantId } = params;
    const accessToken = getPasarelaSecret(this.fieldCrypto, integracion, 'access_token');
    const userId = this.configString(integracion, 'user_id');
    let externalPosId = this.configString(integracion, 'external_pos_id');
    let externalStoreId = this.configString(integracion, 'external_store_id');
    if (!accessToken || !userId || !externalPosId) {
      return { ok: false, status: 400, error: 'Configuracion de MP QR incompleta' };
    }

    const notificationUrl = this.buildWebhookUrl(integracion.proveedor, integracion.webhookPublicId);
    if (!notificationUrl) {
      return {
        ok: false,
        status: 400,
        error:
          'No se pudo armar la URL del webhook para Mercado Pago. Revisa PUBLIC_APP_BASE_URL.',
      };
    }

    const totalPesos = this.redondearPesos(this.totalComprobante(comprobante, params.monto));
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
    const client = this.mpQrClientFactory.create(accessToken, userId);

    if (comprobante.estado === EstadoComprobante.pendiente_qr) {
      try {
        await client.cancelOrder(externalPosId, { externalStoreId });
      } catch (e) {
        if (!(e instanceof MpQrError && (e.status === 404 || e.status === 422))) {
          this.logger.warn('cancel prev mp qr order', e);
        }
      }
    }

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId }, select: ['nombre'] });
    const nombreTenant = tenant?.nombre?.trim() || 'Comercio';
    const numeroOrden = comprobante.numeroOrden ?? comprobante.id.slice(0, 8);
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
    const requestPayload: Record<string, unknown> = {
      proveedor: integracion.proveedor,
      tipo: integracion.tipo,
      integracion_id: integracion.id,
      webhook_public_id: integracion.webhookPublicId,
      tenant_id: tenantId,
      sucursal_id: comprobante.sucursalId,
      comprobante_id: comprobante.id,
      external_pos_id_configurado: externalPosIdInicial,
      external_pos_id_usado: externalPosId,
      external_store_id: externalStoreId ?? null,
      resolved_from_internal_id: resolvedPos.resolved_from_internal_id,
      payload,
    };

    try {
      const order = await client.createOrder(externalPosId, payload, { externalStoreId });
      return {
        ok: true,
        updateComprobante: {
          estado: EstadoComprobante.pendiente_qr,
          mpQrCanceladoAt: null,
          mpQrPagoHuerfano: false,
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
      return this.mpQrErrorToResult(e, requestPayload);
    }
  }

  private async cancelMpPointPayment(
    integracion: PasarelaIntegracion,
    comprobante: Comprobante,
  ): Promise<PasarelaCancelPaymentResult> {
    const accessToken = getPasarelaSecret(this.fieldCrypto, integracion, 'access_token');
    const deviceId = this.configString(integracion, 'device_id');
    if (!accessToken || !deviceId || !comprobante.mpPointIntentId) {
      return { ok: false, status: 400, error: 'No hay intent de MP Point para cancelar' };
    }
    try {
      await this.mpPointClientFactory
        .create(accessToken)
        .cancelPaymentIntent(deviceId, comprobante.mpPointIntentId);
      return { ok: true };
    } catch (e) {
      if (e instanceof MpPointError && (e.status === 404 || e.status === 422)) return { ok: true };
      if (e instanceof MpPointError) return { ok: false, status: e.status, error: e.message };
      return { ok: false, status: 503, error: 'No se pudo cancelar el intent' };
    }
  }

  private async cancelMpQrPayment(
    integracion: PasarelaIntegracion,
    comprobante: Comprobante,
    externalOrderId?: string | null,
  ): Promise<PasarelaCancelPaymentResult> {
    const accessToken = getPasarelaSecret(this.fieldCrypto, integracion, 'access_token');
    const userId = this.configString(integracion, 'user_id');
    let externalPosId = this.configString(integracion, 'external_pos_id');
    let externalStoreId = this.configString(integracion, 'external_store_id');
    if (!accessToken || !userId || !externalPosId) {
      return { ok: false, status: 400, error: 'Configuracion de MP QR incompleta' };
    }
    try {
      const resolvedPos = await resolveMpQrPos({
        access_token: accessToken,
        user_id: userId,
        external_pos_id: externalPosId,
        external_store_id: externalStoreId,
      }).catch(() => ({
        external_pos_id: externalPosId!,
        external_store_id: externalStoreId,
        resolved_from_internal_id: false,
      }));
      await this.mpQrClientFactory.create(accessToken, userId).cancelOrder(resolvedPos.external_pos_id, {
        externalStoreId: resolvedPos.external_store_id,
        orderId: comprobante.mpQrOrderId ?? externalOrderId ?? null,
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
  }

  private mpPointErrorToResult(e: unknown): PasarelaCreatePaymentResult {
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
    this.logger.error('mp point createPayment', e);
    return { ok: false, status: 503, error: 'Error al crear el cobro en la terminal' };
  }

  private mpQrErrorToResult(
    e: unknown,
    requestPayload?: Record<string, unknown> | null,
  ): PasarelaCreatePaymentResult {
    if (e instanceof MpQrError) {
      const responsePayload: Record<string, unknown> = {
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
    this.logger.error('mp qr createPayment', e);
    return {
      ok: false,
      status: 503,
      error: 'Error al iniciar cobro QR',
      request_payload: requestPayload ?? null,
      response_payload: { error: String(e) },
    };
  }
}
