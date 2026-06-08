import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import { DEMO_NUMERO_ORDEN, DEMO_USER_SUB } from './helpers/e2e-constants';
import { runSeedDemo } from './helpers/run-seed-demo';
import { signTestJwt } from './helpers/sign-test-jwt';

describe('NB-ORD-001 orden lookup (e2e)', () => {
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

  it('GET ordenes/:numero_orden devuelve comprobantes y pedidos', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/ordenes/${DEMO_NUMERO_ORDEN}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.numero_orden).toBe(DEMO_NUMERO_ORDEN);
    expect(Array.isArray(res.body.documentos)).toBe(true);
    expect(res.body.documentos.length).toBeGreaterThanOrEqual(2);

    const tipos = res.body.documentos.map((d: { tipo: string }) => d.tipo);
    expect(tipos).toContain('factura_b');
    expect(tipos).toContain('pedido');

    for (const doc of res.body.documentos) {
      expect(typeof doc.id).toBe('string');
      expect(typeof doc.numero_formateado).toBe('string');
      expect(typeof doc.url_detalle).toBe('string');
    }
  });

  it('GET ordenes inválido responde 400', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ordenes/abc')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET orden inexistente responde 200 con documentos vacíos', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/ordenes/999999')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.numero_orden).toBe(999999);
    expect(res.body.documentos).toEqual([]);
  });
});
