import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { BranchStockService } from '../branches/branch-stock.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Tenant } from '../config/entities/tenant.entity';
import { Categoria } from '../catalog/entities/categoria.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { UsersService } from '../users/users.service';
import { ProductoBarcode } from './entities/producto-barcode.entity';
import { ProductoVarianteStockSucursal } from './entities/producto-variante-stock-sucursal.entity';
import { ProductoVariante } from './entities/producto-variante.entity';
import { generarEAN13Interno } from './barcodes/ean13-interno.util';
import { ProductoBarcodeTipo } from './enums/producto-barcode-tipo.enum';
import { UnidadMedida } from './enums/unidad-medida.enum';
import { Producto } from './entities/producto.entity';
import { ProductsService } from './products.service';

const sucursalId = 'd0000001-0001-4001-8001-000000000001';
const user = { sub: 'user-1', role: 'admin' };

function makeProducto(partial: Partial<Producto> = {}): Producto {
  return {
    id: 'prod-1',
    tenantId: 'tenant-1',
    codigo: 'SKU-1',
    nombre: 'Yerba',
    descripcion: null,
    categoriaId: 'cat-1',
    proveedorId: 'prov-1',
    sucursalId,
    unidad: UnidadMedida.unidad,
    precioCosto: '100.00',
    precioVenta: '150.00',
    ivaPorcentaje: null,
    porcentajeGanancia: null,
    descuentoCostoPct: null,
    stockActual: '5.000',
    stockMinimo: '10.000',
    codigoBarras: null,
    plu: null,
    esPesable: false,
    fechaVencimiento: null,
    imagenUrl: null,
    usaVariantes: false,
    activo: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...partial,
  } as Producto;
}

