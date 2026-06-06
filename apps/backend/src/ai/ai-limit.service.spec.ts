import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { PlanTipo } from '../config/enums/plan-tipo.enum';
import { Tenant } from '../config/entities/tenant.entity';
import { ImportacionLog } from '../importaciones/entities/importacion-log.entity';
import { AiLimitService } from './ai-limit.service';

describe('AiLimitService', () => {
  let service: AiLimitService;
  let importLogRepo: { createQueryBuilder: jest.Mock };
  let tenantRepo: { findOne: jest.Mock };
  let moduloRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(2),
    };
    importLogRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    tenantRepo = {
      findOne: jest.fn().mockResolvedValue({ plan: PlanTipo.base, iaIlimitadaOrigen: null }),
    };
    moduloRepo = { findOne: jest.fn().mockResolvedValue({ iaPrecios: true }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiLimitService,
        { provide: getRepositoryToken(ImportacionLog), useValue: importLogRepo },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
      ],
    }).compile();

    service = module.get(AiLimitService);
  });

  it('rechaza si ia_precios est├í deshabilitado', async () => {
    moduloRepo.findOne.mockResolvedValue({ iaPrecios: false });
    await expect(service.getLimit()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('devuelve permitido seg├║n plan base y usadas', async () => {
    const res = await service.getLimit();
    expect(res.data.usadas).toBe(2);
    expect(res.data.limite).toBe(4);
    expect(res.data.permitido).toBe(true);
  });

  it('plan completo tiene l├¡mite null', async () => {
    tenantRepo.findOne.mockResolvedValue({ plan: PlanTipo.completo, iaIlimitadaOrigen: null });
    const res = await service.getLimit();
    expect(res.data.limite).toBeNull();
    expect(res.data.permitido).toBe(true);
  });
});
