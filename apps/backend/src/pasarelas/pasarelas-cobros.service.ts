import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AccessTokenPayload } from '../auth/interfaces/access-token-payload.interface';
import { TenantContext } from '../auth/tenant-context.service';
import { resolveAppRole } from '../auth/utils/resolve-app-role';
import { Caja } from '../caja/entities/caja.entity';
import { lineaEtiquetaCajaFisica } from '../caja/utils/caja-linea-etiqueta.util';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { MpPointError } from '../mp-point/errors/mp-point.error';
import { MpPointClientFactory } from '../mp-point/mp-point-client.factory';
import { MpPointEventBroadcastService } from '../mp-point/mp-point-event-broadcast.service';
import { MpPointWebhookService } from '../mp-point/mp-point-webhook.service';
import {
  comprobanteEsVentaMpPointCompleta,
  comprobanteTienePagoMpPoint,
} from '../mp-point/utils/mp-point-venta.util';
import { intentPointFinalizoConPagoId } from '../mp-point/utils/payment-v1.util';
import { MpQrError } from '../mp-qr/errors/mp-qr.error';
import { MpQrClientFactory } from '../mp-qr/mp-qr-client.factory';
import { MpQrEventBroadcastService } from '../mp-qr/mp-qr-event-broadcast.service';
import { MpQrWebhookService } from '../mp-qr/mp-qr-webhook.service';
import { resolveMpQrPos } from '../mp-qr/utils/resolve-mp-qr-pos.util';
import {
  comprobanteEsVentaMpQrCompletaEntity,
  comprobanteTienePagoMpQrEntity,
} from '../mp-qr/utils/mp-qr-venta.util';
import { montoAprobadoSuficiente } from '../mp-qr/utils/mp-qr-payment-v1.util';
import {
  mpQrErrorEsConsultaOrdenNoDisponible,
  respuestaSincronizarEsperandoQr,
} from '../mp-qr/utils/sincronizar-helpers.util';
import { PasarelaCaja } from './entities/pasarela-caja.entity';
import { PasarelaIntegracion } from './entities/pasarela-integracion.entity';
import { PasarelaTransaccion } from './entities/pasarela-transaccion.entity';
import { PasarelaPaymentAdaptersService } from './pasarela-payment-adapters.service';
import { PasarelasTransaccionesService } from './pasarelas-transacciones.service';
import { getPasarelaSecret, stringFromUnknown } from './utils/pasarela-secrets.util';
import {
  isUuid,
  positiveNumber,
  serializePasarelaTransaccion,
} from './utils/pasarela-transaccion.util';
import { LegacyFieldCryptoService } from '../common/crypto/legacy-field-crypto.service';

const SYNC_RATE_MS = 5000;

@Injectable()
export class PasarelasCobrosService {
  private readonly logger = new Logger(PasarelasCobrosService.name);
  private readonly ultimaSyncPorComprobante = new Map<string, number>();

  constructor(
    @InjectRepository(PasarelaIntegracion)
    private readonly integracionRepo: Repository<PasarelaIntegracion>,
    @InjectRepository(PasarelaCaja)
    private readonly pasarelaCajaRepo: Repository<PasarelaCaja>,
    @InjectRepository(PasarelaTransaccion)
    private readonly transaccionRepo: Repository<PasarelaTransaccion>,
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(ModuloConfig)
    private readonly moduloRepo: Repository<ModuloConfig>,
    private readonly tenantContext: TenantContext,
    private readonly paymentAdapters: PasarelaPaymentAdaptersService,
    private readonly transaccionesService: PasarelasTransaccionesService,
    private readonly fieldCrypto: LegacyFieldCryptoService,
    private readonly mpPointClientFactory: MpPointClientFactory,
    private readonly mpQrClientFactory: MpQrClientFactory,
    private readonly mpPointWebhookService: MpPointWebhookService,
    private readonly mpQrWebhookService: MpQrWebhookService,
    private readonly mpPointBroadcast: MpPointEventBroadcastService,
    private readonly mpQrBroadcast: MpQrEventBroadcastService,
  ) {}

