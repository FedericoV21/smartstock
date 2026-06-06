import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Caja } from '../caja/entities/caja.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { MpPointError } from './errors/mp-point.error';
import { MpPointClientFactory } from './mp-point-client.factory';
import { MpPointConfigService } from './mp-point-config.service';
import { MpPointPaymentService } from './mp-point-payment.service';
import { MpPointConfig } from './entities/mp-point-config.entity';
import { MpPointWebhookService } from './mp-point-webhook.service';

describe('MpPointPaymentService', () => {
  let service: MpPointPaymentService;
  let comprobanteRepo: jest.Mocked<Pick<Repository<Comprobante>, 'findOne' | 'save'>>;
  let mpConfigRepo: jest.Mocked<Pick<Repository<MpPointConfig>, 'update'>>;
  let configService: jest.Mocked<Pick<MpPointConfigService, 'ensureFacturadorPos' | 'loadSecretsForSucursal'>>;
  let clientFactory: jest.Mocked<Pick<MpPointClientFactory, 'create'>>;
  let webhookService: { procesarNotificacionMpPointIntent: jest.Mock };

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const sucursalId = 'd0000001-0001-4001-8001-000000000001';
  const comprobanteId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  const mockClient = {
    listDevices: jest.fn().mockResolvedValue([{ id: 'DEV_1', operating_mode: 'PDV' }]),
    getPaymentIntent: jest.fn(),
    createPaymentIntent: jest.fn().mockResolvedValue({
      id: 'intent-new',
      state: 'OPEN',
      amount: 150000,
      additional_info: { external_reference: comprobanteId, print_on_terminal: true },
    }),
    cancelPaymentIntent: jest.fn(),
    setDeviceMode: jest.fn(),
  };

  beforeEach(async () => {
    comprobanteRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (c) => c as Comprobante),
    } as unknown as typeof comprobanteRepo;

    mpConfigRepo = {
      update: jest.fn(),
    } as unknown as typeof mpConfigRepo;

    configService = {
      ensureFacturadorPos: jest.fn(),
      loadSecretsForSucursal: jest.fn().mockResolvedValue({
        accessToken: 'tok',
        deviceId: 'DEV_1',
        webhookSecret: null,
        habilitado: true,
      }),
    };

    clientFactory = {
      create: jest.fn().mockReturnValue(mockClient),
    };

    webhookService = { procesarNotificacionMpPointIntent: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MpPointPaymentService,
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: getRepositoryToken(MpPointConfig), useValue: mpConfigRepo },
        { provide: getRepositoryToken(Caja), useValue: { findOne: jest.fn() } },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        {
          provide: SucursalContext,
          useValue: { resolveSucursalId: jest.fn().mockResolvedValue(sucursalId) },
        },
        { provide: MpPointConfigService, useValue: configService },
        { provide: MpPointClientFactory, useValue: clientFactory },
        { provide: MpPointWebhookService, useValue: webhookService },
      ],
    }).compile();

    service = module.get(MpPointPaymentService);
    jest.clearAllMocks();
    clientFactory.create.mockReturnValue(mockClient);
    configService.loadSecretsForSucursal.mockResolvedValue({
      accessToken: 'tok',
      deviceId: 'DEV_1',
      webhookSecret: null,
      habilitado: true,
    });
  });

  it('iniciar crea intent y pasa comprobante a pendiente_posnet', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: comprobanteId,
      tenantId,
      sucursalId,
      estado: EstadoComprobante.borrador,
      total: '1500',
      mpPointIntentId: null,
    } as Comprobante);

    const result = await service.iniciar(comprobanteId, 1500);
    expect(result.intent_id).toBe('intent-new');
    expect(result.estado).toBe(EstadoComprobante.pendiente_posnet);
    expect(comprobanteRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        mpPointIntentId: 'intent-new',
        estado: EstadoComprobante.pendiente_posnet,
      }),
    );
    expect(mockClient.createPaymentIntent).toHaveBeenCalledWith('DEV_1', {
      amount: 150000,
      additional_info: { external_reference: comprobanteId, print_on_terminal: true },
    });
  });

  it('iniciar rechaza comprobante no borrador', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: comprobanteId,
      tenantId,
      sucursalId,
      estado: EstadoComprobante.emitido,
      total: '100',
    } as Comprobante);

    await expect(service.iniciar(comprobanteId, 100)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancelar revierte a borrador', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: comprobanteId,
      tenantId,
      sucursalId,
      estado: EstadoComprobante.pendiente_posnet,
      mpPointIntentId: 'intent-1',
    } as Comprobante);

    const result = await service.cancelar(comprobanteId);
    expect(result.mensaje).toBe('Cobro cancelado');
    expect(comprobanteRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        estado: EstadoComprobante.borrador,
        mpPointIntentId: null,
      }),
    );
  });

  it('cancelar 409 cuando MP procesa', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: comprobanteId,
      tenantId,
      sucursalId,
      estado: EstadoComprobante.pendiente_posnet,
      mpPointIntentId: 'intent-1',
    } as Comprobante);
    mockClient.cancelPaymentIntent.mockRejectedValueOnce(new MpPointError(409, 'in_progress', 'Processing'));

    await expect(service.cancelar(comprobanteId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('getEstado rate-limit 429', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: comprobanteId,
      tenantId,
      estado: EstadoComprobante.pendiente_posnet,
      mpPointIntentId: 'intent-1',
      sucursalId,
    } as Comprobante);
    mockClient.getPaymentIntent.mockResolvedValue({
      id: 'intent-1',
      state: 'ON_TERMINAL',
      amount: 100,
      additional_info: { external_reference: comprobanteId, print_on_terminal: true },
    });

    await service.getEstado(comprobanteId);
    await expect(service.getEstado(comprobanteId)).rejects.toBeInstanceOf(HttpException);
  });

  it('404 comprobante inexistente', async () => {
    comprobanteRepo.findOne.mockResolvedValue(null);
    await expect(service.iniciar(comprobanteId, 10)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listDevices mapea terminales y advierte STANDALONE', async () => {
    mockClient.listDevices.mockResolvedValueOnce([
      {
        id: 'DEV_PDV',
        operating_mode: 'PDV',
        external_pos_id: 'CAJA1',
        pos_id: 1,
        store_id: '1',
        name: 'Mostrador',
      },
      {
        id: 'DEV_SOLO',
        operating_mode: 'STANDALONE',
        external_pos_id: 'CAJA2',
        pos_id: 2,
        store_id: '1',
      },
    ]);

    const result = await service.listDevices(sucursalId);
    expect(result.devices).toHaveLength(2);
    expect(result.devices[1].en_modo_standalone).toBe(true);
    expect(result.cantidad_standalone).toBe(1);
    expect(result.advertencia_standalone).toContain('STANDALONE');
  });

  it('listDevices 403 si MP Point deshabilitado', async () => {
    configService.loadSecretsForSucursal.mockResolvedValueOnce({
      accessToken: 'tok',
      deviceId: 'DEV_1',
      webhookSecret: null,
      habilitado: false,
    });
    await expect(service.listDevices(sucursalId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('listDevices 400 sin token', async () => {
    configService.loadSecretsForSucursal.mockResolvedValueOnce({
      accessToken: null,
      deviceId: 'DEV_1',
      webhookSecret: null,
      habilitado: true,
    });
    await expect(service.listDevices(sucursalId)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sincronizar dispara reconciliaci├│n cuando intent FINISHED', async () => {
    comprobanteRepo.findOne
      .mockResolvedValueOnce({
        id: comprobanteId,
        tenantId,
        sucursalId,
        estado: EstadoComprobante.pendiente_posnet,
        mpPointIntentId: 'intent-sync',
        mpPointPaymentId: null,
      } as Comprobante)
      .mockResolvedValueOnce({
        id: comprobanteId,
        tenantId,
        sucursalId,
        estado: EstadoComprobante.pendiente_posnet,
        mpPointIntentId: 'intent-sync',
        mpPointPaymentId: null,
      } as Comprobante);

    mockClient.getPaymentIntent.mockResolvedValue({
      id: 'intent-sync',
      state: 'FINISHED',
      amount: 100,
      payment: { id: 555, type: 'debit_card' },
      additional_info: { external_reference: comprobanteId, print_on_terminal: true },
    });

    const result = await service.sincronizar(comprobanteId);
    expect(webhookService.procesarNotificacionMpPointIntent).toHaveBeenCalledWith({
      intentId: 'intent-sync',
    });
    expect(result.proceso_posnet_ejecutado).toBe(true);
    expect(result.estado_mp).toBe('FINISHED');
  });

  it('sincronizar rate-limit 429', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: comprobanteId,
      tenantId,
      sucursalId,
      estado: EstadoComprobante.pendiente_posnet,
      mpPointIntentId: 'intent-sync',
      mpPointPaymentId: null,
    } as Comprobante);
    mockClient.getPaymentIntent.mockResolvedValue({
      id: 'intent-sync',
      state: 'ON_TERMINAL',
      amount: 100,
      additional_info: { external_reference: comprobanteId, print_on_terminal: true },
    });

    await service.sincronizar(comprobanteId);
    await expect(service.sincronizar(comprobanteId)).rejects.toBeInstanceOf(HttpException);
  });

  it('ownership: iniciar no encuentra comprobante de otro tenant', async () => {
    comprobanteRepo.findOne.mockResolvedValue(null);
    await expect(service.iniciar(comprobanteId, 100)).rejects.toBeInstanceOf(NotFoundException);
    expect(comprobanteRepo.findOne).toHaveBeenCalledWith({ where: { id: comprobanteId, tenantId } });
  });
});
