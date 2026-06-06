import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { FacturacionService } from '../facturacion/facturacion.service';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { Usuario } from '../users/entities/usuario.entity';
import { MpPointClientFactory } from './mp-point-client.factory';
import { MpPointConfigService } from './mp-point-config.service';
import { MpPointEventBroadcastService } from './mp-point-event-broadcast.service';
import { MpPointWebhookService } from './mp-point-webhook.service';
import { MpPointConfig } from './entities/mp-point-config.entity';

describe('MpPointWebhookService', () => {
  let service: MpPointWebhookService;
  let comprobanteRepo: jest.Mocked<Pick<Repository<Comprobante>, 'findOne' | 'update'>>;
  let mpConfigRepo: jest.Mocked<Pick<Repository<MpPointConfig>, 'findOne'>>;
  let configService: jest.Mocked<Pick<MpPointConfigService, 'loadSecretsForSucursal'>>;
  let clientFactory: jest.Mocked<Pick<MpPointClientFactory, 'create'>>;
  let broadcast: jest.Mocked<Pick<MpPointEventBroadcastService, 'broadcast'>>;

  const mockClient = {
    getPaymentIntent: jest.fn(),
  };

  beforeEach(async () => {
    comprobanteRepo = {
      findOne: jest.fn(),
      update: jest.fn(),
    };
    mpConfigRepo = { findOne: jest.fn() };
    configService = {
      loadSecretsForSucursal: jest.fn().mockResolvedValue({
        accessToken: 'tok',
        deviceId: 'DEV_1',
      }),
    };
    clientFactory = { create: jest.fn().mockReturnValue(mockClient) };
    broadcast = { broadcast: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MpPointWebhookService,
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: getRepositoryToken(ComprobanteItem), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(MpPointConfig), useValue: mpConfigRepo },
        { provide: getRepositoryToken(Usuario), useValue: { findOne: jest.fn() } },
        { provide: MpPointConfigService, useValue: configService },
        { provide: MpPointClientFactory, useValue: clientFactory },
        {
          provide: FacturacionService,
          useValue: { emitirDesdeBorradorMpPoint: jest.fn() },
        },
        { provide: MpPointEventBroadcastService, useValue: broadcast },
      ],
    }).compile();

    service = module.get(MpPointWebhookService);
    jest.clearAllMocks();
  });

  it('handleWebhookHttp responde ok con firma v├ílida', async () => {
    const secret = 'whsec';
    comprobanteRepo.findOne.mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      sucursalId: 's1',
      mpPointIntentId: 'intent-1',
    } as Comprobante);
    mpConfigRepo.findOne.mockResolvedValue({ webhookSecret: secret } as MpPointConfig);

    const crypto = await import('node:crypto');
    const ts = '1700000000';
    const requestId = 'req-1';
    const dataId = 'intent-1';
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

    const result = await service.handleWebhookHttp({
      intentId: dataId,
      bodyJson: null,
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: requestId,
      queryDataId: dataId,
    });

    expect(result).toEqual({ ok: true });
  });

  it('handleWebhookHttp lanza Unauthorized sin secret', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      sucursalId: 's1',
    } as Comprobante);
    mpConfigRepo.findOne.mockResolvedValue({ webhookSecret: null } as MpPointConfig);

    await expect(
      service.handleWebhookHttp({
        intentId: 'intent-1',
        bodyJson: null,
        xSignature: 'ts=1,v1=x',
        xRequestId: 'r',
        queryDataId: 'intent-1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('procesarNotificacion revierte a borrador en CANCELED', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      sucursalId: 's1',
      estado: EstadoComprobante.pendiente_posnet,
      mpPointPaymentId: null,
      mpPointIntentId: 'intent-1',
    } as Comprobante);
    mockClient.getPaymentIntent.mockResolvedValue({ state: 'CANCELED', payment: null });

    await service.procesarNotificacionMpPointIntent({ intentId: 'intent-1' });

    expect(comprobanteRepo.update).toHaveBeenCalledWith(
      { id: 'c1', tenantId: 't1' },
      { estado: EstadoComprobante.borrador, mpPointIntentId: null },
    );
    expect(broadcast.broadcast).toHaveBeenCalledWith('c1', { estado: 'cancelado' });
  });

  it('procesarNotificacion ERROR revierte y broadcast error', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      sucursalId: 's1',
      estado: EstadoComprobante.pendiente_posnet,
      mpPointPaymentId: null,
      mpPointIntentId: 'intent-err',
    } as Comprobante);
    mockClient.getPaymentIntent.mockResolvedValue({ state: 'ERROR', payment: null });

    await service.procesarNotificacionMpPointIntent({ intentId: 'intent-err' });

    expect(broadcast.broadcast).toHaveBeenCalledWith('c1', { estado: 'error' });
  });

  it('procesarNotificacion idempotente si ya tiene payment_id', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      sucursalId: 's1',
      estado: EstadoComprobante.pendiente_posnet,
      mpPointPaymentId: '999',
      mpPointIntentId: 'intent-1',
    } as Comprobante);

    await service.procesarNotificacionMpPointIntent({ intentId: 'intent-1' });

    expect(mockClient.getPaymentIntent).not.toHaveBeenCalled();
  });
});
