import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { Tenant } from '../config/entities/tenant.entity';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { CajaTesoreria } from './entities/caja-tesoreria.entity';
import { TesoreriaContextService } from './tesoreria-context.service';

describe('TesoreriaContextService', () => {
  let service: TesoreriaContextService;
  let moduloRepo: jest.Mocked<Pick<Repository<ModuloConfig>, 'findOne'>>;
  let tenantRepo: jest.Mocked<Pick<Repository<Tenant>, 'findOne'>>;
  let cajaRepo: jest.Mocked<Pick<Repository<CajaTesoreria>, 'findOne'>>;

  beforeEach(async () => {
    moduloRepo = { findOne: jest.fn().mockResolvedValue({ facturadorSimple: true }) };
    tenantRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'tenant-1',
        businessPrefs: { cajaInterna: { habilitado: true, alcance: 'tenant' } },
      }),
    };
    cajaRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'caja-1', tenantId: 'tenant-1', activa: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TesoreriaContextService,
        { provide: getRepositoryToken(CajaTesoreria), useValue: cajaRepo },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(Sucursal), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        {
          provide: DataSource,
          useValue: {
            query: jest.fn().mockResolvedValue([{ saldo: '1000' }]),
          },
        },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
      ],
    }).compile();

    service = module.get(TesoreriaContextService);
  });

  it('rechaza sin facturador_simple', async () => {
    moduloRepo.findOne.mockResolvedValue({ facturadorSimple: false } as ModuloConfig);
    await expect(service.resolve()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('resuelve caja y saldo', async () => {
    const ctx = await service.resolve();
    expect(ctx.cajaTesoreriaId).toBe('caja-1');
    expect(ctx.saldoEfectivo).toBe(1000);
  });
});
