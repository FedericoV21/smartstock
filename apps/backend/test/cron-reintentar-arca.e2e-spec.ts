import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import { runSeedDemo } from './helpers/run-seed-demo';

describe('NB-CRON-001 cron reintentar-arca (e2e)', () => {
  let app: INestApplication<App>;
  let cronSecret: string;

  beforeAll(async () => {
    await runSeedDemo();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const config = app.get(ConfigService);
    configureApp(app, config);
    await app.init();

    cronSecret = config.get<string>('CRON_SECRET', 'e2e-cron-secret');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET reintentar-arca sin auth responde 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/cron/reintentar-arca').expect(401);
  });

  it('GET reintentar-arca con CRON_SECRET procesa lote', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/cron/reintentar-arca')
      .set('Authorization', `Bearer ${cronSecret}`)
      .expect(200);

    expect(typeof res.body.procesados).toBe('number');
    if (res.body.procesados === 0) {
      expect(res.body.mensaje).toBe('Sin comprobantes pendientes');
    } else {
      expect(typeof res.body.exitosos).toBe('number');
      expect(typeof res.body.a_error_arca).toBe('number');
    }
  });

  it('POST arca-procesar con CRON_SECRET responde 200', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cron/arca-procesar')
      .set('Authorization', `Bearer ${cronSecret}`)
      .expect(200);

    expect(typeof res.body.reset_stale).toBe('number');
    expect(typeof res.body.claimed).toBe('number');
  });
});
