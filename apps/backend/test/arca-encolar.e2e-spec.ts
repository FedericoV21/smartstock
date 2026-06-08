import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import {
  DEMO_COMPROBANTE_PENDIENTE_ARCA,
  DEMO_USER_SUB,
} from './helpers/e2e-constants';
import { runSeedDemo } from './helpers/run-seed-demo';
import { signTestJwt } from './helpers/sign-test-jwt';
import pg from 'pg';

const COMPROBANTE_INEXISTENTE = '00000000-0000-4000-8000-000000000096';

async function clearArcaJob(comprobanteId: string): Promise<void> {
  const client = new pg.Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number.parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'smartstock_backend',
  });
  await client.connect();
  try {
    await client.query('DELETE FROM public.arca_job WHERE comprobante_id = $1', [comprobanteId]);
  } finally {
    await client.end().catch(() => {});
  }
}

describe('NB-FAC-016 arca-encolar (e2e)', () => {
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

  it('POST arca-encolar comprobante demo responde 202', async () => {
    await clearArcaJob(DEMO_COMPROBANTE_PENDIENTE_ARCA);

    const res = await request(app.getHttpServer())
      .post(
        `/api/v1/facturacion/comprobantes/${DEMO_COMPROBANTE_PENDIENTE_ARCA}/arca-encolar`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(202);

    expect(res.body.job_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(typeof res.body.mensaje).toBe('string');
  });

  it('POST arca-encolar comprobante inexistente responde 404', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/facturacion/comprobantes/${COMPROBANTE_INEXISTENTE}/arca-encolar`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('POST arca-encolar duplicado responde 409', async () => {
    await request(app.getHttpServer())
      .post(
        `/api/v1/facturacion/comprobantes/${DEMO_COMPROBANTE_PENDIENTE_ARCA}/arca-encolar`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });
});
