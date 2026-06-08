import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import { DEMO_USER_SUB } from './helpers/e2e-constants';
import { runSeedDemo } from './helpers/run-seed-demo';
import { signTestJwt } from './helpers/sign-test-jwt';

describe('NB-PAS-002 pasarela unificada (e2e)', () => {
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

  it('GET /pagos/pasarela/estado sin params responde 400', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/pagos/pasarela/estado')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET /pagos/pasarela/estado con id inexistente responde 404', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/pagos/pasarela/estado')
      .query({ transaccion_id: '00000000-0000-4000-8000-000000009999' })
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('POST /pagos/webhook/:proveedor/:id responde 404 si integracion no existe', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/pagos/webhook/mercado_pago/00000000-0000-4000-8000-000000009999')
      .send({ type: 'payment' })
      .expect(404);
  });
});
