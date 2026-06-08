import { join } from 'node:path';

import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import { DEMO_SUCURSAL_ID, DEMO_TENANT_ID, DEMO_USER_SUB } from './helpers/e2e-constants';
import { runSeedDemo } from './helpers/run-seed-demo';
import { signTestJwt } from './helpers/sign-test-jwt';

async function enableDespieceForDemo(): Promise<void> {
  const client = new pg.Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number.parseInt(process.env.DB_PORT ?? '5432', 10),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'smartstock_backend',
  });
  await client.connect();
  try {
    await client.query(
      `UPDATE public.modulo_config SET despiece_carniceria = true WHERE tenant_id = $1`,
      [DEMO_TENANT_ID],
    );
    await client.query(
      `UPDATE public.tenant
       SET business_prefs = COALESCE(business_prefs, '{}'::jsonb) || '{"despieceCarniceriaHabilitado": true}'::jsonb
       WHERE id = $1`,
      [DEMO_TENANT_ID],
    );
  } finally {
    await client.end().catch(() => {});
  }
}

describe('NB-DES-001 despiece (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const { execSync } = await import('node:child_process');
    execSync('npm run migration:run', {
      cwd: join(__dirname, '..'),
      stdio: 'inherit',
      env: process.env,
    });
    await runSeedDemo();
    await enableDespieceForDemo();

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

  it('POST /despiece/calcular sin auth responde 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/despiece/calcular')
      .send({
        costo_kg_padre: 100,
        peso_total_kg: 10,
        rentabilidad_objetivo_pct: 20,
        cortes: [{ nombre: 'Asado', kg_rendimiento: 5, factor_ajuste_pct: 0 }],
      })
      .expect(401);
  });

  it('POST /despiece/calcular con auth responde 200 con resultado', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/despiece/calcular')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Sucursal-Id', DEMO_SUCURSAL_ID)
      .send({
        costo_kg_padre: 100,
        peso_total_kg: 10,
        rentabilidad_objetivo_pct: 20,
        cortes: [
          { nombre: 'Asado', kg_rendimiento: 5, factor_ajuste_pct: 0 },
          { nombre: 'Vacío', kg_rendimiento: 5, factor_ajuste_pct: 0.2 },
        ],
      })
      .expect(200);

    expect(res.body.resultado).toBeDefined();
    expect(res.body.resultado.cortes).toHaveLength(2);
    expect(res.body.resultado.costoTotal).toBe(1000);
  });

  it('GET /despiece/plantillas responde 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/despiece/plantillas')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Sucursal-Id', DEMO_SUCURSAL_ID)
      .expect(200);

    expect(Array.isArray(res.body.plantillas)).toBe(true);
  });
});
