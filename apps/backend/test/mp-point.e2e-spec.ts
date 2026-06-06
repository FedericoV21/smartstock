import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { MpPointWebhookController } from '../src/mp-point/mp-point-webhook.controller';
import { MpPointWebhookService } from '../src/mp-point/mp-point-webhook.service';

describe('MP Point webhook (e2e)', () => {
  let app: INestApplication<App>;
  const webhookService = {
    handleWebhookHttp: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MpPointWebhookController],
      providers: [{ provide: MpPointWebhookService, useValue: webhookService }],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    webhookService.handleWebhookHttp.mockReset();
  });

  it('POST /pagos/mp-point/webhook responde ok cuando el servicio valida', async () => {
    webhookService.handleWebhookHttp.mockResolvedValue({ ok: true });

    const res = await request(app.getHttpServer())
      .post('/api/v1/pagos/mp-point/webhook')
      .query({ 'data.id': 'intent-e2e-1' })
      .set('x-signature', 'ts=1,v1=abc')
      .set('x-request-id', 'req-e2e')
      .send({})
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(webhookService.handleWebhookHttp).toHaveBeenCalledWith(
      expect.objectContaining({ intentId: 'intent-e2e-1' }),
    );
  });

  it('POST /pagos/mp-point/webhook 401 cuando firma inv├ílida', async () => {
    webhookService.handleWebhookHttp.mockRejectedValue(new UnauthorizedException());

    await request(app.getHttpServer())
      .post('/api/v1/pagos/mp-point/webhook')
      .query({ 'data.id': 'intent-bad' })
      .set('x-signature', 'ts=1,v1=bad')
      .expect(401);
  });

  it('POST /pagos/mp-point/webhook ok sin intent id (MP ruido)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/pagos/mp-point/webhook')
      .send({})
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(webhookService.handleWebhookHttp).not.toHaveBeenCalled();
  });
});
