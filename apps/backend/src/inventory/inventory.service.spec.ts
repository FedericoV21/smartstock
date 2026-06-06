import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { BranchStockService } from '../branches/branch-stock.service';
import { Producto } from '../products/entities/producto.entity';
import { UnidadMedida } from '../products/enums/unidad-medida.enum';
import { TipoMovimiento } from './enums/tipo-movimiento.enum';
import { Movimiento } from './entities/movimiento.entity';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;
  let dataSource: { query: jest.Mock };
  let tenantMock: { getTenantId: jest.Mock };
  let productoRepo: {
    findOne: jest.Mock;
    exist: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let productoQb: {
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    take: jest.Mock;
    getMany: jest.Mock;
  };
  let mockQb: {
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getManyAndCount: jest.Mock;
  };
  let movRepo: { createQueryBuilder: jest.Mock };
  let branchStockMock: { resolveDepotId: jest.Mock; listStockBajoByBranch: jest.Mock };

  beforeEach(async () => {
    productoQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    productoRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'prod-1', usaVariantes: false }),
      exist: jest.fn().mockResolvedValue(true),
      createQueryBuilder: jest.fn(() => productoQb),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([
        {
          id: 'mov-1',
          tenant_id: 't1',
          producto_id: 'prod-1',
          tipo: 'entrada',
          cantidad: '10.000',
          stock_anterior: '0.000',
          stock_posterior: '10.000',
          motivo: null,
          referencia_tipo: null,
          referencia_id: null,
          usuario_id: 'user-1',
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]),
    };

    mockQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    movRepo = {
      createQueryBuilder: jest.fn(() => mockQb),
    };

    tenantMock = { getTenantId: jest.fn().mockReturnValue('t1') };

    branchStockMock = {
      resolveDepotId: jest.fn().mockResolvedValue('suc-1'),
      listStockBajoByBranch: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(Movimiento), useValue: movRepo },
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        { provide: TenantContext, useValue: tenantMock },
        { provide: BranchStockService, useValue: branchStockMock },
      ],
    }).compile();

    service = module.get(InventoryService);
  });

  it('throws NotFound when product is missing', async () => {
    productoRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.registrarMovimiento(
        {
          productoId: 'p-x',
          tipo: TipoMovimiento.entrada,
          cantidad: 1,
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('calls registrar_movimiento and returns serialized row', async () => {
    const res = await service.registrarMovimiento(
      {
        productoId: 'prod-1',
        tipo: TipoMovimiento.entrada,
        cantidad: 10,
        motivo: 'Test',
      },
      'user-1',
    );
    expect(dataSource.query).toHaveBeenCalled();
    expect(res.data.id).toBe('mov-1');
    expect(res.data.cantidad).toBe(10);
    expect(res.data.stockPosterior).toBe(10);
  });

  it('requires productoVarianteId when product uses variantes', async () => {
    productoRepo.findOne.mockResolvedValueOnce({ id: 'prod-1', usaVariantes: true });
    await expect(
      service.registrarMovimiento(
        {
          productoId: 'prod-1',
          tipo: TipoMovimiento.entrada,
          cantidad: 1,
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('calls registrar_movimiento_variante when variant id is provided', async () => {
    productoRepo.findOne.mockResolvedValueOnce({ id: 'prod-1', usaVariantes: true });
    await service.registrarMovimiento(
      {
        productoId: 'prod-1',
        productoVarianteId: 'var-1',
        tipo: TipoMovimiento.entrada,
        cantidad: 3,
      },
      'user-1',
    );
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('registrar_movimiento_variante'),
      expect.arrayContaining(['t1', 'prod-1', 'var-1', 'suc-1']),
    );
  });

  it('maps stock insuficiente to BadRequest', async () => {
    dataSource.query.mockRejectedValueOnce(
      new Error('Stock insuficiente. Actual: 2, solicitado: 5'),
    );
    await expect(
      service.registrarMovimiento(
        {
          productoId: 'prod-1',
          tipo: TipoMovimiento.salida,
          cantidad: 5,
        },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listMovimientos rejects inverted date range', async () => {
    await expect(
      service.listMovimientos({
        fechaDesde: '2026-04-10',
        fechaHasta: '2026-04-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(movRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('listMovimientos rejects unknown productoId for tenant', async () => {
    productoRepo.exist.mockResolvedValueOnce(false);
    await expect(
      service.listMovimientos({ productoId: '00000000-0000-0000-0000-000000000099' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listMovimientos builds query with filters', async () => {
    await service.listMovimientos({
      tipo: TipoMovimiento.salida,
      productoId: '00000000-0000-0000-0000-000000000001',
      fechaDesde: '2026-01-01',
      fechaHasta: '2026-01-31',
      page: 2,
      pageSize: 10,
    });
    expect(movRepo.createQueryBuilder).toHaveBeenCalledWith('m');
    expect(mockQb.where).toHaveBeenCalledWith('m.tenant_id = :tenantId', { tenantId: 't1' });
    expect(mockQb.andWhere).toHaveBeenCalledWith('m.tipo = :tipo', { tipo: 'salida' });
    expect(mockQb.andWhere).toHaveBeenCalledWith('m.producto_id = :productoId', {
      productoId: '00000000-0000-0000-0000-000000000001',
    });
    expect(mockQb.skip).toHaveBeenCalledWith(10);
    expect(mockQb.take).toHaveBeenCalledWith(10);
  });

  it('listStockBajoAlertas uses branch stock when sucursalId is set', async () => {
    branchStockMock.listStockBajoByBranch.mockResolvedValueOnce([
      { id: 'p1', codigo: 'A', nombre: 'Prod', unidad: 'unidad', stockActual: 1, stockMinimo: 5, deficit: 4, sucursalId: 'suc-1' },
    ]);
    const res = await service.listStockBajoAlertas({ limit: 50, sucursalId: 'suc-1' });
    expect(branchStockMock.listStockBajoByBranch).toHaveBeenCalledWith('suc-1', 50);
    expect(res.meta.sucursalId).toBe('suc-1');
    expect(res.data).toHaveLength(1);
  });

  it('listStockBajoAlertas queries producto with stock filter when no depot', async () => {
    branchStockMock.resolveDepotId.mockRejectedValueOnce(new Error('no depot'));
    await service.listStockBajoAlertas({ limit: 50 });
    expect(productoRepo.createQueryBuilder).toHaveBeenCalledWith('p');
    expect(productoQb.where).toHaveBeenCalledWith('p.tenant_id = :tenantId', { tenantId: 't1' });
    expect(productoQb.andWhere).toHaveBeenCalledWith('p.activo = true');
    expect(productoQb.andWhere).toHaveBeenCalledWith('p.stock_actual <= p.stock_minimo');
    expect(productoQb.take).toHaveBeenCalledWith(50);
  });

  it('listVencimientosAlertas queries producto with fecha filter', async () => {
    await service.listVencimientosAlertas({ dias: 7, limit: 20 });
    expect(productoRepo.createQueryBuilder).toHaveBeenCalledWith('p');
    expect(productoQb.andWhere).toHaveBeenCalledWith('p.fecha_vencimiento IS NOT NULL');
    expect(productoQb.andWhere).toHaveBeenCalledWith(
      'p.fecha_vencimiento <= :end',
      expect.objectContaining({ end: expect.any(String) }),
    );
    expect(productoQb.take).toHaveBeenCalledWith(20);
  });

  it('listVencimientosAlertas marks vencido when fecha is past', async () => {
    productoQb.getMany.mockResolvedValueOnce([
      {
        id: 'p1',
        codigo: 'X',
        nombre: 'Y',
        unidad: UnidadMedida.unidad,
        stockActual: '1.000',
        fechaVencimiento: '2020-01-01',
      } as Producto,
    ]);
    const res = await service.listVencimientosAlertas({});
    expect(res.data[0].vencido).toBe(true);
  });
});
