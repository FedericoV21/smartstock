import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { EstadoComprobante } from '../facturacion/enums/estado-comprobante.enum';
import { TipoComprobante } from '../facturacion/enums/tipo-comprobante.enum';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { Movimiento } from '../inventory/entities/movimiento.entity';
import { Producto } from '../products/entities/producto.entity';
import { Usuario } from '../users/entities/usuario.entity';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  let service: ReportsService;
  let moduloRepo: jest.Mocked<Pick<Repository<ModuloConfig>, 'findOne'>>;
  let comprobanteRepo: jest.Mocked<Pick<Repository<Comprobante>, 'find' | 'createQueryBuilder'>>;
  let cuentaRepo: jest.Mocked<Pick<Repository<CuentaCorriente>, 'find'>>;
  let sucursalContext: { resolveSucursalId: jest.Mock };

  beforeEach(async () => {
    moduloRepo = { findOne: jest.fn().mockResolvedValue({ facturadorSimple: true, facturadorPos: true }) };
    comprobanteRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'c1',
          tipo: TipoComprobante.factura_b,
          total: '1000',
          numeroOrden: 1,
          subtotal: '826.45',
          ivaMonto: '173.55',
          ivaPorcentaje: '21',
          fecha: '2026-06-01',
          numero: 1,
          estado: EstadoComprobante.emitido,
        },
        {
          id: 'c2',
          tipo: TipoComprobante.ticket,
          total: '500',
          numeroOrden: 2,
          subtotal: '500',
          ivaMonto: '0',
          ivaPorcentaje: '0',
          fecha: '2026-06-01',
          numero: 2,
          estado: EstadoComprobante.emitido,
        },
      ]),
      createQueryBuilder: jest.fn(),
    };
    cuentaRepo = { find: jest.fn().mockResolvedValue([{ saldo: '200' }]) };
    sucursalContext = { resolveSucursalId: jest.fn().mockResolvedValue('branch-1') };

    const compItemQb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    (comprobanteRepo.createQueryBuilder as jest.Mock).mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        {
          provide: getRepositoryToken(ComprobanteItem),
          useValue: { createQueryBuilder: jest.fn().mockReturnValue(compItemQb) },
        },
        { provide: getRepositoryToken(CuentaCorriente), useValue: cuentaRepo },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        { provide: getRepositoryToken(Movimiento), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Producto), useValue: {} },
        { provide: getRepositoryToken(Proveedor), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(StockSucursal), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Usuario), useValue: {} },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
        { provide: SucursalContext, useValue: sucursalContext },
      ],
    }).compile();

    service = module.get(ReportsService);
  });

  it('rechaza summary si facturador_simple est├í deshabilitado', async () => {
    moduloRepo.findOne.mockResolvedValue({ facturadorSimple: false } as ModuloConfig);
    await expect(service.getSummary({})).rejects.toThrow(ForbiddenException);
  });

  it('calcula KPIs de resumen', async () => {
    const res = await service.getSummary({ periodo: 'hoy' });
    expect(res.data.kpis.facturado).toBe(1500);
    expect(res.data.kpis.comprobantes_factura).toBe(1);
    expect(res.data.kpis.comprobantes_ticket).toBe(1);
    expect(res.data.kpis.deuda_cta_cte).toBe(200);
  });

  it('arma libro IVA con una factura', async () => {
    const res = await service.getLibroIva({ periodo: 'mes' });
    expect(res.data.resumen.cantidad).toBe(1);
    expect(res.data.items[0]?.tipo).toBe(TipoComprobante.factura_b);
  });

  it('rechaza sales-period-summary para operador', async () => {
    await expect(
      service.getSalesPeriodSummary({ periodo: 'hoy' }, { sub: 'u1', rol: 'operador' }),
    ).rejects.toThrow(ForbiddenException);
  });
});
