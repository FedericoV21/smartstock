import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../../auth/tenant-context.service';
import { SucursalContext } from '../../branches/sucursal-context.service';
import { ArcaCryptoService } from '../crypto/arca-crypto.service';
import { ArcaConfig } from '../entities/arca-config.entity';
import { ArcaLog } from '../entities/arca-log.entity';
import { ArcaAmbiente } from '../enums/arca-ambiente.enum';
import { ArcaWsaaService } from './arca-wsaa.service';

describe('ArcaWsaaService', () => {
  let service: ArcaWsaaService;
  let configRepo: jest.Mocked<Pick<Repository<ArcaConfig>, 'findOne' | 'save'>>;
  let logRepo: jest.Mocked<Pick<Repository<ArcaLog>, 'create' | 'save'>>;

  const sucursalId = 'branch-1';

  beforeEach(async () => {
    configRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as unknown as typeof configRepo;
    logRepo = {
      create: jest.fn((v) => v as ArcaLog),
      save: jest.fn(),
    } as unknown as typeof logRepo;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArcaWsaaService,
        { provide: getRepositoryToken(ArcaConfig), useValue: configRepo },
        { provide: getRepositoryToken(ArcaLog), useValue: logRepo },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
        {
          provide: SucursalContext,
          useValue: { requireSucursalId: jest.fn().mockResolvedValue(sucursalId) },
        },
        { provide: ArcaCryptoService, useValue: { decrypt: jest.fn((v: string) => v) } },
      ],
    }).compile();
    service = module.get(ArcaWsaaService);
  });

  it('returns cached ticket when still valid', async () => {
    configRepo.findOne.mockResolvedValue({
      tenantId: 'tenant-1',
      sucursalId,
      ambiente: ArcaAmbiente.homologacion,
      ticketAcceso: 'token',
      ticketSign: 'sign',
      ticketExpiracion: new Date(Date.now() + 60 * 60 * 1000),
    } as ArcaConfig);

    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const res = await service.ensureTicket();

    expect(res.data.source).toBe('cache');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('throws when config missing', async () => {
    configRepo.findOne.mockResolvedValue(null);
    await expect(service.ensureTicket()).rejects.toThrow(NotFoundException);
  });
});