  async iniciar(
    user: AccessTokenPayload,
    integracionId: string,
    comprobanteId: string,
    total: number,
  ) {
    await this.ensureFacturadorPos();
    if (resolveAppRole(user) === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden iniciar cobros.');
    }

    const tenantId = this.tenantContext.getTenantId();
    const comp = await this.comprobanteRepo.findOne({ where: { id: comprobanteId, tenantId } });
    if (!comp) throw new NotFoundException('Comprobante no encontrado');

    const integracion = await this.integracionRepo.findOne({
      where: { id: integracionId, tenantId },
    });
    if (!integracion) throw new NotFoundException('Integracion no encontrada');
    if (integracion.estado !== 'activa') {
      throw new BadRequestException('La integracion no esta activa');
    }
    if (String(integracion.sucursalId) !== String(comp.sucursalId)) {
      throw new BadRequestException('La integracion no pertenece a la sucursal del comprobante');
    }

    const validation = this.paymentAdapters.validateConfig(integracion);
    if (!validation.ok) throw new BadRequestException(validation.error);

    if (
      comp.estado !== EstadoComprobante.borrador &&
      !(integracion.tipo === 'mp_qr' && comp.estado === EstadoComprobante.pendiente_qr)
    ) {
      throw new BadRequestException(
        'Solo se puede cobrar una pasarela sobre un borrador o un QR en curso.',
      );
    }

    const totalDb = positiveNumber(comp.total);
    if (totalDb == null) {
      throw new BadRequestException('El borrador no tiene un total valido para cobrar');
    }
    if (Math.abs(Math.round(total * 100) - Math.round(totalDb * 100)) > 2) {
      this.logger.warn(
        `iniciar total body distinto comprobante=${comprobanteId} body=${total} db=${totalDb}`,
      );
    }

    const cajaId = isUuid(comp.cajaUuid) ? comp.cajaUuid!.trim() : null;
    if (!cajaId) {
      throw new BadRequestException(
        'La venta necesita una caja abierta para usar pasarelas externas.',
      );
    }

    const link = await this.pasarelaCajaRepo.findOne({
      where: { tenantId, cajaId, integracionId },
    });
    if (!link?.habilitado) {
      throw new ForbiddenException('La integracion no esta habilitada para esta caja.');
    }

    const tx = await this.transaccionesService.insertarActiva({
      tenantId,
      sucursalId: String(comp.sucursalId),
      cajaId,
      integracionId,
      comprobanteId,
      proveedor: integracion.proveedor,
      canal: integracion.canal,
      tipo: integracion.tipo,
      monto: totalDb,
      externalReference: comprobanteId,
    });

    const result = await this.paymentAdapters.createPayment({
      integracion,
      comprobante: comp,
      monto: totalDb,
      tenantId,
    });

    if (!result.ok) {
      await this.transaccionesService.marcar(tx.id, {
        estado: 'error',
        ultimoError: result.error,
        requestPayload: result.request_payload ?? null,
        responsePayload:
          result.response_payload ??
          ({ status: result.status, code: result.code ?? null, error: result.error } as Record<
            string,
            unknown
          >),
      });
      throw new HttpException(
        { error: result.error, code: result.code ?? null },
        result.status,
      );
    }

    try {
      Object.assign(comp, result.updateComprobante);
      await this.comprobanteRepo.save(comp);
    } catch (e) {
      await this.transaccionesService.marcar(tx.id, {
        estado: 'error',
        ultimoError: 'No se pudo guardar el estado del comprobante',
      });
      try {
        await this.paymentAdapters.cancelPayment({
          integracion,
          comprobante: { ...comp, ...result.updateComprobante },
          tenantId,
          externalOrderId: result.transaccion.external_order_id,
        });
      } catch {
        /* best-effort */
      }
      throw new InternalServerErrorException('No se pudo guardar el estado del comprobante');
    }

    await this.transaccionesService.marcar(tx.id, {
      estado: result.transaccion.estado,
      externalIntentId: result.transaccion.external_intent_id ?? null,
      externalOrderId: result.transaccion.external_order_id ?? null,
      externalReference: result.transaccion.external_reference ?? null,
      requestPayload: result.transaccion.request_payload ?? null,
      responsePayload: result.transaccion.response_payload ?? null,
    });

    return {
      ...result.response,
      transaccion_id: tx.id,
      pasarela_integracion_id: integracionId,
    };
  }

