import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Categoria } from '../catalog/entities/categoria.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Movimiento } from '../inventory/entities/movimiento.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { Producto } from '../products/entities/producto.entity';
import { AnalyzerService } from './analyzer.service';
import { CierreMensual } from './entities/cierre-mensual.entity';
import { RadarInflacion } from './entities/radar-inflacion.entity';
import { PriceListsService } from './price-lists/price-lists.service';

describe('AnalyzerService', () => {
  let service: AnalyzerService;
  let priceListsService: jest.Mocked<Pick<PriceListsService, 'countPendientes' | 'getOpportunityAlerts'>>;
  let moduloRepo: jest.Mocked<Pick<Repository<ModuloConfig>, 'findOne'>>;
  let cierreRepo: jest.Mocked<Pick<Repository<CierreMensual>, 'findOne' | 'find' | 'save' | 'create'>>;
  let compItemQb: {
    innerJoin: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    select: jest.Mock;
    getRawMany: jest.Mock;
  };

  beforeEach(async () => {
    priceListsService = {
      countPendientes: jest.fn().mockResolvedValue(3),
      getOpportunityAlerts: jest.fn().mockResolvedValue({ alertas: [], total: 0 }),
    };
    moduloRepo = { findOne: jest.fn().mockResolvedValue({ analizadorRentabilidad: true }) };
    cierreRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((row) => Promise.resolve({ id: 'cierre-1', ...row })),
      create: jest.fn().mockImplementation((row) => row),
    };
    compItemQb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyzerService,
        { provide: getRepositoryToken(Comprobante), useValue: { find: jest.fn().mockResolvedValue([]) } },
        {
          provide: getRepositoryToken(ComprobanteItem),
          useValue: { createQueryBuilder: jest.fn().mockReturnValue(compItemQb) },
        },
        { provide: getRepositoryToken(Producto), useValue: { find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(Categoria), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Cliente), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Proveedor), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(CierreMensual), useValue: cierreRepo },
        {
          provide: getRepositoryToken(RadarInflacion),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
            }),
          },
        },
        { provide: getRepositoryToken(Movimiento), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
        { provide: PriceListsService, useValue: priceListsService },
      ],
    }).compile();

    service = module.get(AnalyzerService);
  });

  it('rechaza sin analizador_rentabilidad', async () => {
    moduloRepo.findOne.mockResolvedValue({ analizadorRentabilidad: false } as ModuloConfig);
    await expect(service.getMargin({})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getMargin devuelve estructura vac├¡a sin ventas', async () => {
    const res = await service.getMargin({});
    expect(res.data.productos).toEqual([]);
    expect(res.data.tendencia.direccion).toBe('estable');
  });

  it('getOpportunityAlerts delega a PriceListsService', async () => {
    const res = await service.getOpportunityAlerts();
    expect(res.data.total).toBe(0);
    expect(priceListsService.getOpportunityAlerts).toHaveBeenCalledWith('tenant-1');
  });
});
