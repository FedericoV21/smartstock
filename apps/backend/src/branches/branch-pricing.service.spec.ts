import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Producto } from '../products/entities/producto.entity';
import { UsersService } from '../users/users.service';
import { BranchPricingService } from './branch-pricing.service';
import { PrecioSucursal } from './entities/precio-sucursal.entity';
import { Sucursal } from './entities/sucursal.entity';
import { SucursalContext } from './sucursal-context.service';

describe('BranchPricingService', () => {
  let service: BranchPricingService;
  let precioRepo: jest.Mocked<
    Pick<Repository<PrecioSucursal>, 'find' | 'findOne' | 'create' | 'save' | 'delete'>
  >;
  let productoRepo: jest.Mocked<Pick<Repository<Producto>, 'findOne' | 'exist'>>;

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const productoId = 'p0000001-0001-4001-8001-000000000001';
  const sucursalId = 'd0000001-0001-4001-8001-000000000001';
  const user = { sub: 'user-1', tenant_id: tenantId, rol: 'admin' };

  const producto: Producto = {
    id: productoId,
    tenantId,
    codigo: 'SKU-1',
    nombre: 'Test',
    descripcion: null,
    categoriaId: null,
    proveedorId: null,
    sucursalId,
    unidad: 'unidad' as Producto['unidad'],
    precioCosto: '100',
    precioVenta: '150',
    stockActual: '10',
    stockMinimo: '1',
    codigoBarras: null,
    plu: null,
    esPesable: false,
    fechaVencimiento: null,
    imagenUrl: null,
    activo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    precioRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((payload) => payload as PrecioSucursal),
      save: jest.fn(async (row) => ({ ...row, id: 'price-1' }) as PrecioSucursal),
      delete: jest.fn(),
    } as unknown as typeof precioRepo;

    productoRepo = {
      findOne: jest.fn().mockResolvedValue(producto),
      exist: jest.fn().mockResolvedValue(true),
    } as unknown as typeof productoRepo;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchPricingService,
        { provide: getRepositoryToken(PrecioSucursal), useValue: precioRepo },
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        { provide: getRepositoryToken(Sucursal), useValue: { exist: jest.fn().mockResolvedValue(true), findOne: jest.fn().mockResolvedValue({ posPrefs: null }) } },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        { provide: SucursalContext, useValue: { resolveSucursalId: jest.fn().mockResolvedValue(sucursalId) } },
        {
          provide: UsersService,
          useValue: {
            listOperableSucursalIds: jest.fn().mockResolvedValue([sucursalId]),
            assertCanOperateSucursal: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(BranchPricingService);
  });

  it('returns catalog price when no override', async () => {
    const result = await service.getEffective(productoId, sucursalId);
    expect(result.data.precioVenta).toBe(150);
    expect(result.data.hasOverride).toBe(false);
  });

  it('deletes override when all price fields are null', async () => {
    const result = await service.upsert(
      productoId,
      { sucursalId, precioCosto: null, precioVenta: null, porcentajeGanancia: null },
      user,
    );
    expect(result.data).toEqual({ ok: true, deleted: true });
    expect(precioRepo.delete).toHaveBeenCalled();
  });

  it('rejects upsert without required fields', async () => {
    await expect(
      service.upsert(productoId, { sucursalId }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('merges override with product fallback', () => {
    const merged = service.mergeEffective(producto, {
      id: 'x',
      tenantId,
      productoId,
      sucursalId,
      precioCosto: '120',
      precioVenta: null,
      porcentajeGanancia: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }, sucursalId);
    expect(merged.precioCosto).toBe(120);
    expect(merged.precioVenta).toBe(150);
    expect(merged.hasOverride).toBe(true);
  });
});
