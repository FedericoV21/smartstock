import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from './entities/modulo-config.entity';
import { Tenant } from './entities/tenant.entity';
import { PlanService } from './plan.service';
import { PlanTipo } from './enums/plan-tipo.enum';

describe('PlanService', () => {
  let service: PlanService;
  const tenantRepo = { findOne: jest.fn(), save: jest.fn() };
  const moduloRepo = { findOne: jest.fn(), save: jest.fn() };

  beforeEach(async () => {
    tenantRepo.findOne.mockResolvedValue({
      id: 't1',
      plan: PlanTipo.base,
      iaIlimitadaOrigen: null,
    });
    moduloRepo.findOne.mockResolvedValue({
      tenantId: 't1',
      facturadorSimple: false,
      facturadorArca: false,
      facturadorPos: false,
      pedidos: false,
      presupuestos: false,
      iaPrecios: false,
      analizadorRentabilidad: false,
    });
    tenantRepo.save.mockImplementation(async (v) => v);
    moduloRepo.save.mockImplementation(async (v) => v);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanService,
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
        { provide: TenantContext, useValue: { getTenantId: () => 't1' } },
      ],
    }).compile();

    service = module.get(PlanService);
  });

  it('activa plan completo y habilita módulos', async () => {
    const result = await service.activatePlan(PlanTipo.completo);
    expect(result).toEqual({ success: true, plan: PlanTipo.completo });
    expect(moduloRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ iaPrecios: true, presupuestos: true }),
    );
  });
});
