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

describe('NB-IMP-014 import preflight (e2e)', () => {
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

  it('POST /importaciones/preflight sin filas responde 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/importaciones/preflight')
      .set('Authorization', `Bearer ${token}`)
      .send({ filas: [] })
      .expect(400);
  });

  it('POST /importaciones/preflight matchea producto demo por código', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/importaciones/preflight')
      .set('Authorization', `Bearer ${token}`)
      .send({
        filas: [{ fila_original: 1, codigo: 'YER-001', nombre: 'Yerba mate 1 kg', unidad: 'kg' }],
        proveedor_id: null,
        sucursal_id: DEMO_SUCURSAL_ID,
      })
      .expect(200);

    expect(res.body.matches['1']).toBeDefined();
    expect(Array.isArray(res.body.matches['1'])).toBe(true);
    expect(res.body.matches['1'].length).toBeGreaterThanOrEqual(1);
    expect(res.body.matches['1'][0].codigo).toBe('YER-001');
    expect(res.body.requiere_resolucion).toBeDefined();
  });
});
