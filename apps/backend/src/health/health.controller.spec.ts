import { Test, TestingModule } from '@nestjs/testing';

import type { RequestWithId } from '../common/http/request-with-id';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('returns standard success envelope', () => {
    const req = { requestId: 'test-request-id' } as RequestWithId;
    const body = controller.getHealth(req);
    expect(body.data.status).toBe('ok');
    expect(body.meta.requestId).toBe('test-request-id');
    expect(typeof body.meta.timestamp).toBe('string');
  });
});
