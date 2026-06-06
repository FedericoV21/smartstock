import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Categoria } from '../catalog/entities/categoria.entity';
import { UsersService } from '../users/users.service';
import { Producto } from './entities/producto.entity';
import { QendraExportService } from './qendra-export.service';

describe('QendraExportService', () => {
  let service: QendraExportService;
  let productoQb: {
    leftJoin: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    select: jest.Mock;
    orderBy: jest.Mock;
    offset: jest.Mock;
    limit: jest.Mock;
    getRawMany: jest.Mock;
    getRawOne: jest.Mock;
  };

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const sucursalId = 'd0000001-0001-4001-8001-000000000001';
  const user = { sub: 'user-1', tenant_id: tenantId, rol: 'admin' };

  beforeEach(async () => {
    productoQb = {
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          id: 'b0000001-0001-4001-8001-000000000006',
          codigo: 'FRU-KG',
          nombre: 'Fruta variada (balanza)',
          precio_venta: '1490.00',
          plu: '4012',
          es_pesable: true,
          unidad: 'kg',
          fecha_vencimiento: null,
          descripcion: 'Pesable PLU',
          categoria_id: null,
          categoria_nombre: null,
        },
      ]),
      getRawOne: jest.fn().mockResolvedValue({ n: '1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QendraExportService,
        {
          provide: getRepositoryToken(Producto),
          useValue: {
            createQueryBuilder: jest.fn(() => productoQb),
          },
        },
        {
          provide: getRepositoryToken(Categoria),
          useValue: {
            find: jest.fn().mockResolvedValue([
              {
                id: 'e0000001-0001-4001-8001-000000000002',
                nombre: 'Bebidas',
                activa: true,
                tenantId,
              },
            ]),
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

    service = module.get(QendraExportService);
  });

  it('rejects export without filters', async () => {
    await expect(service.exportCsv({}, user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns StreamableFile for producto_ids', async () => {
    const file = await service.exportCsv(
      { productoIds: ['b0000001-0001-4001-8001-000000000006'] },
      user,
    );
    expect(file).toBeDefined();
    expect(file.options.type).toContain('text/csv');
  });

  it('throws NotFound when no exportable rows', async () => {
    productoQb.getRawMany.mockResolvedValueOnce([]);
    await expect(
      service.exportCsv({ productoIds: ['b0000001-0001-4001-8001-000000000006'] }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