describe('ProductsService', () => {
  let service: ProductsService;
  let repoMock: jest.Mocked<
    Pick<
      Repository<Producto>,
      'find' | 'findAndCount' | 'findOne' | 'create' | 'save' | 'update' | 'exist' | 'createQueryBuilder'
    > & {
      manager: { createQueryBuilder: jest.Mock };
    }
  >;
  let listQb: {
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    leftJoin: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    select: jest.Mock;
    getCount: jest.Mock;
    getMany: jest.Mock;
  };
  let barcodeRepoMock: jest.Mocked<
    Pick<
      Repository<ProductoBarcode>,
      'find' | 'findOne' | 'create' | 'save' | 'update' | 'exist' | 'createQueryBuilder'
    >
  >;
  let barcodeMaxQb: {
    select: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    getRawOne: jest.Mock;
  };
  let tenantMock: { getTenantId: jest.Mock };
  let sucursalContextMock: { resolveSucursalId: jest.Mock; requireSucursalId: jest.Mock };
  let usersServiceMock: { listOperableSucursalIds: jest.Mock };
  let categoriaRepoMock: { find: jest.Mock };
  let proveedorRepoMock: { find: jest.Mock };
  let sucursalRepoMock: { find: jest.Mock; findOne: jest.Mock };
  let stockSucursalRepoMock: { find: jest.Mock };
  let tenantRepoMock: { findOne: jest.Mock };

  beforeEach(async () => {
    listQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
      getMany: jest.fn().mockResolvedValue([makeProducto()]),
      getRawOne: jest.fn().mockResolvedValue({ max: null }),
    };

    const managerQb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ '?column?': 1 }),
    };

    repoMock = {
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      exist: jest.fn().mockResolvedValue(true),
      createQueryBuilder: jest.fn(() => listQb),
      manager: { createQueryBuilder: jest.fn(() => managerQb) },
    } as unknown as typeof repoMock;

    barcodeMaxQb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ max: null }),
    };

    barcodeRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      exist: jest.fn().mockResolvedValue(false),
      createQueryBuilder: jest.fn(() => barcodeMaxQb),
    } as unknown as typeof barcodeRepoMock;

    tenantMock = { getTenantId: jest.fn().mockReturnValue('tenant-1') };
    sucursalContextMock = {
      resolveSucursalId: jest.fn().mockResolvedValue(sucursalId),
      requireSucursalId: jest.fn().mockResolvedValue(sucursalId),
    };
    usersServiceMock = {
      listOperableSucursalIds: jest.fn().mockResolvedValue([sucursalId]),
    };
    categoriaRepoMock = {
      find: jest.fn().mockResolvedValue([{ id: 'cat-1', nombre: 'Almac├®n' }]),
    };
    proveedorRepoMock = {
      find: jest.fn().mockResolvedValue([{ id: 'prov-1', nombre: 'Proveedor SA' }]),
    };
    sucursalRepoMock = {
      find: jest.fn().mockResolvedValue([{ id: sucursalId, nombre: 'CASA', codigo: 'CASA' }]),
      findOne: jest.fn(),
    };
    stockSucursalRepoMock = { find: jest.fn().mockResolvedValue([]) };
    tenantRepoMock = {
      findOne: jest.fn().mockResolvedValue({
        ivaPorcentajeDefault: '21',
        posPrefs: null,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getRepositoryToken(Producto), useValue: repoMock },
        { provide: getRepositoryToken(ProductoBarcode), useValue: barcodeRepoMock },
        { provide: getRepositoryToken(StockSucursal), useValue: stockSucursalRepoMock },
        { provide: getRepositoryToken(Sucursal), useValue: sucursalRepoMock },
        { provide: getRepositoryToken(Categoria), useValue: categoriaRepoMock },
        { provide: getRepositoryToken(Proveedor), useValue: proveedorRepoMock },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepoMock },
        { provide: getRepositoryToken(ProductoVariante), useValue: { find: jest.fn() } },
        {
          provide: getRepositoryToken(ProductoVarianteStockSucursal),
          useValue: { find: jest.fn() },
        },
        { provide: TenantContext, useValue: tenantMock },
        { provide: BranchStockService, useValue: { resolveDepotId: jest.fn() } },
        { provide: SucursalContext, useValue: sucursalContextMock },
        { provide: UsersService, useValue: usersServiceMock },
      ],
    }).compile();

    service = module.get(ProductsService);
  });

  it('list scopes by tenant and active by default', async () => {
    const res = await service.list({}, user);
    expect(tenantMock.getTenantId).toHaveBeenCalled();
    expect(listQb.andWhere).toHaveBeenCalledWith('p.activo = true');
    expect(listQb.getCount).toHaveBeenCalled();
    expect(res.data).toHaveLength(1);
    expect(res.meta.total).toBe(1);
    expect(res.meta.alcance).toBe('sucursal');
    expect(res.data[0]).toMatchObject({
      categoria: { id: 'cat-1', nombre: 'Almac├®n' },
      proveedor: { id: 'prov-1', nombre: 'Proveedor SA' },
      margenGananciaPct: expect.any(Number),
    });
  });

  it('list applies search filter on nombre/codigo', async () => {
    await service.list({ q: 'yerba', page: 1, pageSize: 10 }, user);
    expect(listQb.andWhere).toHaveBeenCalledWith(
      '(p.nombre ILIKE :q OR p.codigo ILIKE :q)',
      { q: '%yerba%' },
    );
    expect(listQb.take).toHaveBeenCalledWith(10);
  });

  it('list filters by barcode using barcode table and legacy column', async () => {
    barcodeRepoMock.find.mockResolvedValue([{ productoId: 'prod-barcode' } as ProductoBarcode]);
    repoMock.find.mockResolvedValue([{ id: 'prod-legacy' } as Producto]);

    await service.list({ barcode: '4006381333931' }, user);

    expect(barcodeRepoMock.find).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', valor: '4006381333931', activo: true },
      select: { productoId: true },
    });
    expect(listQb.andWhere).toHaveBeenCalledWith(
      'p.id IN (:...productIdsByBarcode)',
      { productIdsByBarcode: expect.arrayContaining(['prod-barcode', 'prod-legacy']) },
    );
  });

  it('list with alcance tenant uses operable sucursales', async () => {
    await service.list({ alcance: 'tenant' }, user);
    expect(usersServiceMock.listOperableSucursalIds).toHaveBeenCalled();
    expect(listQb.andWhere).toHaveBeenCalledWith('p.sucursal_id IN (:...sucursalIds)', {
      sucursalIds: [sucursalId],
    });
    expect(listQb.andWhere).not.toHaveBeenCalledWith(
      expect.stringContaining('stock_sucursal ss_vis'),
      expect.anything(),
    );
  });

  it('list rejects proveedorId and proveedorIds together', async () => {
    await expect(
      service.list(
        {
          proveedorId: '00000000-0000-4000-8000-000000000001',
          proveedorIds: ['00000000-0000-4000-8000-000000000002'],
        },
        user,
      ),
    ).rejects.toThrow('Us├í solo proveedorId o proveedorIds');
  });

  it('rejects create when codigoBarras checksum is invalid', async () => {
    await expect(
      service.create({
        codigo: 'SKU-1',
        nombre: 'Producto',
        unidad: UnidadMedida.unidad,
        precioCosto: 10,
        precioVenta: 20,
        codigoBarras: '4006381333932',
      }),
    ).rejects.toThrow('codigoBarras inv├ílido');
  });

  it('rejects update when codigoBarras checksum is invalid', async () => {
    repoMock.findOne.mockResolvedValue({
      id: 'prod-1',
      tenantId: 'tenant-1',
      codigo: 'SKU-1',
      nombre: 'Producto',
      descripcion: null,
      categoriaId: null,
      proveedorId: null,
      unidad: UnidadMedida.unidad,
      precioCosto: '10.00',
      precioVenta: '20.00',
      stockActual: '1.000',
      stockMinimo: '0.000',
      codigoBarras: '4006381333931',
      plu: null,
      esPesable: false,
      fechaVencimiento: null,
      imagenUrl: null,
      activo: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Producto);

    await expect(service.update('prod-1', { codigoBarras: '036000291453' })).rejects.toThrow(
      'codigoBarras inv├ílido',
    );
  });

  it('createBarcode unsets previous principal when creating a new principal', async () => {
    barcodeRepoMock.create.mockImplementation((input) => input as ProductoBarcode);
    barcodeRepoMock.save.mockImplementation(async (input) => ({
      ...(input as ProductoBarcode),
      id: 'bar-2',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }));

    await service.createBarcode('prod-1', {
      tipo: ProductoBarcodeTipo.EAN13,
      valor: '4006381333931',
      esPrincipal: true,
    });

    expect(barcodeRepoMock.update).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        productoId: 'prod-1',
        activo: true,
        esPrincipal: true,
      },
      { esPrincipal: false },
    );
    expect(barcodeRepoMock.save).toHaveBeenCalled();
  });

  it('rejects createBarcode when value does not match type checksum', async () => {
    await expect(
      service.createBarcode('prod-1', {
        tipo: ProductoBarcodeTipo.UPCA,
        valor: '4006381333931',
      }),
    ).rejects.toThrow('barcode inv├ílido');
  });

  it('generateInternalBarcode assigns EAN-13 interno and principal barcode row', async () => {
    const producto = makeProducto({ id: 'prod-gen', codigoBarras: null, esPesable: false });
    repoMock.findOne.mockResolvedValue(producto);
    listQb.getRawOne.mockResolvedValue({ max: null });
    barcodeRepoMock.create.mockImplementation((input) => input as ProductoBarcode);
    repoMock.save.mockImplementation(async (input) => input as Producto);
    barcodeRepoMock.save.mockResolvedValue({} as ProductoBarcode);

    const res = await service.generateInternalBarcode('prod-gen');

    expect(res.data.generatedBarcode).toBe(generarEAN13Interno(1));
    expect(res.data.product.codigoBarras).toBe(generarEAN13Interno(1));
    expect(barcodeRepoMock.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: ProductoBarcodeTipo.EAN13,
        esPrincipal: true,
        valor: generarEAN13Interno(1),
      }),
    );
  });

  it('generateInternalBarcode rejects pesable products', async () => {
    repoMock.findOne.mockResolvedValue(makeProducto({ esPesable: true }));
    await expect(service.generateInternalBarcode('prod-1')).rejects.toThrow('pesables');
  });

  it('generateInternalBarcode rejects when legacy barcode exists', async () => {
    repoMock.findOne.mockResolvedValue(
      makeProducto({ codigoBarras: '4006381333931', esPesable: false }),
    );
    await expect(service.generateInternalBarcode('prod-1')).rejects.toThrow('ya tiene');
  });

  it('bulkUpdateMargin updates products with cost and margin', async () => {
    repoMock.find.mockResolvedValue([
      {
        id: 'prod-1',
        sucursalId,
        precioCosto: '100.00',
        ivaPorcentaje: null,
        descuentoCostoPct: null,
      },
    ]);
    repoMock.update.mockResolvedValue({ affected: 1 });

    const res = await service.bulkUpdateMargin(
      { ids: ['prod-1'], porcentajeGanancia: 30 },
      user,
    );

    expect(res.data.actualizados).toBe(1);
    expect(repoMock.update).toHaveBeenCalledWith(
      { id: 'prod-1', tenantId: 'tenant-1' },
      expect.objectContaining({ porcentajeGanancia: '30.00', precioVenta: expect.any(String) }),
    );
  });

  it('bulkUpdateActiveByFilter requires proveedor filter', async () => {
    await expect(
      service.bulkUpdateActiveByFilter(
        { activo: false, filtros: { q: 'yerba' } },
        user,
      ),
    ).rejects.toThrow('requiere al menos un proveedor');
  });
});
