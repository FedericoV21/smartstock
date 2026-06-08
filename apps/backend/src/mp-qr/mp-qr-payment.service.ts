import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Caja } from '../caja/entities/caja.entity';
import { lineaEtiquetaCajaFisica } from '../caja/utils/caja-linea-etiqueta.util';
import { Tenant } from '../config/entities/tenant.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { MpQrError } from './errors/mp-qr.error';
import { MpQrClientFactory } from './mp-qr-client.factory';
import { MpQrConfigService } from './mp-qr-config.service';
import { MpQrWebhookService, buildMpQrWebhookNotificationUrl } from './mp-qr-webhook.service';
import { resolveMpQrExternalPosId, resolveMpQrPos } from './utils/resolve-mp-qr-pos.util';
import { mapMpQrErrorToHttpException } from './utils/mp-qr-error.mapper';
import {
  comprobanteEsVentaMpQrCompletaEntity,
  comprobanteTienePagoMpQrEntity,
  redondearPesos,
} from './utils/mp-qr-venta.util';
import {
  mpQrErrorEsConsultaOrdenNoDisponible,
  respuestaSincronizarEsperandoQr,
} from './utils/sincronizar-helpers.util';
import { montoAprobadoSuficiente } from './utils/mp-qr-payment-v1.util';

const SYNC_RATE_MS = 5000;

