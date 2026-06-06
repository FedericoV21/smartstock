import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ModuloConfig } from '../config/entities/modulo-config.entity';
import { SupplierMergeService } from './supplier-merge.service';

describe('SupplierMergeService', () => {
  let service: SupplierMergeService;
  let dataSource: { query: jest.Mock };
  let moduloRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    dataSource = {
      query: jest.fn().mockResolvedValue([
        {
          result: {
            dry_run: true,
            survivor_id: 'surv-1',
            loser_ids: ['lose-1'],
          },
        },
      ]),
    };
    moduloRepo = { findOne: jest.fn().mockResolvedValue({ stock: true }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierMergeService,
        { provide: DataSource, useValue: dataSource },
        { provide: TenantContext, useValue: { getTenantId: jest.fn().mockReturnValue('tenant-1') } },
        { provide: getRepositoryToken(ModuloConfig), useValue: moduloRepo },
      ],
    }).compile();

    service = module.get(SupplierMergeService);
  });

  it('llama fusionar_proveedores con par├ímetros del tenant', async () => {
    const res = await service.merge({
      survivorId: 'surv-1',
      loserIds: ['lose-1', 'lose-1'],
      dryRun: true,
    });

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('fusionar_proveedores'),
      ['tenant-1', 'surv-1', ['lose-1'], true],
    );
    expect(res.data).toMatchObject({ dry_run: true });
  });

  it('rechaza survivor entre losers', async () => {
    await expect(
      service.merge({ survivorId: 'same', loserIds: ['same'] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza si m├│dulo stock est├í deshabilitado', async () => {
    moduloRepo.findOne.mockResolvedValue({ stock: false });
    await expect(
      service.merge({ survivorId: 'surv-1', loserIds: ['lose-1'] }),
    ).rejects.toThrow(ForbiddenException);
  });
});
