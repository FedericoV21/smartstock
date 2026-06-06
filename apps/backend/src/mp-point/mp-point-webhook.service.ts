import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { FacturacionService } from '../facturacion/facturacion.service';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { tipoComprobanteRequiereCaeAfip } from '../facturacion/utils/comprobante-void.rules';
import { Usuario } from '../users/entities/usuario.entity';
import { MpPointClientFactory } from './mp-point-client.factory';
import { MpPointConfigService } from './mp-point-config.service';
import { MpPointEventBroadcastService } from './mp-point-event-broadcast.service';
import { MpPointConfig } from './entities/mp-point-config.entity';
import type { MpPointPaymentIntent } from './types/mp-point.types';
import { buildEmitDtoFromBorrador } from './utils/borrador-body.util';
import { mpPointIntentIndicaCobroRechazadoExplicito } from './utils/payment-intent-aprobado.util';
import {
  fetchMercadoPagoPaymentV1,
  intentPointFinalizoConPagoId,
  pagoV1AunProcesandose,
  pagoV1FueRechazadoOAnulado,
  pagoV1PermiteEmitirComprobante,
} from './utils/payment-v1.util';
import { verifyMercadoPagoWebhookSignature } from './utils/webhook-signature.util';

const REINTENTOS_INTENT = 12;
const PAUSA_MS = 1200;

function intentListoParaResolverPago(intent: MpPointPaymentIntent): boolean {
  if (intent.state === 'CANCELED' || intent.state === 'ERROR') return true;
  if (intent.state === 'FINISHED') {
    const n = intent.payment?.id == null ? 0 : Number(intent.payment.id);
    return Number.isFinite(n) && n > 0;
  }
  return false;
}

@Injectable()
export class MpPointWebhookService {
  private readonly logger = new Logger(MpPointWebhookService.name);

  constructor(
    @InjectRepository(Comprobante)
    private readonly comprobanteRepo: Repository<Comprobante>,
    @InjectRepository(ComprobanteItem)
    private readonly comprobanteItemRepo: Repository<ComprobanteItem>,
    @InjectRepository(MpPointConfig)
    private readonly mpConfigRepo: Repository<MpPointConfig>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    private readonly mpPointConfigService: MpPointConfigService,
    private readonly clientFactory: MpPointClientFactory,
    private readonly facturacionService: FacturacionService,
    private readonly broadcast: MpPointEventBroadcastService,
  ) {}

  async handleWebhookHttp(params: {
    intentId: string;
    bodyJson: unknown;
    xSignature: string | null;
    xRequestId: string | null;
    queryDataId: string | null;
  }): Promise<{ ok: true }> {
    const { intentId } = params;

    const comp = await this.comprobanteRepo.findOne({
      where: { mpPointIntentId: intentId },
      select: ['id', 'tenantId', 'sucursalId', 'mpPointIntentId'],
    });
    if (!comp?.sucursalId) {
      this.logger.warn(`webhook intent sin comprobante local intent=${intentId}`);
      return { ok: true };
    }

    const cfg = await this.mpConfigRepo.findOne({
      where: { tenantId: comp.tenantId, sucursalId: comp.sucursalId },
      select: ['webhookSecret'],
    });
    const secret = cfg?.webhookSecret?.trim();
    if (!secret) {
      this.logger.error(`webhook sin webhook_secret tenant=${comp.tenantId}`);
      throw new UnauthorizedException();
    }

    const okSig = verifyMercadoPagoWebhookSignature({
      bodyJson: params.bodyJson,
      xSignature: params.xSignature,
      xRequestId: params.xRequestId,
      queryDataId: params.queryDataId,
      secret,
    });
    if (!okSig) {
      throw new UnauthorizedException();
    }

    setImmediate(() => {
      void this.procesarNotificacionMpPointIntent({ intentId }).catch((e) => {
        this.logger.error(`webhook proceso async intent=${intentId}`, e);
      });
    });

    return { ok: true };
  }

