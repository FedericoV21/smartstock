import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import {
  DEMO_CLIENTE_ID,
  DEMO_PROVEEDOR_ID,
  DEMO_USER_SUB,
} from './helpers/e2e-constants';
import { runSeedDemo } from './helpers/run-seed-demo';
import { signTestJwt } from './helpers/sign-test-jwt';

describe('NB-RPT-003 reportes recibos y extractos CC (e2e)', () => {
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

  it('GET /reports/recibos responde 200 con estructura de reporte', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/recibos')
      .query({ periodo: 'mes' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.periodo).toBeDefined();
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.resumen).toMatchObject({
      cantidad: expect.any(Number),
      total_monto: expect.any(Number),
    });
  });

  it('GET /reports/extracto-cuenta-corriente sin cliente_id responde 400', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/reports/extracto-cuenta-corriente')
      .query({ periodo: 'mes' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET /reports/extracto-cuenta-corriente con cliente demo responde 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/extracto-cuenta-corriente')
      .query({ periodo: 'mes', cliente_id: DEMO_CLIENTE_ID })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.cliente_id).toBe(DEMO_CLIENTE_ID);
    expect(Array.isArray(res.body.lineas)).toBe(true);
  });

  it('GET /reports/extracto-cuenta-corriente-proveedor sin proveedor_id responde 400', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/reports/extracto-cuenta-corriente-proveedor')
      .query({ periodo: 'mes' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET /reports/extracto-cuenta-corriente-proveedor con proveedor demo responde 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/extracto-cuenta-corriente-proveedor')
      .query({ periodo: 'mes', proveedor_id: DEMO_PROVEEDOR_ID })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.proveedor_id).toBe(DEMO_PROVEEDOR_ID);
    expect(Array.isArray(res.body.lineas)).toBe(true);
  });
});
