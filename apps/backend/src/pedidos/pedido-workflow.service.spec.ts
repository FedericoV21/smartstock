import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { PedidoWorkflowEstado } from './entities/pedido-workflow-estado.entity';
import { PedidoWorkflowTransicion } from './entities/pedido-workflow-transicion.entity';
import { EstadoPedido } from './enums/estado-pedido.enum';
import { PedidoWorkflowService } from './pedido-workflow.service';

describe('PedidoWorkflowService', () => {
  let service: PedidoWorkflowService;
  let estadoRepo: jest.Mocked<
    Pick<Repository<PedidoWorkflowEstado>, 'find' | 'findOne' | 'count' | 'create' | 'save'>
  >;
  let transicionRepo: jest.Mocked<
    Pick<Repository<PedidoWorkflowTransicion>, 'find' | 'count' | 'create'>
  >;
  let moduloRepo: jest.Mocked<Pick<Repository<ModuloConfig>, 'findOne'>>;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    estadoRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(4),
      create: jest.fn((payload) => payload),
      save: jest.fn(),
    } as unknown as typeof estadoRepo;

    transicionRepo = {
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn((payload) => payload),
    } as unknown as typeof transicionRepo;

    moduloRepo = {
      findOne: jest.fn().mockResolvedValue({ pedidos: true }),
    } as unknown as typeof moduloRepo;

    dataSource = { query: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PedidoWorkflowService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(PedidoWorkflowEstado), useValue: estadoRepo },
        { provide: getRepositoryToken(PedidoWorkflowTransicion), useValue: transicionRepo },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
      ],
    }).compile();

    service = module.get(PedidoWorkflowService);
  });

  it('lista estados activos con transiciones', async () => {
    const createdAt = new Date('2025-06-01T12:00:00.000Z');
    estadoRepo.find.mockResolvedValue([
      {
        id: 'w1',
        tenantId: 'tenant-1',
        slug: 'borrador',
        nombre: 'Borrador',
        color: null,
        fase: EstadoPedido.borrador,
        orden: 10,
        activo: true,
        createdAt,
        updatedAt: createdAt,
      } as PedidoWorkflowEstado,
    ]);
    transicionRepo.find.mockResolvedValue([
      {
        tenantId: 'tenant-1',
        desdeId: 'w1',
        haciaId: 'w2',
        createdAt,
      } as PedidoWorkflowTransicion,
    ]);

    const res = await service.list({});
    expect(res.data.estados).toHaveLength(1);
    expect(res.data.estados[0]).toMatchObject({ slug: 'borrador', fase: EstadoPedido.borrador });
    expect(res.data.transiciones[0]).toEqual({
      desde_id: 'w1',
      hacia_id: 'w2',
      created_at: createdAt.toISOString(),
    });
    expect(estadoRepo.find).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', activo: true },
      order: { orden: 'ASC', createdAt: 'ASC' },
    });
  });

  it('rechaza si m├│dulo pedidos est├í deshabilitado', async () => {
    moduloRepo.findOne.mockResolvedValue({ pedidos: false });
    await expect(service.list({})).rejects.toThrow(ForbiddenException);
  });

  it('crea estado con color normalizado', async () => {
    const savedAt = new Date('2025-06-01T12:00:00.000Z');
    estadoRepo.save.mockResolvedValue({
      id: 'w9',
      tenantId: 'tenant-1',
      slug: 'en_preparacion',
      nombre: 'En preparaci├│n',
      color: '#3B82F6',
      fase: EstadoPedido.confirmado,
      orden: 15,
      activo: true,
      createdAt: savedAt,
      updatedAt: savedAt,
    } as PedidoWorkflowEstado);

    const res = await service.create({
      slug: 'en_preparacion',
      nombre: 'En preparaci├│n',
      color: '3b82f6',
      fase: EstadoPedido.confirmado,
      orden: 15,
    });

    expect(estadoRepo.save).toHaveBeenCalled();
    expect(res.data.estado.color).toBe('#3B82F6');
  });

  it('mapea slug duplicado a ConflictException', async () => {
    estadoRepo.save.mockRejectedValue({ code: '23505' });
    await expect(
      service.create({
        slug: 'borrador',
        nombre: 'Borrador 2',
        fase: EstadoPedido.borrador,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('siembra defaults cuando el tenant no tiene estados', async () => {
    estadoRepo.count.mockResolvedValueOnce(0).mockResolvedValueOnce(4);
    await service.list({});
    expect(dataSource.query).toHaveBeenCalled();
  });

  it('reemplaza transiciones del tenant', async () => {
    const createdAt = new Date('2025-06-01T12:00:00.000Z');
    estadoRepo.find.mockResolvedValue([
      { id: 'w1', tenantId: 'tenant-1' } as PedidoWorkflowEstado,
      { id: 'w2', tenantId: 'tenant-1' } as PedidoWorkflowEstado,
    ]);
    dataSource.query = jest.fn();
    (dataSource as { transaction: jest.Mock }).transaction = jest.fn(
      async (fn: (manager: { delete: jest.Mock; create: jest.Mock; save: jest.Mock }) => unknown) =>
        fn({
          delete: jest.fn().mockResolvedValue({}),
          create: jest.fn((_entity, payload) => payload),
          save: jest.fn().mockResolvedValue([
            { tenantId: 'tenant-1', desdeId: 'w1', haciaId: 'w2', createdAt },
          ]),
        }),
    );

    const res = await service.replaceTransiciones([{ desdeId: 'w1', haciaId: 'w2' }]);
    expect(res.data.ok).toBe(true);
    expect(res.data.transiciones[0]).toEqual({
      desde_id: 'w1',
      hacia_id: 'w2',
      created_at: createdAt.toISOString(),
    });
  });
});
