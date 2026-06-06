import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Producto } from '../products/entities/producto.entity';
import { BranchStockService } from './branch-stock.service';
import { StockSucursal } from './entities/stock-sucursal.entity';
import { Sucursal } from './entities/sucursal.entity';
import { SucursalContext } from './sucursal-context.service';

describe('BranchStockService', () => {
  let service: BranchStockService;
  let dataSource: { query: jest.Mock };

  const tenantId = '00000000-0000-4000-8000-000000000001';

  beforeEach(async () => {
    dataSource = {
      query: jest.fn().mockResolvedValue([{ n: '12' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchStockService,
        { provide: getRepositoryToken(StockSucursal), useValue: {} },
        { provide: getRepositoryToken(Sucursal), useValue: {} },
        { provide: getRepositoryToken(Producto), useValue: {} },
        { provide: DataSource, useValue: dataSource },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        { provide: SucursalContext, useValue: { resolveSucursalId: jest.fn() } },
      ],
    }).compile();

    service = module.get(BranchStockService);
  });

  it('materializeForTenant calls RPC and returns created count', async () => {
    const res = await service.materializeForTenant();
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('materializar_stock_sucursales_faltantes'),
      [tenantId],
    );
    expect(res.data.created).toBe(12);
  });

  it('materializeForTenant reports zero rows message', async () => {
    dataSource.query.mockResolvedValueOnce([{ n: '0' }]);
    const res = await service.materializeForTenant();
    expect(res.data.created).toBe(0);
    expect(res.data.message).toContain('No hab├¡a filas faltantes');
  });
});