  async getEstado(transaccionId?: string, comprobanteId?: string) {
    await this.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();

    const qb = this.transaccionRepo
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .orderBy('t.created_at', 'DESC')
      .take(1);

    if (transaccionId) qb.andWhere('t.id = :id', { id: transaccionId });
    if (comprobanteId) qb.andWhere('t.comprobante_id = :comprobanteId', { comprobanteId });

    const tx = await qb.getOne();
    if (!tx) throw new NotFoundException('Transaccion no encontrada');

    return { transaccion: serializePasarelaTransaccion(tx) };
  }

  async cancelar(
    user: AccessTokenPayload,
    comprobanteId: string,
    integracionId?: string,
    liberarQr = false,
  ) {
    await this.ensureFacturadorPos();
    if (resolveAppRole(user) === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden cancelar cobros.');
    }

    const tenantId = this.tenantContext.getTenantId();
    const comp = await this.comprobanteRepo.findOne({ where: { id: comprobanteId, tenantId } });
    if (!comp) throw new NotFoundException('Comprobante no encontrado');

    const activos = this.transaccionesService.estadosActivos();
    let txQb = this.transaccionRepo
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.comprobante_id = :comprobanteId', { comprobanteId })
      .andWhere('t.estado IN (:...activos)', { activos })
      .orderBy('t.created_at', 'DESC')
      .take(1);
    if (integracionId) {
      txQb = txQb.andWhere('t.integracion_id = :integracionId', { integracionId });
    }
    const tx = await txQb.getOne();

    if (!tx) {
      if (!liberarQr || !integracionId) {
        throw new BadRequestException('No hay cobro activo de pasarela para cancelar');
      }
      return this.cancelarQrSinTransaccion(integracionId, comp, tenantId);
    }

    const integracion = await this.integracionRepo.findOne({
      where: { id: tx.integracionId ?? undefined, tenantId },
    });
    if (!integracion) throw new NotFoundException('Integracion no encontrada');

    const cancel = await this.paymentAdapters.cancelPayment({
      integracion,
      comprobante: {
        ...comp,
        mpQrOrderId: comp.mpQrOrderId ?? tx.externalOrderId,
      },
      tenantId,
      externalOrderId: tx.externalOrderId,
    });
    if (!cancel.ok) {
      throw new HttpException({ error: cancel.error }, cancel.status);
    }

    if (integracion.canal === 'terminal') {
      comp.estado = EstadoComprobante.borrador;
      comp.mpPointIntentId = null;
    } else {
      comp.estado = EstadoComprobante.borrador;
      comp.mpQrOrderId = null;
      comp.mpQrCanceladoAt = new Date();
    }
    await this.comprobanteRepo.save(comp);

    await this.transaccionesService.marcar(tx.id, {
      estado: 'cancelada',
      ultimoError: null,
    });

    if (integracion.canal === 'terminal') {
      void this.mpPointBroadcast.broadcast(comprobanteId, { estado: 'cancelado' }).catch(() => {});
    } else {
      void this.mpQrBroadcast
        .broadcast(comprobanteId, { estado: 'cancelado', payment_type: 'qr' })
        .catch(() => {});
    }

    return { mensaje: 'Cobro cancelado' };
  }

