import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import {
  DEMO_PRODUCTO_ID,
  DEMO_SUCURSAL_ID,
  DEMO_USER_SUB,
} from './helpers/e2e-constants';
import { runSeedDemo } from './helpers/run-seed-demo';
import { signTestJwt } from './helpers/sign-test-jwt';

describe('NB-PRD-015 productos extendidos (e2e)', () => {
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

  it('GET /products/:id/margin-tiers responde 200', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/products/${DEMO_PRODUCTO_ID}/margin-tiers`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.producto_id).toBe(DEMO_PRODUCTO_ID);
    expect(Array.isArray(res.body.tramos)).toBe(true);
  });

  it('PUT /products/:id/margin-tiers guarda y devuelve tramos', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/products/${DEMO_PRODUCTO_ID}/margin-tiers`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tramos: [{ cantidad_desde: 1, ganancia_pct: 30 }] })
      .expect(200);

    expect(res.body.tramos).toHaveLength(1);
    expect(res.body.tramos[0].ganancia_pct).toBe(30);
  });

  it('GET /products/:id/promotions responde 200 con array', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/products/${DEMO_PRODUCTO_ID}/promotions`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body.promociones)).toBe(true);
  });

  it('GET /products/plu-out-of-range sin digitos responde 400', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/products/plu-out-of-range')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET /products/plu-out-of-range con digitos responde 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/products/plu-out-of-range')
      .query({ digitos: 4, sucursal_id: DEMO_SUCURSAL_ID })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(typeof res.body.count).toBe('number');
    expect(res.body.digitos).toBe(4);
  });

  it('POST /products/clone-branch sin body válido responde 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/products/clone-branch')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
  });
});
