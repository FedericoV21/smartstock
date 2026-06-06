import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { Sucursal } from '../branches/entities/sucursal.entity';
import { BusinessPrefsService } from './business-prefs.service';
import { Tenant } from './entities/tenant.entity';

describe('BusinessPrefsService', () => {
  let service: BusinessPrefsService;
  let tenantRepo: jest.Mocked<Pick<Repository<Tenant>, 'findOne' | 'save'>>;
  let sucursalRepo: jest.Mocked<Pick<Repository<Sucursal>, 'findOne' | 'save'>>;

  const tenantId = '00000000-0000-4000-8000-000000000001';
  const sucursalId = 'd0000001-0001-4001-8001-000000000001';

  beforeEach(async () => {
    tenantRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: tenantId,
        businessPrefs: { precioCostoSoloSube: true },
      }),
      save: jest.fn(async (row) => row as Tenant),
    } as unknown as typeof tenantRepo;

    sucursalRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (row) => row as Sucursal),
    } as unknown as typeof sucursalRepo;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessPrefsService,
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(Sucursal), useValue: sucursalRepo },
        {
          provide: TenantContext,
          useValue: { getTenantId: () => tenantId },
        },
      ],
    }).compile();

    service = module.get(BusinessPrefsService);
  });

  it('returns effective prefs for tenant + sucursal', async () => {
    sucursalRepo.findOne.mockResolvedValue({
      id: sucursalId,
      tenantId,
      businessPrefs: { registrarLotesPorIngreso: false },
    } as Sucursal);

    const result = await service.getBusinessPrefs(false, sucursalId);
    expect(result.sucursal_id).toBe(sucursalId);
    expect(result.effective_business_prefs.precioCostoSoloSube).toBe(true);
    expect(result.effective_business_prefs.registrarLotesPorIngreso).toBe(false);
  });

  it('patches tenant scope as admin', async () => {
    const result = await service.patchBusinessPrefs(
      { scope: 'tenant', business_prefs: { precioCostoSoloSube: false } },
      'admin',
    );
    expect(result.ok).toBe(true);
    expect(tenantRepo.save).toHaveBeenCalled();
  });

  it('rejects tenant patch for operador', async () => {
    await expect(
      service.patchBusinessPrefs(
        { scope: 'tenant', business_prefs: { precioCostoSoloSube: false } },
        'operador',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('inherits sucursal prefs from tenant', async () => {
    sucursalRepo.findOne.mockResolvedValue({ id: sucursalId, tenantId } as Sucursal);
    const result = await service.patchBusinessPrefs(
      { sucursal_id: sucursalId, inherit_from_tenant: true },
      'admin',
    );
    expect(result.business_prefs).toBeNull();
    expect(sucursalRepo.save).toHaveBeenCalled();
  });

  it('404 when sucursal missing in for_config', async () => {
    sucursalRepo.findOne.mockResolvedValue(null);
    await expect(service.getBusinessPrefs(true, sucursalId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400 on invalid business_prefs payload', async () => {
    await expect(
      service.patchBusinessPrefs({ scope: 'tenant', business_prefs: {} }, 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
