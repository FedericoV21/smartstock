import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { BranchStockService } from '../branches/branch-stock.service';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Movimiento } from '../inventory/entities/movimiento.entity';
import { ReferenciaTipo } from '../inventory/enums/referencia-tipo.enum';
import { TipoMovimiento } from '../inventory/enums/tipo-movimiento.enum';
import { ProductoVarianteStockSucursal } from '../products/entities/producto-variante-stock-sucursal.entity';
import { ComprobanteVoidService } from './comprobante-void.service';
import { ComprobanteItem } from './entities/comprobante-item.entity';
import { Comprobante } from './entities/comprobante.entity';
import { FacturaImportadaAplicacion } from './entities/factura-importada-aplicacion.entity';
import { EstadoComprobante } from './enums/estado-comprobante.enum';
import { TipoComprobante } from './enums/tipo-comprobante.enum';

describe('ComprobanteVoidService', () => {
  let service: ComprobanteVoidService;
  let comprobanteRepo: { findOne: jest.Mock; update: jest.Mock };
  let itemRepo: { find: jest.Mock };
  let dataSource: { query: jest.Mock };

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const userId = '33333333-3333-4333-8333-333333333333';
  const comprobanteId = 'c0000001-0001-4001-8001-000000000004';

  beforeEach(async () => {
    comprobanteRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    itemRepo = {
      find: jest.fn().mockResolvedValue([
        { productoId: 'b0000001-0001-4001-8001-000000000002', cantidad: '1.000' },
      ]),
    };
    dataSource = { query: jest.fn().mockResolvedValue([{}]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComprobanteVoidService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: getRepositoryToken(ComprobanteItem), useValue: itemRepo },
        {
          provide: getRepositoryToken(Movimiento),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(FacturaImportadaAplicacion),
          useValue: { findOne: jest.fn(), update: jest.fn() },
        },
        { provide: getRepositoryToken(StockSucursal), useValue: { findOne: jest.fn() } },
        {
          provide: getRepositoryToken(ProductoVarianteStockSucursal),
          useValue: { findOne: jest.fn() },
        },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        {
          provide: BranchStockService,
          useValue: { resolveDepotId: jest.fn().mockResolvedValue('d0000001-0001-4001-8001-000000000001') },
        },
      ],
    }).compile();

    service = module.get(ComprobanteVoidService);
  });

  it('anularSinCae reverses stock for error_arca ticket', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: comprobanteId,
      tenantId,
      tipo: TipoComprobante.ticket,
      estado: EstadoComprobante.error_arca,
      cae: null,
      tipoOperacion: 'venta',
      sucursalId: 'd0000001-0001-4001-8001-000000000001',
    });

    const res = await service.anularSinCae(comprobanteId, 'Cliente se arrepinti├│', userId);
    expect(res.data.ok).toBe(true);
    expect(dataSource.query).toHaveBeenCalled();
    expect(comprobanteRepo.update).toHaveBeenCalledWith(
      { id: comprobanteId, tenantId },
      expect.objectContaining({ estado: EstadoComprobante.anulado }),
    );
  });

  it('rejects anular when CAE is valid', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: comprobanteId,
      tenantId,
      tipo: TipoComprobante.factura_b,
      estado: EstadoComprobante.emitido,
      cae: '70123456789012',
      tipoOperacion: 'venta',
    });

    await expect(
      service.anularSinCae(comprobanteId, 'motivo v├ílido largo', userId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revertirImportada requires importado compra', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: comprobanteId,
      tenantId,
      estado: EstadoComprobante.emitido,
      tipoOperacion: 'venta',
    });

    await expect(
      service.revertirImportada(comprobanteId, 'motivo v├ílido largo', userId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revertirImportada conflicts when already reverted', async () => {
    comprobanteRepo.findOne.mockResolvedValue({
      id: comprobanteId,
      tenantId,
      estado: EstadoComprobante.importado,
      tipoOperacion: 'compra',
      sucursalId: 'd0000001-0001-4001-8001-000000000001',
    });

    const aplicacionRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'app-1', estado: 'revertida', afectaStock: true }),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComprobanteVoidService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: getRepositoryToken(ComprobanteItem), useValue: itemRepo },
        {
          provide: getRepositoryToken(Movimiento),
          useValue: {
            find: jest.fn().mockResolvedValue([
              {
                productoId: 'b1',
                cantidad: '2',
                sucursalId: 's1',
                referenciaTipo: ReferenciaTipo.factura_importada,
                productoVarianteId: null,
                tipo: TipoMovimiento.entrada,
              },
            ]),
          },
        },
        { provide: getRepositoryToken(FacturaImportadaAplicacion), useValue: aplicacionRepo },
        {
          provide: getRepositoryToken(StockSucursal),
          useValue: { findOne: jest.fn().mockResolvedValue({ stockActual: '10' }) },
        },
        { provide: getRepositoryToken(ProductoVarianteStockSucursal), useValue: { findOne: jest.fn() } },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        {
          provide: BranchStockService,
          useValue: { resolveDepotId: jest.fn().mockResolvedValue('s1') },
        },
      ],
    }).compile();

    const svc = module.get(ComprobanteVoidService);
    await expect(
      svc.revertirImportada(comprobanteId, 'motivo v├ílido largo', userId),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
