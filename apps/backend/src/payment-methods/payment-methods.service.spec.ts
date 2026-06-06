import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { MedioPagoOpcion } from './entities/medio-pago-opcion.entity';
import { MedioPagoRapido } from './entities/medio-pago-rapido.entity';
import { MedioPago } from './entities/medio-pago.entity';
import { PaymentMethodsService } from './payment-methods.service';

describe('PaymentMethodsService', () => {
  let service: PaymentMethodsService;
  let medioPagoRepo: jest.Mocked<Pick<Repository<MedioPago>, 'find' | 'findOne' | 'delete'>>;
  let rapidoRepo: jest.Mocked<Pick<Repository<MedioPagoRapido>, 'find'>>;
  let moduloRepo: jest.Mocked<Pick<Repository<ModuloConfig>, 'findOne'>>;
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    medioPagoRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    } as unknown as typeof medioPagoRepo;
    rapidoRepo = { find: jest.fn().mockResolvedValue([]) } as unknown as typeof rapidoRepo;
    moduloRepo = {
      findOne: jest.fn().mockResolvedValue({ facturadorSimple: true }),
    } as unknown as typeof moduloRepo;

    dataSource = {
      transaction: jest.fn(async (fn: (m: unknown) => Promise<unknown>) =>
        fn({
          save: jest.fn(async (_: unknown, entity: unknown) => ({
            ...(entity as object),
            id: 'mp-1',
            createdAt: new Date('2026-06-05T00:00:00.000Z'),
          })),
          create: jest.fn((_: unknown, payload: unknown) => payload),
          update: jest.fn(),
          delete: jest.fn(),
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodsService,
        { provide: getRepositoryToken(MedioPago), useValue: medioPagoRepo },
        { provide: getRepositoryToken(MedioPagoOpcion), useValue: {} },
        { provide: getRepositoryToken(MedioPagoRapido), useValue: rapidoRepo },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
      ],
    }).compile();

    service = module.get(PaymentMethodsService);
  });

  it('lists medios and default rapidos', async () => {
    medioPagoRepo.find.mockResolvedValue([
      {
        id: 'mp-1',
        nombre: 'Tarjeta Naranja',
        activo: true,
        orden: 0,
        createdAt: new Date('2026-06-05T00:00:00.000Z'),
        opciones: [{ id: 'op-1', cuotas: 1, recargoPorcentaje: '5.0000' }],
      } as MedioPago,
    ]);

    const res = await service.listAll();
    expect(res.data.medios[0]?.medio_pago_opcion[0]?.recargo_porcentaje).toBe(5);
    expect(res.data.rapidos.efectivo).toBe(0);
  });

  it('rejects when facturador_simple disabled', async () => {
    moduloRepo.findOne.mockResolvedValue({ facturadorSimple: false } as ModuloConfig);
    await expect(service.listAll()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates medio with opciones', async () => {
    medioPagoRepo.findOne.mockResolvedValue({
      id: 'mp-1',
      nombre: 'Visa',
      activo: true,
      orden: 0,
      createdAt: new Date('2026-06-05T00:00:00.000Z'),
      opciones: [{ id: 'op-1', cuotas: 3, recargoPorcentaje: '10.0000' }],
    } as MedioPago);

    const res = await service.create({
      nombre: 'Visa',
      opciones: [{ cuotas: 3, recargo_porcentaje: 10 }],
    });

    expect(res.data.medio.nombre).toBe('Visa');
    expect(dataSource.transaction).toHaveBeenCalled();
  });

  it('deletes medio by tenant', async () => {
    medioPagoRepo.delete.mockResolvedValue({ affected: 1, raw: [] });
    const res = await service.remove('mp-1');
    expect(res.data.ok).toBe(true);
  });

  it('throws when deleting unknown medio', async () => {
    medioPagoRepo.delete.mockResolvedValue({ affected: 0, raw: [] });
    await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
