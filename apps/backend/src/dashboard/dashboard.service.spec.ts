import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { Producto } from '../products/entities/producto.entity';
import { UsersService } from '../users/users.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let productoRepo: jest.Mocked<Pick<Repository<Producto>, 'count'>>;
  let comprobanteRepo: jest.Mocked<Pick<Repository<Comprobante>, 'count' | 'find'>>;
  let stockQb: { innerJoin: jest.Mock; where: jest.Mock; andWhere: jest.Mock; select: jest.Mock; getRawMany: jest.Mock };
  let usersService: { listOperableSucursalIds: jest.Mock };

  beforeEach(async () => {
    productoRepo = { count: jest.fn().mockResolvedValue(42) };
    comprobanteRepo = {
      count: jest.fn().mockResolvedValue(7),
      find: jest.fn().mockResolvedValue([
        {
          id: 'c1',
          tipo: TipoComprobante.factura_b,
          total: '1000',
          numeroOrden: 1,
          estado: EstadoComprobante.emitido,
        },
        {
          id: 'c2',
          tipo: TipoComprobante.nota_credito_b,
          total: '200',
          numeroOrden: 2,
          estado: EstadoComprobante.emitido,
        },
      ]),
    };
    stockQb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { stock_actual: '10', precio_costo: '50' },
        { stock_actual: '2', precio_costo: '25' },
      ]),
    };
    usersService = {
      listOperableSucursalIds: jest.fn().mockResolvedValue(['branch-1']),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        {
          provide: getRepositoryToken(StockSucursal),
          useValue: { createQueryBuilder: jest.fn().mockReturnValue(stockQb) },
        },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get(DashboardService);
  });

  it('rechaza operador', async () => {
    await expect(service.getMetrics({ sub: 'u1', rol: 'operador' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('calcula m├®tricas para admin', async () => {
    const res = await service.getMetrics({ sub: 'u1', rol: 'admin' });
    expect(res.data.productos_activos).toBe(42);
    expect(res.data.comprobantes_mes).toBe(7);
    expect(res.data.ventas_mes).toBe(800);
    expect(res.data.valor_inventario).toBe(550);
    expect(res.data.periodo.desde).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('valor inventario 0 sin sucursales operables', async () => {
    usersService.listOperableSucursalIds.mockResolvedValue([]);
    const res = await service.getMetrics({ sub: 'u1', rol: 'visor' });
    expect(res.data.valor_inventario).toBe(0);
  });
});
