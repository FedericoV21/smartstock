import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import { DEMO_SUCURSAL_ID, DEMO_USER_SUB } from './helpers/e2e-constants';
import { runSeedDemo } from './helpers/run-seed-demo';
import { signTestJwt } from './helpers/sign-test-jwt';

describe('NB-MPT-002 mp-transferencia diagnostico y reportes (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    await runSeedDemo();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const config = app.get(ConfigService);
    configureApp(app, config);
    await app.init();

    token = signTestJwt({ sub: DEMO_USER_SUB, rol: 'admin' });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /pagos/mp-transferencia/diagnostico responde 403 sin transferencia habilitada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/pagos/mp-transferencia/diagnostico')
      .query({ sucursal_id: DEMO_SUCURSAL_ID })
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body.error.details).toMatch(/Transferencia MP/i);
  });

  it('POST /pagos/mp-transferencia/configurar-reportes responde 403 sin transferencia habilitada', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/pagos/mp-transferencia/configurar-reportes')
      .set('Authorization', `Bearer ${token}`)
      .send({ sucursal_id: DEMO_SUCURSAL_ID })
      .expect(403);

    expect(res.body.error.details).toMatch(/Transferencia MP/i);
  });

  it('GET /pagos/mp-transferencia/diagnostico rechaza visor', async () => {
    const visorToken = signTestJwt({ sub: DEMO_USER_SUB, rol: 'visor' });
    await request(app.getHttpServer())
      .get('/api/v1/pagos/mp-transferencia/diagnostico')
      .query({ sucursal_id: DEMO_SUCURSAL_ID })
      .set('Authorization', `Bearer ${visorToken}`)
      .expect(403);
  });
});
