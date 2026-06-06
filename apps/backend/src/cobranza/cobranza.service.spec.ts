import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { DataSource } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { Comprobante } from '../facturacion/entities/comprobante.entity';
import { Cliente } from '../catalog/entities/cliente.entity';
import { CobranzaReciboService } from './cobranza-recibo.service';
import { CobranzaService } from './cobranza.service';
import { CobranzaFactura } from './entities/cobranza-factura.entity';
import { CobranzaPago } from './entities/cobranza-pago.entity';
import { CuentaCorriente } from '../importaciones/entities/cuenta-corriente.entity';

describe('CobranzaService', () => {
  let service: CobranzaService;
  let moduloRepo: jest.Mocked<Pick<Repository<ModuloConfig>, 'findOne'>>;
  let cobranzaRepo: jest.Mocked<
    Pick<Repository<CobranzaFactura>, 'findOne' | 'createQueryBuilder' | 'find'>
  >;

  beforeEach(async () => {
    moduloRepo = { findOne: jest.fn() };
    cobranzaRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        CobranzaService,
        { provide: DataSource, useValue: { query: jest.fn() } },
        { provide: getRepositoryToken(CobranzaFactura), useValue: cobranzaRepo },
        { provide: getRepositoryToken(CobranzaPago), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Comprobante), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Cliente), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(CuentaCorriente), useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() } },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        { provide: getRepositoryToken(Tenant), useValue: { findOne: jest.fn().mockResolvedValue({ puntoDeVenta: 1 }) } },
        { provide: CobranzaReciboService, useValue: { emitirTrasPago: jest.fn() } },
        { provide: TenantContext, useValue: { getTenantId: () => 'tenant-1' } },
      ],
    }).compile();

    service = module.get(CobranzaService);
  });

  it('rechaza pendientes sin facturador_simple', async () => {
    moduloRepo.findOne.mockResolvedValue({ facturadorSimple: false } as ModuloConfig);
    await expect(service.listPendientes()).rejects.toThrow(ForbiddenException);
  });

  it('lista campa├▒a vac├¡a', async () => {
    moduloRepo.findOne.mockResolvedValue({ facturadorSimple: true } as ModuloConfig);
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    cobranzaRepo.createQueryBuilder.mockReturnValue(qb as never);

    const res = await service.listPendientes();
    expect(res.items).toEqual([]);
    expect(res.count).toBe(0);
    expect(res.vencidosCount).toBe(0);
  });
});