@Injectable()
export class MpQrPaymentService {
  private readonly logger = new Logger(MpQrPaymentService.name);
  private readonly ultimaSyncPorComprobante = new Map<string, number>();

  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly tenantContext: TenantContext,
    private readonly mpQrConfigService: MpQrConfigService,
    private readonly clientFactory: MpQrClientFactory,
    private readonly webhookService: MpQrWebhookService,
    private readonly config: ConfigService,
  ) {}

  async iniciar(comprobanteId: string, totalBody: number) {
    await this.mpQrConfigService.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const comp = await this.findComprobante(comprobanteId, tenantId);

    if (comp.estado !== EstadoComprobante.borrador && comp.estado !== EstadoComprobante.pendiente_qr) {
      throw new BadRequestException(
        'Solo se puede cobrar con QR sobre un borrador o un cobro QR en curso.',
      );
    }

    const totalDb = Number(comp.total);
    if (!Number.isFinite(totalDb) || totalDb <= 0) {
      throw new BadRequestException('El borrador no tiene un total válido para cobrar con QR');
    }

    const centsCliente = Math.round(totalBody * 100);
    const centsDb = Math.round(totalDb * 100);
    if (Math.abs(centsCliente - centsDb) > 2) {
      this.logger.warn(
        `iniciar total body distinto borrador=${comprobanteId} body=${totalBody} db=${totalDb}`,
      );
    }

    if (!comp.sucursalId) {
      throw new BadRequestException('El comprobante no tiene sucursal asociada');
    }

    const secrets = await this.mpQrConfigService.loadSecretsForSucursal(comp.sucursalId);
    if (
      !secrets?.habilitado ||
      !secrets.accessToken ||
      !secrets.userId?.trim() ||
      !secrets.externalPosId?.trim()
    ) {
      throw new BadRequestException('Configuración de MP QR incompleta');
    }

    const userId = secrets.userId.trim();
    const resolvedPos = await resolveMpQrPos({
      access_token: secrets.accessToken,
      user_id: userId,
      external_pos_id: secrets.externalPosId.trim(),
    }).catch(() => ({
      external_pos_id: secrets.externalPosId!.trim(),
      external_store_id: null,
      resolved_from_internal_id: false,
    }));

    const client = this.clientFactory.create(secrets.accessToken, userId);
    const totalPesos = redondearPesos(totalDb);

    if (comp.estado === EstadoComprobante.pendiente_qr) {
      try {
        await client.cancelOrder(resolvedPos.external_pos_id, {
          externalStoreId: resolvedPos.external_store_id,
        });
      } catch (e) {
        if (e instanceof MpQrError && (e.status === 404 || e.status === 422)) {
          /* sin orden activa */
        } else if (e instanceof MpQrError) {
          this.logger.error(`iniciar cancel prev ${e.status} ${e.code}`);
        }
      }
    }

    const notificationUrl = buildMpQrWebhookNotificationUrl(
      this.config,
      tenantId,
      comp.sucursalId,
    );
    if (!notificationUrl) {
      throw new BadRequestException(
        'No se pudo armar la URL del webhook. Configurá PUBLIC_APP_BASE_URL con la URL pública del backend Nest.',
      );
    }

    const tenantRow = await this.tenantRepo.findOne({
      where: { id: tenantId },
      select: ['nombre'],
    });
    const tenantNombre = tenantRow?.nombre?.trim() || 'Comercio';
    const title = `Venta #${comp.numeroOrden ?? comp.numero ?? ''}`;
    const orderDescription = `${title} - ${tenantNombre}`;

    const payload = {
      external_reference: comprobanteId,
      title,
      description: orderDescription,
      notification_url: notificationUrl,
      total_amount: totalPesos,
      items: [
        {
          title,
          description: 'Cobro POS Nexus',
          unit_price: totalPesos,
          quantity: 1,
          unit_measure: 'unit',
          total_amount: totalPesos,
        },
      ],
    };

    try {
      await client.createOrder(resolvedPos.external_pos_id, payload, {
        externalStoreId: resolvedPos.external_store_id,
      });

      comp.estado = EstadoComprobante.pendiente_qr;
      comp.mpQrCanceladoAt = null;
      comp.mpQrPagoHuerfano = false;
      try {
        await this.comprobanteRepo.save(comp);
      } catch (dbErr) {
        this.logger.error('iniciar DB save', dbErr);
        try {
          await client.cancelOrder(resolvedPos.external_pos_id, {
            externalStoreId: resolvedPos.external_store_id,
          });
        } catch {
          /* noop */
        }
        throw new BadRequestException('No se pudo guardar el estado del comprobante');
      }

      return {
        estado: EstadoComprobante.pendiente_qr,
        monto_terminal_pesos: totalPesos,
      };
    } catch (err) {
      throw mapMpQrErrorToHttpException(err);
    }
  }

  async cancelar(comprobanteId: string, liberarQr = false) {
    await this.mpQrConfigService.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const comp = await this.findComprobante(comprobanteId, tenantId);

    if (comp.estado !== EstadoComprobante.pendiente_qr && !liberarQr) {
      throw new BadRequestException('El comprobante no está esperando pago QR');
    }

    if (!comp.sucursalId) {
      throw new BadRequestException('Configuración de MP QR incompleta');
    }

    const secrets = await this.mpQrConfigService.loadSecretsForSucursal(comp.sucursalId);
    if (!secrets?.accessToken || !secrets.userId?.trim() || !secrets.externalPosId?.trim()) {
      throw new BadRequestException('Configuración de MP QR incompleta');
    }

    const userId = secrets.userId.trim();
    const resolvedPos = await resolveMpQrPos({
      access_token: secrets.accessToken,
      user_id: userId,
      external_pos_id: secrets.externalPosId.trim(),
    }).catch(() => ({
      external_pos_id: secrets.externalPosId!.trim(),
      external_store_id: null,
      resolved_from_internal_id: false,
    }));

    const client = this.clientFactory.create(secrets.accessToken, userId);
    try {
      await client.cancelOrder(resolvedPos.external_pos_id, {
        externalStoreId: resolvedPos.external_store_id,
        orderId: comp.mpQrOrderId,
      });
    } catch (e) {
      if (
        e instanceof MpQrError &&
        (e.status === 404 ||
          e.code === 'in_store_order_delete_error' ||
          e.code === 'instore_order_locked_error' ||
          e.code === 'order_already_canceled')
      ) {
        /* idempotencia */
      } else if (e instanceof MpQrError) {
        const status =
          e.status === 401
            ? HttpStatus.BAD_REQUEST
            : e.status === 409 ||
                e.code === 'in_store_order_delete_error' ||
                e.code === 'instore_order_locked_error'
              ? HttpStatus.CONFLICT
              : HttpStatus.SERVICE_UNAVAILABLE;
        throw new HttpException({ error: e.message, mp_error_code: e.code }, status);
      } else {
        throw mapMpQrErrorToHttpException(e);
      }
    }

    comp.estado = EstadoComprobante.borrador;
    comp.mpQrOrderId = null;
    comp.mpQrCanceladoAt = new Date();
    await this.comprobanteRepo.save(comp);

    return { mensaje: 'Cobro cancelado' };
  }

  async getEstado(comprobanteId: string) {
    await this.mpQrConfigService.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const comp = await this.findComprobante(comprobanteId, tenantId);
    const cajaExtras = await this.buildCajaExtras(comp);

    if (comp.estado !== EstadoComprobante.pendiente_qr) {
      return {
        estado: comp.estado,
        estado_nexus: comp.estado,
        tipo: comp.tipo,
        cae: comp.cae ?? null,
        numero: comp.numero,
        pdf_url: comp.pdfUrl,
        mp_qr_payment_id: comp.mpQrPaymentId,
        ultimo_error_arca_mensaje: comp.ultimoErrorArcaMensaje ?? null,
        ultimo_error_arca_codigo: comp.ultimoErrorArcaCodigo ?? null,
        payment: comp.mpQrPaymentId != null ? { id: comp.mpQrPaymentId } : undefined,
        ...cajaExtras,
      };
    }

    if (!comp.sucursalId) {
      throw new BadRequestException('Configuración de MP QR incompleta');
    }

    const secrets = await this.mpQrConfigService.loadSecretsForSucursal(comp.sucursalId);
    if (!secrets?.accessToken || !secrets.userId?.trim() || !secrets.externalPosId?.trim()) {
      throw new BadRequestException('Configuración de MP QR incompleta');
    }

    const userId = secrets.userId.trim();
    const resolvedPos = await resolveMpQrExternalPosId({
      access_token: secrets.accessToken,
      user_id: userId,
      external_pos_id: secrets.externalPosId.trim(),
    }).catch(() => ({ external_pos_id: secrets.externalPosId!.trim(), resolved_from_internal_id: false }));

    const client = this.clientFactory.create(secrets.accessToken, userId);

    try {
      const ordenActiva = await client.getOrder(resolvedPos.external_pos_id);
      return {
        estado: EstadoComprobante.pendiente_qr,
        estado_nexus: EstadoComprobante.pendiente_qr,
        numero: comp.numero,
        pdf_url: comp.pdfUrl,
        orden_activa: ordenActiva,
      };
    } catch (e) {
      if (e instanceof MpQrError && e.status === 404) {
        if (comp.mpQrOrderId) {
          try {
            const mo = await client.getMerchantOrder(comp.mpQrOrderId);
            const comp2 = await this.comprobanteRepo.findOne({ where: { id: comprobanteId, tenantId } });
            const row = comp2 ?? comp;
            const extras = await this.buildCajaExtras(row);
            return {
              estado: row.estado,
              estado_nexus: row.estado,
              tipo: row.tipo,
              cae: row.cae ?? null,
              numero: row.numero,
              pdf_url: row.pdfUrl,
              mp_qr_payment_id: row.mpQrPaymentId ?? null,
              ultimo_error_arca_mensaje: row.ultimoErrorArcaMensaje ?? null,
              ultimo_error_arca_codigo: row.ultimoErrorArcaCodigo ?? null,
              payment: row.mpQrPaymentId != null ? { id: row.mpQrPaymentId } : undefined,
              merchant_order: mo,
              ...extras,
            };
          } catch (e2) {
            if (e2 instanceof MpQrError) {
              throw new HttpException({ error: e2.message }, HttpStatus.SERVICE_UNAVAILABLE);
            }
          }
        }
        const extras = await this.buildCajaExtras(comp);
        return {
          estado: comp.estado,
          estado_nexus: comp.estado,
          tipo: comp.tipo,
          cae: comp.cae ?? null,
          numero: comp.numero,
          pdf_url: comp.pdfUrl,
          merchant_order: null,
          ...extras,
        };
      }
      if (e instanceof MpQrError) {
        throw new HttpException({ error: e.message }, HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw new BadRequestException('Error al consultar MP');
    }
  }

  async sincronizar(comprobanteId: string) {
    await this.mpQrConfigService.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    this.assertSyncRateLimit(comprobanteId);

    const comp = await this.comprobanteRepo.findOne({ where: { id: comprobanteId, tenantId } });
    if (!comp) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    const cajaExtras = await this.buildCajaExtras(comp);

    if (comprobanteEsVentaMpQrCompletaEntity(comp)) {
      return {
        estado: comp.estado,
        estado_nexus: comp.estado,
        mp_cobro_completo: true,
        proceso_qr_ejecutado: false,
        numero: comp.numero,
        pdf_url: comp.pdfUrl,
        mp_qr_payment_id: comp.mpQrPaymentId,
        payment: comp.mpQrPaymentId != null ? { id: comp.mpQrPaymentId } : undefined,
        ...cajaExtras,
      };
    }

    if (comp.estado !== EstadoComprobante.pendiente_qr) {
      if (comprobanteTienePagoMpQrEntity(comp) && !comprobanteEsVentaMpQrCompletaEntity(comp)) {
        const mensaje = this.mensajePagoRegistradoIncompleto(comp);
        return {
          estado: comp.estado,
          estado_nexus: comp.estado,
          mp_cobro_completo: false,
          pago_mp_registrado: true,
          proceso_qr_ejecutado: false,
          mensaje,
          numero: comp.numero,
          cae: comp.cae,
          pdf_url: comp.pdfUrl,
          mp_qr_payment_id: comp.mpQrPaymentId,
          ...cajaExtras,
        };
      }
      throw new BadRequestException({
        error: 'No hay cobro QR pendiente de sincronizar para este comprobante',
        estado: comp.estado,
        estado_nexus: comp.estado,
        proceso_qr_ejecutado: false,
        ...cajaExtras,
      });
    }

    if (!comp.sucursalId) {
      throw new BadRequestException('Configuración de MP QR incompleta');
    }

    const secrets = await this.mpQrConfigService.loadSecretsForSucursal(comp.sucursalId);
    if (!secrets?.accessToken || !secrets.userId?.trim() || !secrets.externalPosId?.trim()) {
      throw new BadRequestException('Configuración de MP QR incompleta');
    }

    const userId = secrets.userId.trim();
    const resolvedPos = await resolveMpQrPos({
      access_token: secrets.accessToken,
      user_id: userId,
      external_pos_id: secrets.externalPosId.trim(),
    }).catch(() => ({
      external_pos_id: secrets.externalPosId!.trim(),
      external_store_id: null,
      resolved_from_internal_id: false,
    }));

    const client = this.clientFactory.create(secrets.accessToken, userId);
    let procesoQrEjecutado = false;

    try {
      const ordenActiva = await client.getOrder(resolvedPos.external_pos_id, {
        externalStoreId: resolvedPos.external_store_id,
      });
      return {
        estado: EstadoComprobante.pendiente_qr,
        estado_nexus: EstadoComprobante.pendiente_qr,
        proceso_qr_ejecutado: false,
        numero: comp.numero,
        pdf_url: comp.pdfUrl,
        orden_activa: ordenActiva,
      };
    } catch (e) {
      const merchantOrderIdFallback = comp.mpQrOrderId;
      const puedeFallback =
        merchantOrderIdFallback != null &&
        e instanceof MpQrError &&
        (e.status === 403 || e.status === 404 || e.status === 405 || e.status === 429 || e.status >= 500);

      if (puedeFallback && merchantOrderIdFallback) {
        try {
          const mo = await client.getMerchantOrder(merchantOrderIdFallback);
          const payments = mo.payments ?? [];
          const totalOrden = Number(mo.total_amount ?? 0);
          const hayAprobado = montoAprobadoSuficiente(payments, totalOrden).ok;

          if (hayAprobado) {
            await this.webhookService.procesarNotificacionMpQrMerchantOrder({
              merchantOrderId: merchantOrderIdFallback,
              tenantId,
              sucursalId: comp.sucursalId,
            });
            procesoQrEjecutado = true;
          }

          const comp2 = await this.comprobanteRepo.findOne({ where: { id: comprobanteId, tenantId } });
          const row = comp2 ?? comp;
          const extras2 = await this.buildCajaExtras(row);

          if (comprobanteEsVentaMpQrCompletaEntity(row)) {
            return {
              estado: row.estado,
              estado_nexus: row.estado,
              mp_cobro_completo: true,
              proceso_qr_ejecutado: procesoQrEjecutado,
              numero: row.numero,
              pdf_url: row.pdfUrl,
              mp_qr_payment_id: row.mpQrPaymentId,
              payment: row.mpQrPaymentId != null ? { id: row.mpQrPaymentId } : undefined,
              ...extras2,
            };
          }

          return {
            estado: row.estado,
            estado_nexus: row.estado,
            proceso_qr_ejecutado: procesoQrEjecutado,
            numero: row.numero,
            pdf_url: row.pdfUrl,
            mp_qr_payment_id: row.mpQrPaymentId ?? null,
            ultimo_error_arca_mensaje: row.ultimoErrorArcaMensaje ?? null,
            ultimo_error_arca_codigo: row.ultimoErrorArcaCodigo ?? null,
            payment: row.mpQrPaymentId != null ? { id: row.mpQrPaymentId } : undefined,
            merchant_order: mo,
            ...extras2,
          };
        } catch (e2) {
          if (e2 instanceof MpQrError) {
            throw new HttpException({ error: e2.message }, HttpStatus.SERVICE_UNAVAILABLE);
          }
          throw e2;
        }
      }

      if (mpQrErrorEsConsultaOrdenNoDisponible(e)) {
        return respuestaSincronizarEsperandoQr({
          numero: comp.numero,
          pdf_url: comp.pdfUrl,
          ...cajaExtras,
        });
      }
      if (e instanceof MpQrError) {
        throw new HttpException({ error: e.message }, HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw new BadRequestException('Error al sincronizar con Mercado Pago');
    }
  }

  private mensajePagoRegistradoIncompleto(comp: Comprobante): string {
    const est = String(comp.estado);
    if (est === EstadoComprobante.pendiente_arca) {
      return 'El cobro con QR quedó registrado. Falta la autorización fiscal (CAE).';
    }
    if (est === EstadoComprobante.error_arca) {
      const u = comp.ultimoErrorArcaMensaje?.trim();
      return u
        ? `El cobro con QR quedó registrado pero la autorización fiscal falló: ${u}`
        : 'El cobro con QR quedó registrado pero la autorización fiscal falló.';
    }
    return 'El cobro con QR quedó registrado; el comprobante sigue en proceso.';
  }

  private async findComprobante(id: string, tenantId: string): Promise<Comprobante> {
    const comp = await this.comprobanteRepo.findOne({ where: { id, tenantId } });
    if (!comp) {
      throw new NotFoundException('Comprobante no encontrado');
    }
    return comp;
  }

  private assertSyncRateLimit(comprobanteId: string): void {
    const now = Date.now();
    const prev = this.ultimaSyncPorComprobante.get(comprobanteId) ?? 0;
    if (now - prev < SYNC_RATE_MS) {
      throw new HttpException(
        { error: 'Esperá unos segundos antes de volver a sincronizar' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.ultimaSyncPorComprobante.set(comprobanteId, now);
  }

  private async buildCajaExtras(comp: Comprobante): Promise<Record<string, unknown>> {
    if (!comp.cajaUuid) {
      const nc = comp.numeroCaja;
      return nc != null && Number.isFinite(nc) ? { numero_caja: nc } : {};
    }
    const caja = await this.cajaRepo.findOne({ where: { id: comp.cajaUuid } });
    const linea = caja ? lineaEtiquetaCajaFisica(caja.nombre, caja.numero) : null;
    const nc = comp.numeroCaja;
    return {
      ...(nc != null && Number.isFinite(nc) ? { numero_caja: nc } : {}),
      ...(linea ? { linea_caja_ticket: linea } : {}),
    };
  }
}
