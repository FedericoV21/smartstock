import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Producto } from '../products/entities/producto.entity';
import { PrecioHistorial } from './entities/precio-historial.entity';
import { OrigenPrecio } from './enums/origen-precio.enum';
import { PricingService } from './pricing.service';

describe('PricingService', () => {
  let service: PricingService;
  let precioRepo: jest.Mocked<Pick<Repository<PrecioHistorial>, 'findAndCount'>>;
  let productoRepo: jest.Mocked<Pick<Repository<Producto>, 'findOne' | 'find'>>;
  let moduloRepo: jest.Mocked<Pick<Repository<ModuloConfig>, 'findOne'>>;

  beforeEach(async () => {
    precioRepo = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    } as unknown as typeof precioRepo;

    productoRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    } as unknown as typeof productoRepo;

    moduloRepo = {
      findOne: jest.fn().mockResolvedValue({ iaPrecios: true }),
    } as unknown as typeof moduloRepo;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingService,
        { provide: getRepositoryToken(PrecioHistorial), useValue: precioRepo },
        { provide: getRepositoryToken(Producto), useValue: productoRepo },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
      ],
    }).compile();

    service = module.get(PricingService);
  });

  it('lists historial paginated by tenant with front-compatible shape', async () => {
    const createdAt = new Date('2025-01-15T10:00:00.000Z');
    precioRepo.findAndCount.mockResolvedValue([
      [
        {
          id: 'h1',
          tenantId: 'tenant-1',
          productoId: 'p1',
          origen: OrigenPrecio.importacion_excel,
          precioCostoAnterior: '100.00',
          precioCostoNuevo: '120.00',
          precioVentaAnterior: '130.00',
          precioVentaNuevo: '150.00',
          margenAnterior: '30.00',
          margenNuevo: '25.00',
          createdAt,
        } as PrecioHistorial,
      ],
      1,
    ]);
    productoRepo.find.mockResolvedValue([
      { id: 'p1', codigo: 'SKU-1', nombre: 'Producto 1' } as Producto,
    ]);

    const res = await service.listHistorial({
      page: 1,
      pageSize: 10,
      origen: OrigenPrecio.importacion_excel,
    });

    expect(precioRepo.findAndCount).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', origen: OrigenPrecio.importacion_excel },
      order: { createdAt: 'DESC' },
      skip: 0,
      take: 10,
    });
    expect(res.data.historial).toHaveLength(1);
    expect(res.data.historial[0]).toMatchObject({
      id: 'h1',
      created_at: createdAt.toISOString(),
      precio_costo_anterior: 100,
      precio_costo_nuevo: 120,
      origen: OrigenPrecio.importacion_excel,
      producto: { id: 'p1', codigo: 'SKU-1', nombre: 'Producto 1' },
    });
    expect(res.data).toMatchObject({ total: 1, pagina: 1, por_pagina: 10 });
  });

  it('rechaza historial si ia_precios est├í deshabilitado', async () => {
    moduloRepo.findOne.mockResolvedValue({ iaPrecios: false });
    await expect(service.listHistorial({})).rejects.toThrow(ForbiddenException);
  });

  it('uses explicit margen objetivo for suggestion', async () => {
    productoRepo.findOne.mockResolvedValue({
      id: 'p1',
      tenantId: 'tenant-1',
      activo: true,
      precioCosto: '100.00',
      precioVenta: '130.00',
      categoriaId: null,
    } as Producto);

    const res = await service.getSuggestion({
      productoId: 'p1',
      nuevoPrecioCosto: 200,
      margenObjetivoPct: 25,
    });

    expect(res.data.fuente).toBe('margen_objetivo');
    expect(res.data.precioSugerido).toBe(250);
  });

  it('falls back to default margin when no positive references exist', async () => {
    productoRepo.findOne.mockResolvedValue({
      id: 'p2',
      tenantId: 'tenant-1',
      activo: true,
      precioCosto: '0.00',
      precioVenta: '0.00',
      categoriaId: 'cat-1',
    } as Producto);
    productoRepo.find.mockResolvedValue([]);

    const res = await service.getSuggestion({
      productoId: 'p2',
      nuevoPrecioCosto: 100,
    });

    expect(res.data.fuente).toBe('margen_default');
    expect(res.data.margenUsadoPct).toBe(30);
    expect(res.data.precioSugerido).toBe(130);
  });
});