  async procesarNotificacionMpPointIntent(params: { intentId: string }): Promise<void> {
    const { intentId } = params;

    const comp = await this.comprobanteRepo.findOne({
      where: { mpPointIntentId: intentId },
    });
    if (!comp) {
      this.logger.warn(`webhook comprobante no encontrado intent=${intentId}`);
      return;
    }

    if (comp.estado !== EstadoComprobante.pendiente_posnet) {
      this.logger.warn(
        `webhook comprobante no pendiente_posnet id=${comp.id} estado=${comp.estado}`,
      );
      return;
    }

    if (comp.mpPointPaymentId != null) {
      this.logger.log(`webhook skip ya tiene payment_id comprobante=${comp.id}`);
      return;
    }

    if (!comp.sucursalId) return;

    const secrets = await this.mpPointConfigService.loadSecretsForSucursal(comp.sucursalId);
    if (!secrets?.accessToken || !secrets.deviceId) {
      this.logger.error(`webhook sin config MP tenant=${comp.tenantId}`);
      return;
    }

    const client = this.clientFactory.create(secrets.accessToken);
    let intent: MpPointPaymentIntent;
    try {
      intent = await this.getPaymentIntentConReintento(client, secrets.deviceId, intentId);
    } catch (e) {
      this.logger.error(`webhook getPaymentIntent intent=${intentId}`, e);
      return;
    }

    const paymentId = intent.payment?.id;
    const idPagoNum = paymentId == null ? 0 : Number(paymentId);
    const payState = intent.payment?.state;

    if (intent.state === 'CANCELED') {
      await this.revertirABorradorYLimpiarIntent(comp.id, comp.tenantId);
      await this.broadcast.broadcast(comp.id, { estado: 'cancelado' });
      return;
    }

    if (intent.state === 'ERROR') {
      await this.revertirABorradorYLimpiarIntent(comp.id, comp.tenantId);
      await this.broadcast.broadcast(comp.id, { estado: 'error' });
      return;
    }

    if (intent.state === 'OPEN' || intent.state === 'ON_TERMINAL' || intent.state === 'PROCESSING') {
      return;
    }

    if (intentPointFinalizoConPagoId(intent) && idPagoNum > 0) {
      const v1 = await fetchMercadoPagoPaymentV1(secrets.accessToken, idPagoNum);

      if (v1 == null) {
        if (mpPointIntentIndicaCobroRechazadoExplicito(intent)) {
          await this.revertirABorradorYLimpiarIntent(comp.id, comp.tenantId);
          await this.broadcast.broadcast(comp.id, {
            estado: 'rechazado',
            motivo: String(payState ?? 'rechazado'),
          });
        }
        return;
      }

      if (pagoV1PermiteEmitirComprobante(v1)) {
        await this.emitirDesdePagoAprobado(comp, intentId, idPagoNum, intent);
        return;
      }

      if (pagoV1FueRechazadoOAnulado(v1)) {
        await this.revertirABorradorYLimpiarIntent(comp.id, comp.tenantId);
        const motivo = v1.statusDetail ? `${v1.status}:${v1.statusDetail}` : v1.status;
        await this.broadcast.broadcast(comp.id, { estado: 'rechazado', motivo });
        return;
      }

      if (v1.status === 'refunded' || v1.status === 'charged_back') {
        await this.revertirABorradorYLimpiarIntent(comp.id, comp.tenantId);
        await this.broadcast.broadcast(comp.id, { estado: 'rechazado', motivo: v1.status });
        return;
      }

      if (pagoV1AunProcesandose(v1)) return;

      this.logger.warn(`webhook status v1 no manejado intent=${intentId} status=${v1.status}`);
      return;
    }

    if (mpPointIntentIndicaCobroRechazadoExplicito(intent)) {
      await this.revertirABorradorYLimpiarIntent(comp.id, comp.tenantId);
      await this.broadcast.broadcast(comp.id, {
        estado: 'rechazado',
        motivo: String(payState ?? 'rechazado'),
      });
      return;
    }

    if (
      intent.state === 'FINISHED' &&
      (intent.payment == null || !idPagoNum || idPagoNum <= 0) &&
      !mpPointIntentIndicaCobroRechazadoExplicito(intent)
    ) {
      this.logger.warn(`webhook FINISHED sin payment.id tras reintentos intent=${intentId}`);
    }
  }

  private async emitirDesdePagoAprobado(
    comp: Comprobante,
    intentId: string,
    idPagoNum: number,
    intent: MpPointPaymentIntent,
  ): Promise<void> {
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
      this.logger.error(`webhook no se pudo armar body borrador=${comp.id}`);
      await this.broadcast.broadcast(comp.id, {
        estado: 'error',
        motivo: 'No se pudo armar el body desde el borrador',
      });
      return;
    }

    const result = await this.facturacionService.emitirDesdeBorradorMpPoint({
      tenantId: comp.tenantId,
      borradorId: comp.id,
      usuarioId,
      mpPointPaymentId: idPagoNum,
      dto,
    });

    if (!result.ok) {
      this.logger.error(`webhook emitir fall├│ comprobante=${comp.id} error=${result.error}`);
      await this.broadcast.broadcast(comp.id, { estado: 'error', motivo: result.error });
      return;
    }

    const emitido = result.data.data;
    const exigeCae = tipoComprobanteRequiereCaeAfip(String(emitido.tipo ?? ''));
    const caeStr = String(emitido.cae ?? '').trim();
    const fiscalOk =
      !exigeCae || (String(emitido.estado) === EstadoComprobante.emitido && caeStr.length > 0);

    if (!fiscalOk && exigeCae) {
      const motivo =
        String(emitido.estado) === EstadoComprobante.pendiente_arca
          ? 'El pago se acredit├│ pero la factura no tiene CAE (AFIP pendiente o sin respuesta).'
          : 'El pago se acredit├│ pero la factura no qued├│ autorizada con CAE.';
      await this.broadcast.broadcast(comp.id, {
        estado: 'error',
        motivo,
        payment_id: idPagoNum,
        payment_type: intent.payment?.type,
      });
      return;
    }

    await this.broadcast.broadcast(comp.id, {
      estado: 'aprobado',
      payment_id: idPagoNum,
      payment_type: intent.payment?.type,
    });
    this.logger.log(
      `webhook emitir ok comprobante=${comp.id} intent=${intentId} payment=${idPagoNum}`,
    );
  }

  private async revertirABorradorYLimpiarIntent(
    comprobanteId: string,
    tenantId: string,
  ): Promise<void> {
    await this.comprobanteRepo.update(
      { id: comprobanteId, tenantId },
      { estado: EstadoComprobante.borrador, mpPointIntentId: null },
    );
  }

  private async getPaymentIntentConReintento(
    client: ReturnType<MpPointClientFactory['create']>,
    deviceId: string,
    intentId: string,
  ): Promise<MpPointPaymentIntent> {
    let last = await client.getPaymentIntent(deviceId, intentId);
    for (let i = 0; i < REINTENTOS_INTENT - 1; i++) {
      if (intentListoParaResolverPago(last)) break;
      await new Promise((r) => setTimeout(r, PAUSA_MS));
      last = await client.getPaymentIntent(deviceId, intentId);
    }
    return last;
  }
}
