import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { FacturacionService } from '../facturacion/facturacion.service';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { tipoComprobanteRequiereCaeAfip } from '../facturacion/utils/comprobante-void.rules';
import { Tenant } from '../config/entities/tenant.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { buildEmitDtoFromBorrador } from '../mp-point/utils/borrador-body.util';
import { MpQrClientFactory } from './mp-qr-client.factory';
import { MpQrConfigService } from './mp-qr-config.service';
import { MpQrEventBroadcastService } from './mp-qr-event-broadcast.service';
import { MpQrWebhookLog } from './entities/mp-qr-webhook-log.entity';
import type { MpQrMerchantOrderPayment } from './types/mp-qr.types';
import {
  buscarMerchantOrderIdPorExternalReference,
  fetchMercadoPagoPaymentV1Detalle,
  montoAprobadoSuficiente,
  pagoV1AunProcesandose,
  pagoV1FueRechazadoOAnulado,
  pagoV1PermiteEmitirComprobante,
} from './utils/mp-qr-payment-v1.util';

const ORPHAN_CANCEL_MS = 30_000;

@Injectable()
export class MpQrWebhookService {
  private readonly logger = new Logger(MpQrWebhookService.name);

  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ComprobanteItem)
    private readonly comprobanteItemRepo: Repository<ComprobanteItem>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectRepository(MpQrWebhookLog)
    private readonly webhookLogRepo: Repository<MpQrWebhookLog>,
    private readonly mpQrConfigService: MpQrConfigService,
    private readonly clientFactory: MpQrClientFactory,
    private readonly facturacionService: FacturacionService,
    private readonly broadcast: MpQrEventBroadcastService,
  ) {}

  async logRecepcion(params: {
    tenantId: string;
    topic: string | null;
    merchantOrderId: string | null;
    payloadSnippet: string;
  }): Promise<void> {
    try {
      await this.webhookLogRepo.save(
        this.webhookLogRepo.create({
          tenantId: params.tenantId,
          topic: params.topic,
          merchantOrderId: params.merchantOrderId,
          resultado: 'recibido',
          payloadSnippet: params.payloadSnippet.slice(0, 2000),
        }),
      );
    } catch (e) {
      this.logger.error('webhook log insert', e);
    }
  }

  async procesarNotificacionMpQrMerchantOrder(params: {
    merchantOrderId: string | number;
    tenantId: string;
    sucursalId?: string | null;
  }): Promise<void> {
    const { tenantId, merchantOrderId, sucursalId } = params;
    if (!sucursalId) {
      this.logger.warn(`webhook sin sucursal tenant=${tenantId}`);
      return;
    }

    const secrets = await this.mpQrConfigService.loadSecretsForTenantSucursal(tenantId, sucursalId);
    if (!secrets?.accessToken || !secrets.userId || !secrets.externalPosId) {
      this.logger.error(`webhook sin config MP QR tenant=${tenantId}`);
      return;
    }

    const client = this.clientFactory.create(secrets.accessToken, secrets.userId);
    let mo;
    try {
      mo = await client.getMerchantOrder(merchantOrderId);
    } catch (e) {
      this.logger.error('getMerchantOrder', e);
      return;
    }

    const extRef = mo.external_reference?.trim();
    if (!extRef) {
      this.logger.warn(`merchant_order sin external_reference ${merchantOrderId}`);
      return;
    }

    const comp = await this.comprobanteRepo.findOne({ where: { id: extRef } });
    if (!comp || comp.tenantId !== tenantId) {
      this.logger.warn(`comprobante no encontrado extRef=${extRef}`);
      return;
    }

    const orderIdStr = String(mo.id);

    if (comp.estado === EstadoComprobante.emitido && comp.numero != null) {
      return;
    }

    if (comp.mpQrPaymentId != null && comp.estado === EstadoComprobante.emitido) {
      return;
    }

    if (mo.status === 'expired' && comp.estado === EstadoComprobante.pendiente_qr) {
      await this.comprobanteRepo.update(
        { id: comp.id, tenantId },
        { estado: EstadoComprobante.borrador, mpQrOrderId: null },
      );
      await this.broadcast.broadcast(comp.id, { estado: 'cancelado', payment_type: 'qr' });
      return;
    }

    if (comp.estado === EstadoComprobante.pendiente_qr) {
      await this.comprobanteRepo.update({ id: comp.id, tenantId }, { mpQrOrderId: orderIdStr });
    }

    const payments = mo.payments ?? [];
    const totalOrden = Number(mo.total_amount ?? 0);
    const aprobado = montoAprobadoSuficiente(payments, totalOrden);

    if (aprobado.ok && aprobado.paymentId > 0 && secrets.accessToken && secrets.userId && secrets.externalPosId) {
      await this.procesarPagoAprobado(comp, {
        accessToken: secrets.accessToken,
        userId: secrets.userId,
        externalPosId: secrets.externalPosId,
      }, client, {
        paymentId: aprobado.paymentId,
        orderIdStr,
        paymentType: aprobado.paymentType,
        externalPosId: secrets.externalPosId,
        externalStoreId: null,
      });
      return;
    }

    if (todosPagosRechazadosOCancelados(payments) && comp.estado === EstadoComprobante.pendiente_qr) {
      await this.comprobanteRepo.update(
        { id: comp.id, tenantId },
        { estado: EstadoComprobante.borrador, mpQrOrderId: null },
      );
      await this.broadcast.broadcast(comp.id, { estado: 'rechazado', payment_type: 'qr' });
      return;
    }
  }

  async procesarNotificacionMpQrPayment(params: {
    paymentId: string | number;
    tenantId: string;
    sucursalId?: string | null;
  }): Promise<void> {
    const { tenantId, sucursalId } = params;
    if (!sucursalId) return;

    const secrets = await this.mpQrConfigService.loadSecretsForTenantSucursal(tenantId, sucursalId);
    if (!secrets?.accessToken) return;

    const pay = await fetchMercadoPagoPaymentV1Detalle(secrets.accessToken, params.paymentId);
    if (!pay) return;

    if (pagoV1AunProcesandose({ id: pay.id, status: pay.status, statusDetail: pay.status_detail })) {
      return;
    }

    if (pay.merchant_order_id) {
      await this.procesarNotificacionMpQrMerchantOrder({
        merchantOrderId: pay.merchant_order_id,
        tenantId,
        sucursalId,
      });
      return;
    }

    const extRef = pay.external_reference?.trim();
    if (!extRef) return;

    const comp = await this.comprobanteRepo.findOne({ where: { id: extRef } });
    if (!comp || comp.tenantId !== tenantId) return;

    if (comp.mpQrOrderId) {
      await this.procesarNotificacionMpQrMerchantOrder({
        merchantOrderId: comp.mpQrOrderId,
        tenantId,
        sucursalId,
      });
      return;
    }

    if (
      pagoV1FueRechazadoOAnulado({ id: pay.id, status: pay.status, statusDetail: pay.status_detail }) &&
      comp.estado === EstadoComprobante.pendiente_qr
    ) {
      await this.comprobanteRepo.update(
        { id: comp.id, tenantId },
        { estado: EstadoComprobante.borrador, mpQrOrderId: null },
      );
      await this.broadcast.broadcast(comp.id, { estado: 'rechazado', payment_type: 'qr' });
      return;
    }

    if (!pagoV1PermiteEmitirComprobante({ id: pay.id, status: pay.status, statusDetail: pay.status_detail })) {
      return;
    }

    const merchantFromSearch = await buscarMerchantOrderIdPorExternalReference(
      secrets.accessToken,
      extRef,
    );
    if (merchantFromSearch) {
      await this.procesarNotificacionMpQrMerchantOrder({
        merchantOrderId: merchantFromSearch,
        tenantId,
        sucursalId,
      });
    }
  }

  private async procesarPagoAprobado(
    comp: Comprobante,
    secrets: { accessToken: string; userId: string; externalPosId: string },
    client: ReturnType<MpQrClientFactory['create']>,
    ctx: {
      paymentId: number;
      orderIdStr: string;
      paymentType?: string;
      externalPosId: string;
      externalStoreId: string | null;
    },
  ): Promise<void> {
    const cancelAt = comp.mpQrCanceladoAt ? comp.mpQrCanceladoAt.getTime() : 0;
    const recienteCancel =
      comp.estado === EstadoComprobante.borrador &&
      cancelAt > 0 &&
      Date.now() - cancelAt < ORPHAN_CANCEL_MS;

    if (recienteCancel) {
      await this.comprobanteRepo.update(
        { id: comp.id, tenantId: comp.tenantId },
        {
          mpQrPagoHuerfano: true,
          mpQrPaymentId: String(ctx.paymentId),
          mpQrOrderId: ctx.orderIdStr,
        },
      );
      await this.broadcast.broadcast(comp.id, {
        estado: 'pago_huerfano',
        payment_id: ctx.paymentId,
        payment_type: 'qr',
      });
      return;
    }

    if (comp.estado !== EstadoComprobante.pendiente_qr) {
      return;
    }

    let usuarioId = comp.usuarioId;
    if (!usuarioId) {
      const u = await this.usuarioRepo.findOne({
        where: { tenantId: comp.tenantId },
        select: ['id'],
        order: { createdAt: 'ASC' },
      });
      usuarioId = u?.id ?? null;
    }
    if (!usuarioId) {
      this.logger.error(`webhook sin usuario tenant=${comp.tenantId}`);
      return;
    }

    const dto = await buildEmitDtoFromBorrador(
      this.comprobanteRepo,
      this.comprobanteItemRepo,
      comp.tenantId,
      comp.id,
    );
    if (!dto) {
      this.logger.error(`webhook no body borrador=${comp.id}`);
      await this.broadcast.broadcast(comp.id, {
        estado: 'error',
        motivo: 'No se pudo armar el body desde el borrador',
        payment_type: 'qr',
      });
      return;
    }

    const result = await this.facturacionService.emitirDesdeBorradorMpQr({
      tenantId: comp.tenantId,
      borradorId: comp.id,
      usuarioId,
      mpQrPaymentId: ctx.paymentId,
      dto,
    });

    if (!result.ok) {
      this.logger.error(`webhook emitir falló ${result.error}`);
      await this.broadcast.broadcast(comp.id, { estado: 'error', motivo: result.error, payment_type: 'qr' });
      return;
    }

    const emitido = result.data.data as Record<string, unknown>;
    const exigeCae = tipoComprobanteRequiereCaeAfip(String(emitido.tipo ?? ''));
    const caeStr = String(emitido.cae ?? '').trim();
    const fiscalOk =
      !exigeCae || (String(emitido.estado) === EstadoComprobante.emitido && caeStr.length > 0);

    try {
      await client.cancelOrder(ctx.externalPosId, {
        externalStoreId: ctx.externalStoreId,
        orderId: comp.mpQrOrderId,
      });
    } catch (e) {
      this.logger.error('cancelOrder post-emitir', e);
    }

    if (!fiscalOk && exigeCae) {
      const motivo =
        String(emitido.estado) === EstadoComprobante.pendiente_arca
          ? 'El pago se acreditó pero la factura no tiene CAE (AFIP pendiente o sin respuesta).'
          : 'El pago se acreditó pero la factura no quedó autorizada con CAE.';
      await this.broadcast.broadcast(comp.id, {
        estado: 'error',
        motivo,
        payment_id: ctx.paymentId,
        payment_type: ctx.paymentType ?? 'qr',
      });
      return;
    }

    await this.broadcast.broadcast(comp.id, {
      estado: 'aprobado',
      payment_type: ctx.paymentType ?? 'qr',
      payment_id: ctx.paymentId,
    });
  }
}

function todosPagosRechazadosOCancelados(payments: MpQrMerchantOrderPayment[]): boolean {
  if (!payments.length) return false;
  return payments.every((p) => p.status === 'rejected' || p.status === 'cancelled');
}

export function buildMpQrWebhookNotificationUrl(
  config: ConfigService,
  tenantId: string,
  sucursalId: string,
): string | null {
  const baseRaw = config.get<string>('PUBLIC_APP_BASE_URL')?.trim() ?? '';
  if (!baseRaw) return null;
  try {
    const base = baseRaw.endsWith('/') ? baseRaw.slice(0, -1) : baseRaw;
    const path = base.includes('/api/v1') ? '/pagos/mp-qr/webhook' : '/api/v1/pagos/mp-qr/webhook';
    const url = new URL(`${base}${path}`);
    url.searchParams.set('tenant_id', tenantId);
    url.searchParams.set('sucursal_id', sucursalId);
    return url.toString();
  } catch {
    return null;
  }
}
