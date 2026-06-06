import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { ProductoLoteIngreso } from './entities/producto-lote-ingreso.entity';
import { Producto } from './entities/producto.entity';
import { LoteIngresoOrigen } from './enums/lote-ingreso-origen.enum';
import { ProductLotesService } from './product-lotes.service';

const tenantId = 'tenant-1';
const productoId = 'b0000001-0001-4001-8001-000000000001';
const sucursalId = 'd0000001-0001-4001-8001-000000000001';

describe('ProductLotesService', () => {
  let service: ProductLotesService;
  let loteRepo: { find: jest.Mock; findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let productoRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    loteRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'lote-1',
          tenantId,
          productoId,
          sucursalId,
          proveedorId: null,
          cantidad: '10.000',
          fechaVencimiento: '2026-12-31',
          precioCosto: '100.000000',
          origen: LoteIngresoOrigen.manual,
          importacionLogId: null,
          lectorFacturaLogId: null,
          movimientoId: null,
          createdAt: new Date('2026-06-01'),
        },
      ]),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x, id: 'lote-nuevo' })),
    };

    productoRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: productoId,
        tenantId,
        sucursalId,
        proveedorId: null,
        precioCosto: '50.00',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductLotesService,
        { provide: getRepositoryToken(ProductoLoteIngreso), useValue: loteRepo },
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        { provide: getRepositoryToken(Proveedor), useValue: { findOne: jest.fn(), find: jest.fn() } },
        {
          provide: getRepositoryToken(Sucursal),
          useValue: {
            find: jest.fn().mockResolvedValue([{ id: sucursalId, nombre: 'CASA', codigo: 'CASA' }]),
            findOne: jest.fn().mockResolvedValue({ id: sucursalId, nombre: 'CASA', codigo: 'CASA' }),
          },
        },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        {
          provide: SucursalContext,
          useValue: { requireSucursalId: jest.fn().mockResolvedValue(sucursalId) },
        },
      ],
    }).compile();

    service = module.get(ProductLotesService);
  });

  it('lists lotes for product', async () => {
    const res = await service.listByProduct(productoId);
    expect(res.data).toHaveLength(1);
    expect(res.data[0].cantidad).toBe(10);
    expect(res.data[0].fechaVencimiento).toBe('2026-12-31');
  });

  it('creates manual lote', async () => {
    loteRepo.findOne.mockResolvedValue({
      id: 'lote-nuevo',
      tenantId,
      productoId,
      sucursalId,
      proveedorId: null,
      cantidad: '5.000',
      fechaVencimiento: '2027-01-15',
      precioCosto: '50.000000',
      origen: LoteIngresoOrigen.manual,
      importacionLogId: null,
      lectorFacturaLogId: null,
      movimientoId: null,
      createdAt: new Date(),
    });

    const res = await service.create(
      productoId,
      { cantidad: 5, fechaVencimiento: '2027-01-15' },
      'user-1',
    );
    expect(res.data.id).toBe('lote-nuevo');
    expect(loteRepo.save).toHaveBeenCalled();
  });
});
