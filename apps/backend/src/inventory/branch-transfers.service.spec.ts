import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Producto } from '../products/entities/producto.entity';
import { UsersService } from '../users/users.service';
import { BranchTransfersService } from './branch-transfers.service';
import { StockTransferenciaSucursal } from './entities/stock-transferencia-sucursal.entity';

describe('BranchTransfersService', () => {
  let service: BranchTransfersService;
  let dataSource: { query: jest.Mock };
  let transferRepo: jest.Mocked<Pick<Repository<StockTransferenciaSucursal>, 'find' | 'findOne'>>;
  let productoRepo: jest.Mocked<Pick<Repository<Producto>, 'findOne' | 'find'>>;
  let stockRepo: jest.Mocked<Pick<Repository<StockSucursal>, 'findOne'>>;

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const productoId = 'b0000001-0001-4001-8001-000000000001';
  const origenId = 'd0000001-0001-4001-8001-000000000001';
  const destinoId = 'd0000002-0002-4002-8002-000000000002';
  const user = { sub: 'user-1', tenant_id: tenantId, rol: 'admin' };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };
    transferRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    } as unknown as typeof transferRepo;
    productoRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: productoId,
        tenantId,
        codigo: 'YER-001',
        nombre: 'Yerba',
        activo: true,
      }),
      find: jest.fn().mockResolvedValue([]),
    } as unknown as typeof productoRepo;
    stockRepo = {
      findOne: jest.fn().mockResolvedValue({ stockActual: '50' }),
    } as unknown as typeof stockRepo;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchTransfersService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(StockTransferenciaSucursal), useValue: transferRepo },
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        { provide: getRepositoryToken(StockSucursal), useValue: stockRepo },
        {
          provide: getRepositoryToken(Sucursal),
          useValue: { exist: jest.fn().mockResolvedValue(true), find: jest.fn().mockResolvedValue([]) },
        },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        {
          provide: UsersService,
          useValue: { assertCanOperateSucursal: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(BranchTransfersService);
  });

  it('rejects preview when origen equals destino', async () => {
    await expect(
      service.preview({
        productoId,
        sucursalOrigenId: origenId,
        sucursalDestinoId: origenId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns preview with stock levels', async () => {
    stockRepo.findOne
      .mockResolvedValueOnce({ stockActual: '120' } as StockSucursal)
      .mockResolvedValueOnce(null);

    const result = await service.preview({
      productoId,
      sucursalOrigenId: origenId,
      sucursalDestinoId: destinoId,
    });

    expect(result.data.stockOrigen.stockActual).toBe(120);
    expect(result.data.status).toBe('will_create_depot');
  });

  it('creates transfer via RPC', async () => {
    dataSource.query.mockResolvedValue([
      { data: { transfer_id: 't-1', estado: 'pendiente' } },
    ]);

    const result = await service.create(
      {
        productoId,
        sucursalOrigenId: origenId,
        sucursalDestinoId: destinoId,
        cantidad: 5,
      },
      user,
    );

    expect(result.data).toEqual({ transfer_id: 't-1', estado: 'pendiente' });
    expect(dataSource.query).toHaveBeenCalled();
  });

  it('rejects receive when not pending', async () => {
    transferRepo.findOne.mockResolvedValue({
      id: 't-1',
      tenantId,
      estado: 'recibida',
      sucursalDestinoId: destinoId,
    } as StockTransferenciaSucursal);

    await expect(service.receive('t-1', user)).rejects.toBeInstanceOf(ConflictException);
  });
});
