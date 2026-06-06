import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { StockSucursal } from '../branches/entities/stock-sucursal.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { Proveedor } from '../catalog/entities/proveedor.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { ComprobanteItem } from '../facturacion/entities/comprobante-item.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';
import { Producto } from '../products/entities/producto.entity';
import { ReportsAdvancedService } from './reports-advanced.service';

describe('ReportsAdvancedService', () => {
  let service: ReportsAdvancedService;
  let moduloRepo: jest.Mocked<Pick<Repository<ModuloConfig>, 'findOne'>>;
  let cuentaRepo: jest.Mocked<Pick<Repository<CuentaCorriente>, 'find'>>;
  let clienteRepo: jest.Mocked<Pick<Repository<Cliente>, 'find'>>;
  let compItemRepo: jest.Mocked<Pick<Repository<ComprobanteItem>, 'createQueryBuilder'>>;
  let comprobanteRepo: jest.Mocked<Pick<Repository<Comprobante>, 'find'>>;

  beforeEach(async () => {
    moduloRepo = { findOne: jest.fn().mockResolvedValue({ facturadorSimple: true }) };
    cuentaRepo = {
      find: jest.fn().mockResolvedValue([
        { clienteId: 'cli-1', saldo: '150.5', tipoCuenta: 'cliente' },
        { clienteId: 'cli-2', saldo: '-20', tipoCuenta: 'cliente' },
      ]),
    };
    clienteRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'cli-1', nombre: 'Juan', razonSocial: null },
        { id: 'cli-2', nombre: 'Ana', razonSocial: 'Ana SA' },
      ]),
    };
    compItemRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      }),
    };
    comprobanteRepo = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsAdvancedService,
        { provide: getRepositoryToken(Comprobante), useValue: comprobanteRepo },
        { provide: getRepositoryToken(ComprobanteItem), useValue: compItemRepo },
        { provide: getRepositoryToken(CuentaCorriente), useValue: cuentaRepo },
        { provide: getRepositoryToken(Producto), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(Proveedor), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Cliente), useValue: clienteRepo },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        {
          provide: getRepositoryToken(StockSucursal),
          useValue: { find: jest.fn(), createQueryBuilder: jest.fn() },
        },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
        { provide: SucursalContext, useValue: { resolveSucursalId: jest.fn().mockResolvedValue('branch-1') } },
      ],
    }).compile();

    service = module.get(ReportsAdvancedService);
  });

  it('rechaza reportes sin facturador_simple', async () => {
    moduloRepo.findOne.mockResolvedValue({ facturadorSimple: false } as ModuloConfig);
    await expect(service.getCustomerDebt({})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getCustomerDebt devuelve saldos desde cuenta_corriente', async () => {
    const result = await service.getCustomerDebt({});
    expect('data' in result).toBe(true);
    if ('data' in result) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.resumen.deuda_total).toBe(150.5);
      expect(result.data.resumen.clientes_con_saldo_a_favor).toBe(1);
      expect(result.data.nota).toContain('cobranza_factura');
    }
  });

  it('getNetProfits devuelve resumen y serie vac├¡a sin comprobantes', async () => {
    const result = await service.getNetProfits({ periodo: 'mes' });
    expect('data' in result).toBe(true);
    if ('data' in result) {
      expect(result.data.resumen.ventas_netas).toBe(0);
      expect(result.data.serie).toEqual([]);
    }
  });
});