  async sincronizar(
    user: AccessTokenPayload,
    comprobanteId: string,
    integracionId?: string,
  ) {
    await this.ensureFacturadorPos();
    if (resolveAppRole(user) === 'visor') {
      throw new ForbiddenException('Los usuarios visor no pueden sincronizar cobros.');
    }

    const tenantId = this.tenantContext.getTenantId();
    const rateKey = `${integracionId || 'auto'}:${comprobanteId}`;
    const now = Date.now();
    const prev = this.ultimaSyncPorComprobante.get(rateKey) ?? 0;
    if (now - prev < SYNC_RATE_MS) {
      throw new HttpException(
        { error: 'Espera unos segundos antes de volver a sincronizar' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.ultimaSyncPorComprobante.set(rateKey, now);

    const comp = await this.comprobanteRepo.findOne({ where: { id: comprobanteId, tenantId } });
    if (!comp) throw new NotFoundException('Comprobante no encontrado');

    let txQb = this.transaccionRepo
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.comprobante_id = :comprobanteId', { comprobanteId })
      .orderBy('t.created_at', 'DESC')
      .take(1);
    if (integracionId) {
      txQb = txQb.andWhere('t.integracion_id = :integracionId', { integracionId });
    }
    const tx = await txQb.getOne();
    if (!tx) {
      throw new BadRequestException('No hay transaccion de pasarela para sincronizar');
    }

    const integracion = await this.integracionRepo.findOne({
      where: { id: tx.integracionId ?? undefined, tenantId },
    });
    if (!integracion) throw new NotFoundException('Integracion no encontrada');

    const extras = await this.buildCajaExtras(comp);
    const canal = integracion.canal === 'qr' ? 'qr' : 'terminal';

    if (canal === 'terminal' && comprobanteEsVentaMpPointCompleta(comp)) {
      return {
        estado_mp: 'FINISHED',
        estado_nexus: 'emitido',
        payment_type: null,
        mp_cobro_completo: true,
        proceso_posnet_ejecutado: false,
        numero: comp.numero,
        pdf_url: comp.pdfUrl ?? null,
        ...extras,
      };
    }
    if (canal === 'qr' && comprobanteEsVentaMpQrCompletaEntity(comp)) {
      return {
        estado: comp.estado,
        estado_nexus: comp.estado,
        mp_cobro_completo: true,
        proceso_qr_ejecutado: false,
        numero: comp.numero,
        pdf_url: comp.pdfUrl ?? null,
        mp_qr_payment_id: comp.mpQrPaymentId,
        payment: comp.mpQrPaymentId != null ? { id: comp.mpQrPaymentId } : undefined,
        ...extras,
      };
    }
    if (canal === 'terminal' && comprobanteTienePagoMpPoint(comp) && !comprobanteEsVentaMpPointCompleta(comp)) {
      return this.respuestaFiscalPendiente(comp, canal, extras);
    }
    if (canal === 'qr' && comprobanteTienePagoMpQrEntity(comp) && !comprobanteEsVentaMpQrCompletaEntity(comp)) {
      return this.respuestaFiscalPendiente(comp, canal, extras);
    }

    if (canal === 'terminal') {
      return this.sincronizarTerminal(comp, tenantId, extras);
    }
    return this.sincronizarQr(comp, integracion, tx, tenantId, extras);
  }

  private async cancelarQrSinTransaccion(
    integracionId: string,
    comp: Comprobante,
    tenantId: string,
  ) {
    const integracion = await this.integracionRepo.findOne({
      where: { id: integracionId, tenantId },
    });
    if (!integracion) throw new NotFoundException('Integracion no encontrada');
    if (String(integracion.sucursalId) !== String(comp.sucursalId)) {
      throw new BadRequestException('La integracion no pertenece a la sucursal del comprobante');
    }
    if (integracion.canal !== 'qr') {
      throw new BadRequestException('La pasarela QR no soporta cancelacion');
    }

    const cancel = await this.paymentAdapters.cancelPayment({
      integracion,
      comprobante: comp,
      tenantId,
    });
    if (!cancel.ok) {
      throw new HttpException({ error: cancel.error }, cancel.status);
    }

    comp.estado = EstadoComprobante.borrador;
    comp.mpQrOrderId = null;
    comp.mpQrCanceladoAt = new Date();
    await this.comprobanteRepo.save(comp);

    void this.mpQrBroadcast
      .broadcast(comp.id, { estado: 'cancelado', payment_type: 'qr' })
      .catch(() => {});

    return { mensaje: 'Cobro QR cancelado' };
  }

  private async sincronizarTerminal(comp: Comprobante, tenantId: string, extras: Record<string, unknown>) {
    if (!comp.mpPointIntentId) {
      throw new BadRequestException('No hay intent de terminal para sincronizar');
    }
    const deviceId = stringFromUnknown(
      (await this.integracionRepo.findOne({
        where: { tenantId, sucursalId: comp.sucursalId ?? undefined, tipo: 'mp_point', estado: 'activa' },
      }))?.configPublica?.device_id,
    );
    const integracion = await this.integracionRepo.findOne({
      where: { tenantId, sucursalId: comp.sucursalId ?? undefined, tipo: 'mp_point' },
      order: { updatedAt: 'DESC' },
    });
    const token = integracion
      ? getPasarelaSecret(this.fieldCrypto, integracion, 'access_token')
      : null;
    const device = deviceId ?? stringFromUnknown(integracion?.configPublica?.device_id);
    if (!token || !device) {
      throw new BadRequestException('Configuracion de terminal incompleta');
    }

    try {
      const client = this.mpPointClientFactory.create(token);
      const intent = await client.getPaymentIntent(device, comp.mpPointIntentId);
      let procesoPosnetEjecutado = false;

      if (
        comp.estado === EstadoComprobante.pendiente_posnet &&
        comp.mpPointPaymentId == null &&
        intentPointFinalizoConPagoId(intent)
      ) {
        await this.mpPointWebhookService.procesarNotificacionMpPointIntent({
          intentId: comp.mpPointIntentId,
        });
        procesoPosnetEjecutado = true;
      }

      const finalRow =
        (await this.comprobanteRepo.findOne({ where: { id: comp.id, tenantId } })) ?? comp;
      const extras2 = await this.buildCajaExtras(finalRow);

      if (comprobanteEsVentaMpPointCompleta(finalRow)) {
        return {
          estado_mp: 'FINISHED',
          estado_nexus: 'emitido',
          payment_type: null,
          mp_cobro_completo: true,
          proceso_posnet_ejecutado: procesoPosnetEjecutado,
          numero: finalRow.numero,
          pdf_url: finalRow.pdfUrl ?? null,
          ...extras2,
        };
      }

      return {
        estado_mp: intent.state,
        estado_nexus: finalRow.estado,
        payment_type: intent.payment?.type ?? null,
        proceso_posnet_ejecutado: procesoPosnetEjecutado,
        ...extras2,
      };
    } catch (e) {
      if (e instanceof MpPointError) {
        throw new HttpException(
          { error: e.message, mp_error_code: e.code },
          e.status >= 500 ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_REQUEST,
        );
      }
      this.logger.error('sincronizar terminal', e);
      throw new HttpException(
        { error: 'Error al sincronizar con la terminal' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private async sincronizarQr(
    comp: Comprobante,
    integracion: PasarelaIntegracion,
    tx: PasarelaTransaccion,
    tenantId: string,
    extras: Record<string, unknown>,
  ) {
    const token = getPasarelaSecret(this.fieldCrypto, integracion, 'access_token');
    const userId = stringFromUnknown(integracion.configPublica?.user_id);
    let externalPosId = stringFromUnknown(integracion.configPublica?.external_pos_id);
    let externalStoreId = stringFromUnknown(integracion.configPublica?.external_store_id);
    if (!token || !userId || !externalPosId) {
      throw new BadRequestException('Configuracion de QR incompleta');
    }

    try {
      const resolvedPos = await resolveMpQrPos({
        access_token: token,
        user_id: userId,
        external_pos_id: externalPosId,
        external_store_id: externalStoreId,
      }).catch(() => ({
        external_pos_id: externalPosId!,
        external_store_id: externalStoreId,
        resolved_from_internal_id: false,
      }));
      externalPosId = resolvedPos.external_pos_id;
      externalStoreId = resolvedPos.external_store_id;
      const client = this.mpQrClientFactory.create(token, userId);
      const ordenActiva = await client.getOrder(externalPosId, { externalStoreId: externalStoreId });
      return {
        estado: 'pendiente_qr',
        estado_nexus: 'pendiente_qr',
        proceso_qr_ejecutado: false,
        numero: comp.numero,
        pdf_url: comp.pdfUrl ?? null,
        orden_activa: ordenActiva,
      };
    } catch (e) {
      const merchantOrderId = comp.mpQrOrderId || tx.externalOrderId;
      const puedeFallback =
        merchantOrderId &&
        e instanceof MpQrError &&
        (e.status === 403 || e.status === 404 || e.status === 405 || e.status === 429 || e.status >= 500);

      if (puedeFallback) {
        try {
          const client = this.mpQrClientFactory.create(token, userId);
          const mo = await client.getMerchantOrder(merchantOrderId!);
          const hayAprobado = montoAprobadoSuficiente(mo.payments ?? [], Number(mo.total_amount ?? 0)).ok;
          let procesoQrEjecutado = false;
          if (hayAprobado) {
            await this.mpQrWebhookService.procesarNotificacionMpQrMerchantOrder({
              merchantOrderId: merchantOrderId!,
              tenantId,
              sucursalId: comp.sucursalId,
            });
            procesoQrEjecutado = true;
          }

          const row =
            (await this.comprobanteRepo.findOne({ where: { id: comp.id, tenantId } })) ?? comp;
          const extras2 = await this.buildCajaExtras(row);

          if (comprobanteEsVentaMpQrCompletaEntity(row)) {
            return {
              estado: row.estado,
              estado_nexus: row.estado,
              mp_cobro_completo: true,
              proceso_qr_ejecutado: procesoQrEjecutado,
              numero: row.numero,
              pdf_url: row.pdfUrl ?? null,
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
            pdf_url: row.pdfUrl ?? null,
            mp_qr_payment_id: row.mpQrPaymentId ?? null,
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
        const extras2 = await this.buildCajaExtras(comp);
        return respuestaSincronizarEsperandoQr({
          numero: comp.numero,
          pdf_url: comp.pdfUrl ?? null,
          ...extras2,
        });
      }
      if (e instanceof MpQrError) {
        throw new HttpException({ error: e.message }, HttpStatus.SERVICE_UNAVAILABLE);
      }
      this.logger.error('sincronizar qr', e);
      throw new HttpException({ error: 'Error al sincronizar QR' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private respuestaFiscalPendiente(
    comp: Comprobante,
    canal: 'qr' | 'terminal',
    extras: Record<string, unknown>,
  ) {
    const medio = canal === 'qr' ? 'QR' : 'Posnet';
    let mensaje = `El cobro con ${medio} quedo registrado; el comprobante sigue en proceso.`;
    if (comp.estado === EstadoComprobante.pendiente_arca) {
      mensaje = `El cobro con ${medio} quedo registrado. Falta la autorizacion fiscal (CAE).`;
    } else if (comp.estado === EstadoComprobante.error_arca) {
      const u = comp.ultimoErrorArcaMensaje?.trim();
      mensaje = u
        ? `El cobro con ${medio} quedo registrado pero la autorizacion fiscal fallo: ${u}`
        : `El cobro con ${medio} quedo registrado pero la autorizacion fiscal fallo.`;
    }
    return {
      estado: comp.estado,
      estado_nexus: comp.estado,
      estado_mp: canal === 'terminal' ? 'FINISHED' : undefined,
      payment_type: canal === 'qr' ? 'qr' : null,
      mp_cobro_completo: false,
      pago_mp_registrado: true,
      proceso_qr_ejecutado: false,
      proceso_posnet_ejecutado: false,
      mensaje,
      numero: comp.numero,
      cae: comp.cae ?? null,
      pdf_url: comp.pdfUrl ?? null,
      mp_qr_payment_id: comp.mpQrPaymentId ?? null,
      mp_point_payment_id: comp.mpPointPaymentId ?? null,
      ...extras,
    };
  }

  private async buildCajaExtras(comp: Comprobante): Promise<Record<string, unknown>> {
    const extras: Record<string, unknown> = {};
    if (comp.numeroCaja != null && Number.isFinite(comp.numeroCaja)) {
      extras.numero_caja = comp.numeroCaja;
    }
    if (comp.cajaUuid) {
      const caja = await this.cajaRepo.findOne({
        where: { id: comp.cajaUuid },
        select: ['numero', 'nombre'],
      });
      if (caja) {
        extras.linea_caja_ticket = lineaEtiquetaCajaFisica(caja.nombre, caja.numero);
      }
    }
    return extras;
  }

  private async ensureFacturadorPos(): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const mod = await this.moduloRepo.findOne({ where: { tenantId } });
    if (!mod?.facturadorPos) {
      throw new ForbiddenException('El modulo POS no esta habilitado para este negocio.');
    }
  }
}
