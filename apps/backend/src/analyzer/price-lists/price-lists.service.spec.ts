import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AiLimitService } from '../../ai/ai-limit.service';
import { TenantContext } from '../../auth/tenant-context.service';
import { Categoria } from '../../catalog/entities/categoria.entity';
import { Proveedor } from '../../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../../config/entities/modulo-config.entity';
import { ImportacionLog } from '../../importaciones/entities/importacion-log.entity';
import { PrecioHistorial } from '../../pricing/entities/precio-historial.entity';
import { Producto } from '../../products/entities/producto.entity';
import { Sucursal } from '../../branches/entities/sucursal.entity';
import { RadarInflacion } from '../entities/radar-inflacion.entity';
import { ListaPreciosItem } from './entities/lista-precios-item.entity';
import { ListaPrecios } from './entities/lista-precios.entity';
import { EstadoListaPrecios } from './enums/estado-lista-precios.enum';
import { PriceListsService } from './price-lists.service';

describe('PriceListsService', () => {
  let service: PriceListsService;
  let moduloRepo: jest.Mocked<Pick<Repository<ModuloConfig>, 'findOne'>>;
  let listaRepo: jest.Mocked<
    Pick<Repository<ListaPrecios>, 'find' | 'findOne' | 'save' | 'create' | 'count'>
  >;
  let itemRepo: jest.Mocked<Pick<Repository<ListaPreciosItem>, 'find' | 'save' | 'create'>>;
  let productoRepo: jest.Mocked<Pick<Repository<Producto>, 'find'>>;
  let proveedorRepo: jest.Mocked<Pick<Repository<Proveedor>, 'findOne' | 'find'>>;

  beforeEach(async () => {
    moduloRepo = {
      findOne: jest.fn().mockResolvedValue({ importadorExcel: true, analizadorRentabilidad: true }),
    };
    listaRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((row) => Promise.resolve({ id: 'lista-1', ...row })),
      create: jest.fn().mockImplementation((row) => row),
      count: jest.fn().mockResolvedValue(2),
    };
    itemRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((rows) => Promise.resolve(rows)),
      create: jest.fn().mockImplementation((row) => row),
    };
    productoRepo = { find: jest.fn().mockResolvedValue([]) };
    proveedorRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'prov-1', nombre: 'Proveedor Test' }),
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceListsService,
        { provide: getRepositoryToken(ListaPrecios), useValue: listaRepo },
        { provide: getRepositoryToken(ListaPreciosItem), useValue: itemRepo },
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        { provide: getRepositoryToken(Categoria), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Proveedor), useValue: proveedorRepo },
        { provide: getRepositoryToken(PrecioHistorial), useValue: { save: jest.fn(), create: jest.fn() } },
        { provide: getRepositoryToken(RadarInflacion), useValue: { findOne: jest.fn(), save: jest.fn(), create: jest.fn() } },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        { provide: getRepositoryToken(ImportacionLog), useValue: { save: jest.fn(), create: jest.fn() } },
        { provide: getRepositoryToken(Sucursal), useValue: { findOne: jest.fn() } },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
        {
          provide: AiLimitService,
          useValue: { verificarLimiteIA: jest.fn().mockResolvedValue({ permitido: false }) },
        },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
      ],
    }).compile();

    service = module.get(PriceListsService);
  });

  it('rechaza list sin importador_excel', async () => {
    moduloRepo.findOne.mockResolvedValue({ importadorExcel: false } as ModuloConfig);
    await expect(service.list({})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('confirm persiste lista e items', async () => {
    const res = await service.confirm({
      proveedor_id: 'prov-1',
      nombre: 'Lista marzo',
      descuento_proveedor_pct: 10,
      items: [{ nombre: 'Producto A', precio_lista: 100, codigo_proveedor: 'A1' }],
    });
    expect(res.data.total_items).toBe(1);
    expect(listaRepo.save).toHaveBeenCalled();
    expect(itemRepo.save).toHaveBeenCalled();
  });

  it('confirm falla si proveedor no existe', async () => {
    proveedorRepo.findOne.mockResolvedValue(null);
    await expect(
      service.confirm({
        proveedor_id: 'missing',
        nombre: 'Lista',
        items: [{ nombre: 'X', precio_lista: 10 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('countPendientes delega al repo', async () => {
    const n = await service.countPendientes('tenant-1');
    expect(n).toBe(2);
  });

  it('runMatching actualiza contador de matcheados', async () => {
    listaRepo.findOne.mockResolvedValue({
      id: 'lista-1',
      tenantId: 'tenant-1',
      estado: EstadoListaPrecios.Pendiente,
    } as ListaPrecios);
    itemRepo.find.mockResolvedValue([
      {
        id: 'item-1',
        codigoProveedor: 'COD1',
        nombreProveedor: 'Prod',
        productoId: null,
      } as ListaPreciosItem,
    ]);
    productoRepo.find.mockResolvedValue([
      { id: 'p1', codigo: 'COD1', nombre: 'Prod' } as Producto,
    ]);

    const res = await service.runMatching('lista-1', 'user-1');
    expect(res.data.resumen.seguros).toBe(1);
    expect(res.data.resumen.ia_usada).toBe(false);
    expect(listaRepo.save).toHaveBeenCalled();
  });
});
