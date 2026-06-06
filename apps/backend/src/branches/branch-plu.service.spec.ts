import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Producto } from '../products/entities/producto.entity';
import { UnidadMedida } from '../products/enums/unidad-medida.enum';
import { UsersService } from '../users/users.service';
import { BranchPluService } from './branch-plu.service';
import { PluSucursal } from './entities/plu-sucursal.entity';
import { Sucursal } from './entities/sucursal.entity';
import { SucursalContext } from './sucursal-context.service';

describe('BranchPluService', () => {
  let service: BranchPluService;
  let pluRepo: jest.Mocked<
    Pick<Repository<PluSucursal>, 'find' | 'findOne' | 'create' | 'save' | 'delete'>
  >;
  let productoRepo: jest.Mocked<Pick<Repository<Producto>, 'findOne' | 'exist' | 'find'>>;

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const productoId = 'p0000001-0001-4001-8001-000000000001';
  const sucursalId = 'd0000001-0001-4001-8001-000000000001';
  const user = { sub: 'user-1', tenant_id: tenantId, rol: 'admin' };

  const producto: Producto = {
    id: productoId,
    tenantId,
    codigo: 'SKU-PLU',
    nombre: 'Queso',
    descripcion: null,
    categoriaId: null,
    proveedorId: null,
    sucursalId,
    unidad: UnidadMedida.kg,
    precioCosto: '100',
    precioVenta: '150',
    stockActual: '10',
    stockMinimo: '1',
    codigoBarras: null,
    plu: '00042',
    esPesable: true,
    fechaVencimiento: null,
    imagenUrl: null,
    activo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    pluRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((payload) => payload as PluSucursal),
      save: jest.fn(async (row) => ({ ...row, id: 'plu-1' }) as PluSucursal),
      delete: jest.fn(),
    } as unknown as typeof pluRepo;

    productoRepo = {
      findOne: jest.fn().mockResolvedValue(producto),
      exist: jest.fn().mockResolvedValue(true),
      find: jest.fn().mockResolvedValue([]),
    } as unknown as typeof productoRepo;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BranchPluService,
        { provide: getRepositoryToken(PluSucursal), useValue: pluRepo },
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        { provide: getRepositoryToken(Sucursal), useValue: { exist: jest.fn().mockResolvedValue(true) } },
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

    service = module.get(BranchPluService);
  });

  it('returns catalog plu when no override', async () => {
    const result = await service.getEffective(productoId, sucursalId);
    expect(result.data.plu).toBe('00042');
    expect(result.data.hasOverride).toBe(false);
  });

  it('upserts normalized plu override', async () => {
    const result = await service.upsert(
      productoId,
      { sucursalId, plu: '99' },
      user,
    );
    expect(result.data.plu).toBe('00099');
    expect(pluRepo.save).toHaveBeenCalled();
  });

  it('rejects plu on non-scale product', async () => {
    productoRepo.findOne.mockResolvedValue({
      ...producto,
      esPesable: false,
      plu: null,
      unidad: UnidadMedida.unidad,
    });
    await expect(
      service.upsert(productoId, { sucursalId, plu: '1' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks duplicate plu in branch', async () => {
    pluRepo.findOne.mockResolvedValue({
      id: 'other',
      tenantId,
      productoId: 'other-product',
      sucursalId,
      plu: '00099',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      service.upsert(productoId, { sucursalId, plu: '99' }, user),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
