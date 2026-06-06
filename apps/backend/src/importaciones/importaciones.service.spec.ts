import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { BranchStockService } from '../branches/branch-stock.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { ProductoBarcode } from '../products/entities/producto-barcode.entity';
import { Producto } from '../products/entities/producto.entity';
import { ImportDraftService } from './import-draft.service';
import { ImportacionesService } from './importaciones.service';

const testUser = { sub: 'user-1' };

describe('ImportacionesService', () => {
  let service: ImportacionesService;
  let productoRepo: jest.Mocked<Pick<Repository<Producto>, 'find'>>;
  let productoBarcodeRepo: jest.Mocked<Pick<Repository<ProductoBarcode>, 'find'>>;
  let queryRunnerMock: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    query: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
  };
  let dataSourceMock: { createQueryRunner: jest.Mock };

  beforeEach(async () => {
    productoRepo = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as typeof productoRepo;

    productoBarcodeRepo = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as typeof productoBarcodeRepo;

    queryRunnerMock = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };

    dataSourceMock = { createQueryRunner: jest.fn(() => queryRunnerMock) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImportacionesService,
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        { provide: getRepositoryToken(ProductoBarcode), useValue: productoBarcodeRepo },
        { provide: DataSource, useValue: dataSourceMock },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
        {
          provide: BranchStockService,
          useValue: { resolveDepotId: jest.fn().mockResolvedValue('suc-1') },
        },
        {
          provide: ImportDraftService,
          useValue: { resolveExecuteRows: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: SucursalContext,
          useValue: { resolveSucursalId: jest.fn().mockResolvedValue('suc-1') },
        },
      ],
    }).compile();

    service = module.get(ImportacionesService);
  });

  it('marks row as actualizar when product exists by codigo', async () => {
    productoRepo.find.mockResolvedValueOnce([
      { id: 'prod-1', codigo: 'SKU-001', nombre: 'Yerba', codigoBarras: null } as Producto,
    ]);

    const result = await service.previewImport({
      filas: [{ codigo: 'SKU-001', nombre: 'Yerba 1kg' }],
    });

    expect(result.data.resumen.actualizaria).toBe(1);
    expect(result.data.filas[0].accion).toBe('actualizar');
  });

  it('returns errors by row and field', async () => {
    const result = await service.previewImport({
      filas: [{ nombre: '', codigo: 'SKU-1' }, { nombre: 'A', ean: '123' }],
    });

    expect(result.data.resumen.filasConError).toBe(2);
    expect(result.data.filas[0].errores.some((e) => e.campo === 'nombre')).toBe(true);
    expect(result.data.filas[1].errores.some((e) => e.campo === 'ean')).toBe(true);
  });

  it('detects duplicate barcode in same payload', async () => {
    const result = await service.previewImport({
      filas: [
        { nombre: 'A', codigo: 'A1', codigoBarras: '4006381333931' },
        { nombre: 'B', codigo: 'B1', codigoBarras: '4006381333931' },
      ],
    });

    expect(result.data.filas[0].errores.some((e) => e.campo === 'barcode')).toBe(true);
    expect(result.data.filas[1].errores.some((e) => e.campo === 'barcode')).toBe(true);
  });

  it('maps barras alias to barcode resolution against producto_barcode', async () => {
    productoBarcodeRepo.find.mockResolvedValueOnce([
      { id: 'b1', productoId: 'prod-9', valor: '4006381333931' } as ProductoBarcode,
    ]);

    const result = await service.previewImport({
      filas: [{ nombre: 'Yerba', barras: '4006381333931' }],
    });

    expect(result.data.filas[0].barcode).toBe('4006381333931');
    expect(result.data.filas[0].accion).toBe('actualizar');
    expect(result.data.filas[0].productoId).toBe('prod-9');
  });

  it('returns clear checksum rejection for upc alias', async () => {
    const result = await service.previewImport({
      filas: [{ nombre: 'Prod', upc: '036000291453' }],
    });

    expect(result.data.filas[0].errores.some((e) => e.campo === 'upc')).toBe(true);
    expect(result.data.filas[0].errores.some((e) => e.mensaje.includes('checksum'))).toBe(true);
  });

  it('executeImport rejects missing idempotency key', async () => {
    await expect(service.executeImport({ filas: [{ nombre: 'A' }] }, '', testUser)).rejects.toThrow(
      'Idempotency-Key requerido',
    );
  });

  it('executeImport returns cached response when idempotent request already completed', async () => {
    const hash = (service as unknown as { hashPayload: (payload: unknown) => string }).hashPayload({
      filas: [{ nombre: 'A' }],
    });
    queryRunnerMock.query.mockResolvedValueOnce([
      {
        request_hash: hash,
        status: 'completed',
        response_json: JSON.stringify({ data: { ok: true } }),
      },
    ]);

    const result = await service.executeImport({ filas: [{ nombre: 'A' }] }, 'idem-1', testUser);
    expect(result).toEqual({ data: { ok: true } });
  });

  it('executeImport reports checksum errors from aliases in detalle_errores', async () => {
    queryRunnerMock.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'import-log-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await service.executeImport(
      { filas: [{ nombre: 'Prod', ean: '4006381333932' }] },
      'idem-2',
      testUser,
    );

    expect(result).toMatchObject({
      data: {
        filasConError: 1,
      },
    });
    expect(result.data.detalleErrores.some((e) => e.campo === 'ean')).toBe(true);
    expect(result.data.detalleErrores.some((e) => e.error.includes('checksum'))).toBe(true);
  });
});
