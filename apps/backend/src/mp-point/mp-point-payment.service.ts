import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Caja } from '../caja/entities/caja.entity';
import { lineaEtiquetaCajaFisica } from '../caja/utils/caja-linea-etiqueta.util';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { MpPointError } from './errors/mp-point.error';
import { MpPointClientFactory } from './mp-point-client.factory';
import { MpPointConfigService } from './mp-point-config.service';
import type { MpPointClient } from './types/mp-point.types';
import { mapMpPointErrorToHttpException } from './utils/mp-point-error.mapper';
import {
  comprobanteEsVentaMpPointCompleta,
  comprobanteTienePagoMpPoint,
} from './utils/mp-point-venta.util';
import { MpPointConfig } from './entities/mp-point-config.entity';
import { MpPointWebhookService } from './mp-point-webhook.service';
import { intentPointFinalizoConPagoId } from './utils/payment-v1.util';

const ESTADO_POLL_RATE_MS = 5000;
const SYNC_RATE_MS = 5000;

@Injectable()
export class MpPointPaymentService {
  private readonly logger = new Logger(MpPointPaymentService.name);
  private readonly ultimaConsultaPorComprobante = new Map<string, number>();
  private readonly ultimaSyncPorComprobante = new Map<string, number>();

  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(MpPointConfig)
    private readonly mpConfigRepo: Repository<MpPointConfig>,
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    private readonly tenantContext: TenantContext,
    private readonly sucursalContext: SucursalContext,
    private readonly mpPointConfigService: MpPointConfigService,
    private readonly clientFactory: MpPointClientFactory,
    private readonly webhookService: MpPointWebhookService,
  ) {}

  async iniciar(comprobanteId: string, totalBody: number) {
    await this.mpPointConfigService.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const comp = await this.findComprobante(comprobanteId, tenantId);

    if (comp.estado !== EstadoComprobante.borrador) {
      throw new BadRequestException(
        'Solo se puede cobrar con terminal sobre un comprobante en borrador (cre├í la venta como borrador antes de cobrar).',
      );
    }

    const totalDb = Number(comp.total);
    if (!Number.isFinite(totalDb) || totalDb <= 0) {
      throw new BadRequestException('El borrador no tiene un total v├ílido para cobrar en terminal');
    }

    const centsCliente = Math.round(totalBody * 100);
    const centsDb = Math.round(totalDb * 100);
    if (Math.abs(centsCliente - centsDb) > 2) {
      this.logger.warn(
        `iniciar_total_body_distinto_borrador comprobante=${comprobanteId} body=${totalBody} db=${totalDb}`,
      );
    }

    if (!comp.sucursalId) {
      throw new BadRequestException('El comprobante no tiene sucursal asociada');
    }

    const { client, deviceId } = await this.resolveClient(comp.sucursalId);

    if (comp.mpPointIntentId) {
      await this.tryCancelPreviousIntent(client, deviceId, comp.mpPointIntentId);
    }

    const checkDevice = await client.listDevices();
    const dev = checkDevice.find((d) => d.id === deviceId);
    if (dev?.operating_mode === 'STANDALONE') {
      throw new BadRequestException({
        error:
          'La terminal est├í en modo aut├│nomo (STANDALONE). Cambiala a modo PDV desde la app de Mercado Pago.',
        mp_error_code: 'standalone_mode',
      });
    }

    try {
      const intent = await client.createPaymentIntent(deviceId, {
        amount: centsDb,
        additional_info: {
          external_reference: comprobanteId,
          print_on_terminal: true,
        },
      });

      this.logger.log(
        `iniciar_intent_creado comprobante=${comprobanteId} intent=${intent.id} cents=${centsDb}`,
      );

      comp.mpPointIntentId = intent.id;
      comp.estado = EstadoComprobante.pendiente_posnet;
      try {
        await this.comprobanteRepo.save(comp);
        await this.mpConfigRepo.update(
          { tenantId, sucursalId: comp.sucursalId },
          { lastPaymentIntentId: intent.id },
        );
      } catch (dbErr) {
        this.logger.error(`iniciar DB save failed comprobante=${comprobanteId}`, dbErr);
        try {
          await client.cancelPaymentIntent(deviceId, intent.id);
        } catch {
          /* noop */
        }
        throw new BadRequestException('No se pudo guardar el intent');
      }

      return {
        intent_id: intent.id,
        estado: EstadoComprobante.pendiente_posnet,
        monto_terminal_pesos: totalDb,
      };
    } catch (err) {
      throw mapMpPointErrorToHttpException(err);
    }
  }

  async cancelar(comprobanteId: string) {
    await this.mpPointConfigService.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    const comp = await this.findComprobante(comprobanteId, tenantId);

    if (comp.estado !== EstadoComprobante.pendiente_posnet || !comp.mpPointIntentId) {
      throw new BadRequestException('No hay cobro pendiente en terminal para este comprobante');
    }

    if (!comp.sucursalId) {
      throw new BadRequestException('El comprobante no tiene sucursal asociada');
    }

    const { client, deviceId } = await this.resolveClient(comp.sucursalId, { requireHabilitado: false });
    const intentId = comp.mpPointIntentId;

    try {
      await client.cancelPaymentIntent(deviceId, intentId);
    } catch (err) {
      if (err instanceof MpPointError) {
        if (err.status === 422 || err.status === 404) {
          /* idempotencia */
        } else if (err.status === 409) {
          throw new ConflictException('El pago ya est├í siendo procesado');
        } else {
          throw mapMpPointErrorToHttpException(err);
        }
      } else {
        throw mapMpPointErrorToHttpException(err);
      }
    }

    comp.estado = EstadoComprobante.borrador;
    comp.mpPointIntentId = null;
    await this.comprobanteRepo.save(comp);

    return { mensaje: 'Cobro cancelado' };
  }

  async sincronizar(comprobanteId: string) {
    await this.mpPointConfigService.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    this.assertSyncRateLimit(comprobanteId);

    const comp = await this.comprobanteRepo.findOne({
      where: { id: comprobanteId, tenantId },
    });
    if (!comp) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    const cajaExtras = await this.buildCajaExtras(comp);

    if (comprobanteEsVentaMpPointCompleta(comp)) {
      return {
        estado_mp: 'FINISHED' as const,
        estado_nexus: 'emitido' as const,
        payment_type: null,
        mp_cobro_completo: true,
        proceso_posnet_ejecutado: false,
        numero: comp.numero,
        pdf_url: comp.pdfUrl,
        ...cajaExtras,
      };
    }

    if (!comp.mpPointIntentId) {
      if (comp.estado === EstadoComprobante.pendiente_posnet) {
        throw new BadRequestException(
          'Este comprobante qued├│ pendiente de Posnet sin intent asociado. Cancel├í e inici├í de nuevo, o contact├í soporte.',
        );
      }

      if (comprobanteTienePagoMpPoint(comp) && !comprobanteEsVentaMpPointCompleta(comp)) {
        const mensaje = this.mensajePagoRegistradoIncompleto(comp.estado, comp.ultimoErrorArcaMensaje);
        return {
          estado_mp: 'FINISHED' as const,
          estado_nexus: comp.estado,
          payment_type: null,
          mp_cobro_completo: false,
          pago_mp_registrado: true,
          proceso_posnet_ejecutado: false,
          mensaje,
          numero: comp.numero,
          cae: comp.cae,
          pdf_url: comp.pdfUrl,
          ...cajaExtras,
        };
      }

      throw new BadRequestException('No hay cobro pendiente para este comprobante');
    }

    if (!comp.sucursalId) {
      throw new BadRequestException('Configuraci├│n de MP Point incompleta');
    }

    const { client, deviceId } = await this.resolveClient(comp.sucursalId, { requireHabilitado: false });

    try {
      const intent = await client.getPaymentIntent(deviceId, comp.mpPointIntentId);
      const paymentType = intent.payment?.type ?? null;
      let procesoPosnetEjecutado = false;

      if (
        comp.estado === EstadoComprobante.pendiente_posnet &&
        comp.mpPointPaymentId == null &&
        intentPointFinalizoConPagoId(intent)
      ) {
        await this.webhookService.procesarNotificacionMpPointIntent({
          intentId: comp.mpPointIntentId,
        });
        procesoPosnetEjecutado = true;
      }

      const compPost = await this.comprobanteRepo.findOne({
        where: { id: comprobanteId, tenantId },
      });
      const finalRow = compPost ?? comp;

      if (finalRow && comprobanteEsVentaMpPointCompleta(finalRow)) {
        const postExtras = await this.buildCajaExtras(finalRow);
        return {
          estado_mp: 'FINISHED' as const,
          estado_nexus: 'emitido' as const,
          payment_type: null,
          mp_cobro_completo: true,
          proceso_posnet_ejecutado: procesoPosnetEjecutado,
          numero: finalRow.numero,
          pdf_url: finalRow.pdfUrl,
          ...postExtras,
        };
      }

      return {
        estado_mp: intent.state,
        estado_nexus: finalRow.estado ?? comp.estado,
        payment_type: paymentType,
        proceso_posnet_ejecutado: procesoPosnetEjecutado,
      };
    } catch (err) {
      throw mapMpPointErrorToHttpException(err);
    }
  }

  async getEstado(comprobanteId: string) {
    await this.mpPointConfigService.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();
    this.assertPollRateLimit(comprobanteId);

    const comp = await this.comprobanteRepo.findOne({
      where: { id: comprobanteId, tenantId },
    });
    if (!comp) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    const cajaExtras = await this.buildCajaExtras(comp);

    if (comprobanteEsVentaMpPointCompleta(comp)) {
      return {
        estado_mp: 'FINISHED' as const,
        estado_nexus: 'emitido' as const,
        payment_type: null,
        mp_cobro_completo: true,
        numero: comp.numero,
        pdf_url: comp.pdfUrl,
        ...cajaExtras,
      };
    }

    if (!comp.mpPointIntentId) {
      if (comp.estado === EstadoComprobante.pendiente_posnet) {
        throw new BadRequestException(
          'Este comprobante qued├│ pendiente de Posnet sin intent asociado. Cancel├í e inici├í de nuevo, o contact├í soporte.',
        );
      }

      if (comprobanteTienePagoMpPoint(comp) && !comprobanteEsVentaMpPointCompleta(comp)) {
        const mensaje = this.mensajePagoRegistradoIncompleto(comp.estado, comp.ultimoErrorArcaMensaje);
        return {
          estado_mp: 'FINISHED' as const,
          estado_nexus: comp.estado,
          payment_type: null,
          mp_cobro_completo: false,
          pago_mp_registrado: true,
          mensaje,
          numero: comp.numero,
          cae: comp.cae,
          pdf_url: comp.pdfUrl,
          ...cajaExtras,
        };
      }

      throw new BadRequestException('No hay cobro pendiente para este comprobante');
    }

    if (!comp.sucursalId) {
      throw new BadRequestException('Configuraci├│n de MP Point incompleta');
    }

    const { client, deviceId } = await this.resolveClient(comp.sucursalId, { requireHabilitado: false });

    try {
      const intent = await client.getPaymentIntent(deviceId, comp.mpPointIntentId);
      return {
        estado_mp: intent.state,
        estado_nexus: comp.estado,
        payment_type: intent.payment?.type ?? null,
      };
    } catch (err) {
      throw mapMpPointErrorToHttpException(err);
    }
  }

  async getPendienteRecuperacion() {
    await this.mpPointConfigService.ensureFacturadorPos();
    const tenantId = this.tenantContext.getTenantId();

    const comp = await this.comprobanteRepo.findOne({
      where: { tenantId, estado: EstadoComprobante.pendiente_posnet },
      order: { updatedAt: 'DESC' },
    });

    if (!comp?.mpPointIntentId) {
      return { comprobante_id: null };
    }

    return {
      comprobante_id: comp.id,
      total: Number(comp.total),
      intent_id: comp.mpPointIntentId,
    };
  }

  async listDevices(sucursalIdParam?: string) {
    await this.mpPointConfigService.ensureFacturadorPos();
    const sucursalId = await this.resolveSucursalIdForQuery(sucursalIdParam);
    const secrets = await this.mpPointConfigService.loadSecretsForSucursal(sucursalId);

    if (!secrets || secrets.habilitado === false) {
      throw new ForbiddenException('Mercado Pago Point no est├í habilitado');
    }
    if (!secrets.accessToken) {
      throw new BadRequestException('Token de MP no configurado');
    }

    const client = this.clientFactory.create(secrets.accessToken);
    try {
      const devices = await client.listDevices();
      const list = devices
        .filter((d) => Boolean(String(d.id ?? '').trim()))
        .map((d) => ({
          id: d.id,
          name: d.name ?? d.external_pos_id,
          operating_mode: d.operating_mode,
          external_pos_id: d.external_pos_id,
          en_modo_standalone: d.operating_mode === 'STANDALONE',
        }));

      const cantidadStandalone = list.filter((d) => d.en_modo_standalone).length;
      return {
        devices: list,
        ...(cantidadStandalone > 0 && {
          cantidad_standalone: cantidadStandalone,
          advertencia_standalone:
            'Hay terminales en modo aut├│nomo (STANDALONE). Cambialas a modo PDV desde la app de Mercado Pago para cobrar desde el POS.',
        }),
      };
    } catch (err) {
      throw mapMpPointErrorToHttpException(err);
    }
  }

  private async resolveSucursalIdForQuery(sucursalIdParam?: string): Promise<string> {
    const fromQuery = sucursalIdParam?.trim();
    if (fromQuery) return fromQuery;
    const resolved = await this.sucursalContext.resolveSucursalId();
    if (!resolved) {
      throw new BadRequestException('No hay sucursal activa');
    }
    return resolved;
  }

  private async findComprobante(id: string, tenantId: string): Promise<Comprobante> {
    const comp = await this.comprobanteRepo.findOne({ where: { id, tenantId } });
    if (!comp) {
      throw new NotFoundException('Comprobante no encontrado');
    }
    return comp;
  }

  private async resolveClient(
    sucursalId: string,
    opts?: { requireHabilitado?: boolean },
  ): Promise<{ client: MpPointClient; deviceId: string }> {
    const requireHabilitado = opts?.requireHabilitado !== false;
    const secrets = await this.mpPointConfigService.loadSecretsForSucursal(sucursalId);
    if (
      !secrets?.deviceId ||
      !secrets.accessToken ||
      (requireHabilitado && secrets.habilitado === false)
    ) {
      throw new BadRequestException('Configuraci├│n de MP Point incompleta');
    }
    return {
      client: this.clientFactory.create(secrets.accessToken),
      deviceId: secrets.deviceId,
    };
  }

  private async tryCancelPreviousIntent(
    client: MpPointClient,
    deviceId: string,
    intentId: string,
  ): Promise<void> {
    try {
      const prev = await client.getPaymentIntent(deviceId, intentId);
      if (prev.state === 'OPEN' || prev.state === 'ON_TERMINAL' || prev.state === 'PROCESSING') {
        await client.cancelPaymentIntent(deviceId, intentId);
      }
    } catch (err) {
      if (err instanceof MpPointError && (err.status === 422 || err.status === 404)) {
        return;
      }
      if (err instanceof MpPointError) {
        this.logger.warn(`cancel prev intent ${err.status} ${err.code}`);
      }
    }
  }

  private assertSyncRateLimit(comprobanteId: string): void {
    const now = Date.now();
    const prev = this.ultimaSyncPorComprobante.get(comprobanteId) ?? 0;
    if (now - prev < SYNC_RATE_MS) {
      throw new HttpException(
        'Esper├í unos segundos antes de volver a sincronizar',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.ultimaSyncPorComprobante.set(comprobanteId, now);
  }

  private assertPollRateLimit(comprobanteId: string): void {
    const now = Date.now();
    const prev = this.ultimaConsultaPorComprobante.get(comprobanteId) ?? 0;
    if (now - prev < ESTADO_POLL_RATE_MS) {
      throw new HttpException('Esper├í unos segundos antes de volver a consultar', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.ultimaConsultaPorComprobante.set(comprobanteId, now);
  }

  private async buildCajaExtras(comp: Comprobante): Promise<{
    numero_caja?: number;
    linea_caja_ticket?: string;
  }> {
    const extras: { numero_caja?: number; linea_caja_ticket?: string } = {};
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

  private mensajePagoRegistradoIncompleto(estado: string, ultimoErrorArca: string | null): string {
    if (estado === EstadoComprobante.pendiente_arca) {
      return 'El cobro con Posnet qued├│ registrado. Falta la autorizaci├│n fiscal (CAE). Pod├®s reintentar desde Facturaci├│n o esperar unos segundos y volver a consultar.';
    }
    if (estado === EstadoComprobante.error_arca) {
      const u = ultimoErrorArca?.trim();
      return u
        ? `El cobro con Posnet qued├│ registrado pero la autorizaci├│n fiscal fall├│: ${u}`
        : 'El cobro con Posnet qued├│ registrado pero la autorizaci├│n fiscal fall├│. Revis├í Facturaci├│n / bandeja ARCA o reintent├í la emisi├│n.';
    }
    if (estado === EstadoComprobante.emitido) {
      return 'El cobro qued├│ registrado; el comprobante fiscal a├║n no cumple los requisitos de cierre (verific├í CAE y datos). Consult├í en Facturaci├│n.';
    }
    return 'El cobro con Posnet qued├│ registrado; el comprobante sigue en proceso. Reconsult├í en unos segundos o abr├¡ el detalle en Facturaci├│n.';
  }
}
