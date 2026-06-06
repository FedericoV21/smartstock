import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Producto } from '../products/entities/producto.entity';
import { ProductoPromocion } from './entities/producto-promocion.entity';
import { PromocionComboItem } from './entities/promocion-combo-item.entity';
import { PromocionSucursal } from './entities/promocion-sucursal.entity';
import { Promocion } from './entities/promocion.entity';
import { PromocionTipo } from './enums/promocion-tipo.enum';
import { PromotionsService } from './promotions.service';

describe('PromotionsService', () => {
  let service: PromotionsService;
  let promocionQb: {
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    getMany: jest.Mock;
  };
  let productoPromocionQb: {
    innerJoinAndSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    getMany: jest.Mock;
  };

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const sucursalId = 'd0000001-0001-4001-8001-000000000001';

  beforeEach(async () => {
    promocionQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: 'e0000001-0001-4001-8001-000000000001',
          tenantId,
          sucursalId,
          nombre: '10% off',
          tipo: PromocionTipo.porcentaje_off,
          cantidadLleva: null,
          cantidadPaga: null,
          unidadDescuento: null,
          porcentaje: '10.00',
          cantidadMinima: null,
          rangosVolumen: null,
          precioCombo: null,
          vigenteDesde: null,
          vigenteHasta: null,
          diasSemana: null,
          activa: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    };
    productoPromocionQb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromotionsService,
        {
          provide: getRepositoryToken(Promocion),
          useValue: { createQueryBuilder: jest.fn(() => promocionQb), findOne: jest.fn(), find: jest.fn(), update: jest.fn() },
        },
        {
          provide: getRepositoryToken(ProductoPromocion),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            createQueryBuilder: jest.fn(() => productoPromocionQb),
          },
        },
        {
          provide: getRepositoryToken(PromocionComboItem),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(PromocionSucursal),
          useValue: { find: jest.fn().mockResolvedValue([{ promocionId: 'e0000001-0001-4001-8001-000000000001', sucursalId }]) },
        },
        {
          provide: getRepositoryToken(Sucursal),
          useValue: {
            find: jest.fn().mockResolvedValue([
              { id: sucursalId, codigo: 'CASA', nombre: 'Casa Central', activa: true },
            ]),
          },
        },
        { provide: getRepositoryToken(Producto), useValue: { find: jest.fn() } },
        { provide: DataSource, useValue: { transaction: jest.fn(), manager: {} } },
        { provide: TenantContext, useValue: { getTenantId: () => tenantId } },
        {
          provide: SucursalContext,
          useValue: {
            requireSucursalId: jest.fn().mockResolvedValue(sucursalId),
            resolveSucursalId: jest.fn().mockResolvedValue(sucursalId),
          },
        },
      ],
    }).compile();

    service = module.get(PromotionsService);
  });

  it('list returns promociones for branch scope', async () => {
    const res = await service.list({});
    expect(res.data.sucursalId).toBe(sucursalId);
    expect(res.data.promociones).toHaveLength(1);
    expect(res.data.promociones[0].nombre).toBe('10% off');
  });

  it('buildActiveMap returns empty map when no links', async () => {
    const res = await service.buildActiveMap(['b0000001-0001-4001-8001-000000000002']);
    expect(res.data.mapa).toEqual({});
    expect(res.data.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
