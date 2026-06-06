import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { UsersService } from '../users/users.service';
import { ProductoVarianteStockSucursal } from './entities/producto-variante-stock-sucursal.entity';
import { ProductoVariante } from './entities/producto-variante.entity';
import { Producto } from './entities/producto.entity';
import { UnidadMedida } from './enums/unidad-medida.enum';
import { ProductVariantsService } from './product-variants.service';

describe('ProductVariantsService', () => {
  let service: ProductVariantsService;
  let varianteRepo: jest.Mocked<
    Pick<Repository<ProductoVariante>, 'find' | 'findOne' | 'create' | 'save'>
  >;
  let stockRepo: jest.Mocked<
    Pick<
      Repository<ProductoVarianteStockSucursal>,
      'createQueryBuilder' | 'findOne' | 'create' | 'save'
    >
  >;
  let productoRepo: jest.Mocked<Pick<Repository<Producto>, 'findOne' | 'update'>>;
  let stockQb: { where: jest.Mock; andWhere: jest.Mock; getMany: jest.Mock };

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const productoId = 'b0000001-0001-4001-8001-00000000000c';
  const sucursalId = 'd0000001-0001-4001-8001-000000000001';
  const varianteId = 'c1000001-0001-4001-8001-000000000001';
  const user = { sub: 'user-1', tenant_id: tenantId, rol: 'admin' };

  const producto: Producto = {
    id: productoId,
    tenantId,
    codigo: 'REM-001',
    nombre: 'Remera b├ísica',
    descripcion: null,
    categoriaId: null,
    proveedorId: null,
    sucursalId,
    unidad: UnidadMedida.unidad,
    precioCosto: '500',
    precioVenta: '1200',
    stockActual: '0',
    stockMinimo: '0',
    codigoBarras: null,
    plu: null,
    esPesable: false,
    fechaVencimiento: null,
    imagenUrl: null,
    usaVariantes: false,
    activo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    stockQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    varianteRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((payload) => payload as ProductoVariante),
      save: jest.fn(async (row) => ({
        ...row,
        id: varianteId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    } as unknown as typeof varianteRepo;

    stockRepo = {
      createQueryBuilder: jest.fn(() => stockQb),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((payload) => payload as ProductoVarianteStockSucursal),
      save: jest.fn(async (row) => ({ ...row, id: 'stock-1' })),
    } as unknown as typeof stockRepo;

    productoRepo = {
      findOne: jest.fn().mockResolvedValue(producto),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as typeof productoRepo;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductVariantsService,
        { provide: getRepositoryToken(ProductoVariante), useValue: varianteRepo },
        { provide: getRepositoryToken(ProductoVarianteStockSucursal), useValue: stockRepo },
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        {
          provide: getRepositoryToken(Sucursal),
          useValue: {
            findOne: jest.fn().mockResolvedValue({
              id: sucursalId,
              nombre: 'CASA',
              codigo: 'CASA',
            }),
          },
        },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        {
          provide: UsersService,
          useValue: {
            listOperableSucursalIds: jest.fn().mockResolvedValue([sucursalId]),
          },
        },
      ],
    }).compile();

    service = module.get(ProductVariantsService);
  });

  it('listForProduct returns empty variantes', async () => {
    const res = await service.listForProduct(productoId, user);
    expect(res.data.productoId).toBe(productoId);
    expect(res.data.variantes).toEqual([]);
  });

  it('create rejects variant without identifying data', async () => {
    await expect(service.create(productoId, {}, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('create saves variante and enables usa_variantes', async () => {
    const res = await service.create(
      productoId,
      { atributos: { talle: 'M', color: 'Negro' } },
      user,
    );
    expect(res.data.id).toBe(varianteId);
    expect(res.data.etiqueta).toBe('M / Negro');
    expect(productoRepo.update).toHaveBeenCalledWith(
      { id: productoId, tenantId },
      { usaVariantes: true },
    );
    expect(stockRepo.save).toHaveBeenCalled();
  });

  it('throws Forbidden when product branch is not operable', async () => {
    productoRepo.findOne.mockResolvedValueOnce({ ...producto, sucursalId: 'other-branch' });
    await expect(service.listForProduct(productoId, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('throws NotFound for unknown product', async () => {
    productoRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.listForProduct(productoId, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
