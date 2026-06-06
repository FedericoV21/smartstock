import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';

describe('API smoke (e2e)', () => {
  let app: INestApplication<App> | undefined;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const config = app.get(ConfigService);
    configureApp(app, config);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/health responde ok sin JWT (ruta p├║blica)', async () => {
    const res = await request(app!.getHttpServer()).get('/api/v1/health').expect(200);

    expect(res.body?.data?.status).toBe('ok');
    expect(res.body?.data?.service).toBe('smartstock-backend');
    expect(res.body?.meta?.requestId).toBeDefined();
  });
});
