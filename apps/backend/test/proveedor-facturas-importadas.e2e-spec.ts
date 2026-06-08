import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import { DEMO_PROVEEDOR_ID, DEMO_USER_SUB } from './helpers/e2e-constants';
import { runSeedDemo } from './helpers/run-seed-demo';
import { signTestJwt } from './helpers/sign-test-jwt';

const PROVEEDOR_INEXISTENTE = '00000000-0000-4000-8000-000000000097';

describe('NB-PROV-011 facturas importadas proveedor (e2e)', () => {
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

  it('GET /suppliers/:id/facturas-importadas responde 200 con paginación', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${DEMO_PROVEEDOR_ID}/facturas-importadas`)
      .query({ pagina: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body.facturas)).toBe(true);
    expect(res.body).toMatchObject({
      total: expect.any(Number),
      pagina: 1,
      totalPaginas: expect.any(Number),
      porPagina: 10,
    });
  });

  it('GET facturas-importadas proveedor inexistente responde 404', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${PROVEEDOR_INEXISTENTE}/facturas-importadas`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
