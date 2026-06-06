import * as crypto from 'node:crypto';

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { FacturacionService } from '../facturacion/facturacion.service';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { Usuario } from '../users/entities/usuario.entity';
import { MpPointClientFactory } from './mp-point-client.factory';
import { MpPointConfigService } from './mp-point-config.service';
import { MpPointEventBroadcastService } from './mp-point-event-broadcast.service';
import { MpPointWebhookService } from './mp-point-webhook.service';
import { MpPointConfig } from './entities/mp-point-config.entity';
import { MP_V1_API_BASE } from './utils/payment-v1.util';

/**
 * Flujos end-to-end a nivel servicio (MP Point mock, sin Postgres).
 * NB-MPP-006: aprobado, rechazado, cancelado, idempotencia, tenant.
 */
describe('MP Point flows (integration)', () => {
  let service: MpPointWebhookService;
  let comprobanteRepo: jest.Mocked<Pick<Repository<Comprobante>, 'findOne' | 'update'>>;
  let itemRepo: jest.Mocked<Pick<Repository<ComprobanteItem>, 'find'>>;
  let emitirMock: jest.Mock;
  let broadcast: jest.Mocked<Pick<MpPointEventBroadcastService, 'broadcast'>>;
  let fetchMock: jest.Mock;
  const mockClient = { getPaymentIntent: jest.fn() };

  const tenantA = '00000000-0000-4000-8000-000000000001';
  const tenantB = '00000000-0000-4000-8000-000000000099';
  const sucursalId = 'd0000001-0001-4001-8001-000000000001';
  const comprobanteId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const intentId = 'intent-flow-1';
  const usuarioId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  const pendienteComp = (): Comprobante =>
    ({
      id: comprobanteId,
      tenantId: tenantA,
      sucursalId,
      estado: EstadoComprobante.pendiente_posnet,
      mpPointIntentId: intentId,
      mpPointPaymentId: null,
      usuarioId,
      tipo: TipoComprobante.ticket,
      clienteId: null,
      ivaPorcentaje: '0',
      medioPagoOpcionId: null,
      cajaId: null,
      notas: null,
    }) as Comprobante;

  beforeEach(async () => {
    comprobanteRepo = { findOne: jest.fn(), update: jest.fn().mockResolvedValue({ affected: 1 }) };
    itemRepo = {
      find: jest.fn().mockResolvedValue([
        { productoId: 'prod-1', cantidad: '1', precioUnitario: '500' } as ComprobanteItem,
      ]),
    };
    emitirMock = jest.fn().mockResolvedValue({
      ok: true,
      data: {
        data: {
          id: comprobanteId,
          tipo: TipoComprobante.ticket,
          estado: EstadoComprobante.emitido,
          cae: null,
        },
      },
    });
    broadcast = { broadcast: jest.fn() };
    fetchMock = jest.fn();
    mockClient.getPaymentIntent.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MpPointWebhookService,
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: getRepositoryToken(ComprobanteItem), useValue: itemRepo },
        { provide: getRepositoryToken(MpPointConfig), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(Usuario), useValue: { findOne: jest.fn() } },
        {
          provide: MpPointConfigService,
          useValue: {
            loadSecretsForSucursal: jest.fn().mockResolvedValue({
              accessToken: 'mp-token',
              deviceId: 'DEV_1',
            }),
          },
        },
        {
          provide: MpPointClientFactory,
          useValue: { create: jest.fn().mockReturnValue(mockClient) },
        },
        {
          provide: FacturacionService,
          useValue: { emitirDesdeBorradorMpPoint: emitirMock },
        },
        { provide: MpPointEventBroadcastService, useValue: broadcast },
      ],
    }).compile();

    service = module.get(MpPointWebhookService);
    global.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockPaymentV1(status: string, statusDetail: string | null = null) {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ id: 987654, status, status_detail: statusDetail }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  }

  function mockIntentFinished(paymentId = 987654) {
    mockClient.getPaymentIntent.mockResolvedValue({
      id: intentId,
      state: 'FINISHED',
      amount: 50000,
      payment: { id: paymentId, type: 'credit_card', state: 'approved' },
      additional_info: { external_reference: comprobanteId, print_on_terminal: true },
    });
  }

  it('flujo aprobado: emite comprobante y broadcast aprobado', async () => {
    comprobanteRepo.findOne.mockResolvedValue(pendienteComp());
    mockIntentFinished();
    mockPaymentV1('approved');

    await service.procesarNotificacionMpPointIntent({ intentId });

    expect(fetchMock).toHaveBeenCalledWith(
      `${MP_V1_API_BASE}/payments/987654`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer mp-token' }),
      }),
    );
    expect(emitirMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenantA,
        borradorId: comprobanteId,
        mpPointPaymentId: 987654,
      }),
    );
    expect(broadcast.broadcast).toHaveBeenCalledWith(comprobanteId, {
      estado: 'aprobado',
      payment_id: 987654,
      payment_type: 'credit_card',
    });
  });

  it('flujo rechazado v1: revierte borrador y broadcast rechazado', async () => {
    comprobanteRepo.findOne.mockResolvedValue(pendienteComp());
    mockIntentFinished();
    mockPaymentV1('rejected', 'cc_rejected_insufficient_amount');

    await service.procesarNotificacionMpPointIntent({ intentId });

    expect(emitirMock).not.toHaveBeenCalled();
    expect(comprobanteRepo.update).toHaveBeenCalledWith(
      { id: comprobanteId, tenantId: tenantA },
      { estado: EstadoComprobante.borrador, mpPointIntentId: null },
    );
    expect(broadcast.broadcast).toHaveBeenCalledWith(comprobanteId, {
      estado: 'rechazado',
      motivo: 'rejected:cc_rejected_insufficient_amount',
    });
  });

  it('flujo cancelado intent: revierte borrador sin emitir', async () => {
    comprobanteRepo.findOne.mockResolvedValue(pendienteComp());
    mockClient.getPaymentIntent.mockResolvedValue({
      id: intentId,
      state: 'CANCELED',
      amount: 50000,
      additional_info: { external_reference: comprobanteId, print_on_terminal: true },
    });

    await service.procesarNotificacionMpPointIntent({ intentId });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(emitirMock).not.toHaveBeenCalled();
    expect(broadcast.broadcast).toHaveBeenCalledWith(comprobanteId, { estado: 'cancelado' });
  });

  it('idempotencia: omite si ya tiene mp_point_payment_id', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      ...pendienteComp(),
      mpPointPaymentId: '111',
    } as Comprobante);

    await service.procesarNotificacionMpPointIntent({ intentId });

    expect(mockClient.getPaymentIntent).not.toHaveBeenCalled();
    expect(emitirMock).not.toHaveBeenCalled();
  });

  it('idempotencia: no emite si estado ya no es pendiente_posnet', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      ...pendienteComp(),
      estado: EstadoComprobante.emitido,
    } as Comprobante);

    await service.procesarNotificacionMpPointIntent({ intentId });

    expect(mockClient.getPaymentIntent).not.toHaveBeenCalled();
  });

  it('ownership tenant: emitir usa tenant del comprobante encontrado por intent', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      ...pendienteComp(),
      tenantId: tenantB,
    } as Comprobante);
    mockIntentFinished();
    mockPaymentV1('approved');

    await service.procesarNotificacionMpPointIntent({ intentId });

    expect(emitirMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: tenantB }));
  });

  it('webhook HTTP usa webhook_secret de la sucursal del comprobante (tenant A)', async () => {
    const secretA = 'secret-tenant-a';
    const mpConfigRepo = { findOne: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        MpPointWebhookService,
        {
          provide: getRepositoryToken(Comprobante),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: comprobanteId,
              tenantId: tenantA,
              sucursalId,
              mpPointIntentId: intentId,
            }),
          },
        },
        { provide: getRepositoryToken(ComprobanteItem), useValue: itemRepo },
        { provide: getRepositoryToken(MpPointConfig), useValue: mpConfigRepo },
        { provide: getRepositoryToken(Usuario), useValue: { findOne: jest.fn() } },
        { provide: MpPointConfigService, useValue: { loadSecretsForSucursal: jest.fn() } },
        { provide: MpPointClientFactory, useValue: { create: jest.fn() } },
        { provide: FacturacionService, useValue: { emitirDesdeBorradorMpPoint: jest.fn() } },
        { provide: MpPointEventBroadcastService, useValue: broadcast },
      ],
    }).compile();

    const httpService = module.get(MpPointWebhookService);
    mpConfigRepo.findOne.mockResolvedValue({ webhookSecret: secretA });

    const ts = '1700000099';
    const requestId = 'req-own';
    const manifest = `id:${intentId};request-id:${requestId};ts:${ts};`;
    const v1 = crypto.createHmac('sha256', secretA).update(manifest).digest('hex');

    const result = await httpService.handleWebhookHttp({
      intentId,
      bodyJson: null,
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: requestId,
      queryDataId: intentId,
    });

    expect(result).toEqual({ ok: true });
    expect(mpConfigRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: tenantA, sucursalId },
      select: ['webhookSecret'],
    });
  });
});
