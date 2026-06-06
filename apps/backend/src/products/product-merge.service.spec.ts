import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { TenantContext } from '../auth/tenant-context.service';
import { ProductMergeService } from './product-merge.service';

describe('ProductMergeService', () => {
  let service: ProductMergeService;
  let dataSource: { query: jest.Mock };
  let tenantContext: { getTenantId: jest.Mock };

  beforeEach(async () => {
    dataSource = {
      query: jest.fn().mockResolvedValue([
        {
          result: {
            dry_run: true,
            survivor_id: 'surv-1',
            loser_id: 'lose-1',
          },
        },
      ]),
    };
    tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductMergeService,
        { provide: DataSource, useValue: dataSource },
        { provide: TenantContext, useValue: tenantContext },
      ],
    }).compile();

    service = module.get(ProductMergeService);
  });

  it('llama fusionar_productos con par├ímetros del tenant', async () => {
    const res = await service.merge({
      survivorId: 'surv-1',
      loserIds: ['lose-1'],
      dryRun: true,
    });

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('fusionar_productos'),
      ['tenant-1', 'surv-1', ['lose-1'], expect.any(String), true],
    );
    expect(res.data).toMatchObject({ dry_run: true });
  });

  it('rechaza mismo survivor y loser', async () => {
    await expect(
      service.merge({ survivorId: 'same', loserIds: ['same'] }),
    ).rejects.toThrow(BadRequestException);
  });
});
