import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { SucursalContext } from '../branches/sucursal-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { ArcaConfig } from './entities/arca-config.entity';
import { ArcaAmbiente } from './enums/arca-ambiente.enum';
import { ArcaCryptoService } from './crypto/arca-crypto.service';
import { ArcaService } from './arca.service';

describe('ArcaService', () => {
  let service: ArcaService;
  let repo: jest.Mocked<Pick<Repository<ArcaConfig>, 'findOne' | 'create' | 'save'>>;

  const sucursalId = 'd0000001-0001-4001-8001-000000000001';

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn((input) => input as ArcaConfig),
      save: jest.fn(async (input) => ({
        ...(input as ArcaConfig),
        updatedAt: new Date('2026-04-19T00:00:00.000Z'),
      })),
    } as unknown as typeof repo;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArcaService,
        { provide: getRepositoryToken(ArcaConfig), useValue: repo },
        {
          provide: getRepositoryToken(ModuloConfig),
          useValue: { findOne: jest.fn().mockResolvedValue({ facturadorArca: true }) },
        },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
        {
          provide: SucursalContext,
          useValue: { requireSucursalId: jest.fn().mockResolvedValue(sucursalId) },
        },
        { provide: ArcaCryptoService, useValue: { encrypt: jest.fn((v: string) => `enc:${v}`) } },
      ],
    }).compile();
    service = module.get(ArcaService);
  });

  it('returns default view when no config exists', async () => {
    repo.findOne.mockResolvedValue(null);
    const res = await service.getConfig();
    expect(res.data.ambiente).toBe(ArcaAmbiente.homologacion);
    expect(res.data.hasCertificado).toBe(false);
    expect(res.data.sucursalId).toBe(sucursalId);
  });

  it('upserts encrypted certificates', async () => {
    repo.findOne.mockResolvedValue(null);
    const res = await service.upsertConfig({
      certificadoPem: 'CERT',
      clavePrivadaPem: 'KEY',
      ambiente: ArcaAmbiente.produccion,
    });
    expect(repo.save).toHaveBeenCalled();
    expect(res.data.hasCertificado).toBe(true);
    expect(res.data.ambiente).toBe(ArcaAmbiente.produccion);
  });
});
