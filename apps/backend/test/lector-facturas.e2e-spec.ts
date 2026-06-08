import { join } from 'node:path';

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

describe('NB-LEC-001 Lector facturas foundation (e2e)', () => {
  jest.setTimeout(180_000);
  let app: INestApplication<App>;
  let token: string;
  let cronSecret: string;

  beforeAll(async () => {
    const { execSync } = await import('node:child_process');
    execSync('npm run migration:run', {
      cwd: join(__dirname, '..'),
      stdio: 'inherit',
      env: process.env,
    });
    await runSeedDemo();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const config = app.get(ConfigService);
    configureApp(app, config);
    await app.init();

    token = signTestJwt({ sub: DEMO_USER_SUB, rol: 'admin' });
    cronSecret = config.get<string>('CRON_SECRET', 'e2e-cron-secret');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /lector-facturas/limite responde 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/lector-facturas/limite')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(typeof res.body.permitido).toBe('boolean');
    expect(typeof res.body.usadas).toBe('number');
    expect(typeof res.body.limite).toBe('number');
  });

  it('GET /lector-facturas/logs responde 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/lector-facturas/logs')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body.logs)).toBe(true);
  });

  it('GET /lector-facturas/borradores responde 200 (lista vacía ok)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/lector-facturas/borradores')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body.borradores)).toBe(true);
  });

  it('POST /cron/lector-facturas/process-jobs con CRON_SECRET responde 200', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cron/lector-facturas/process-jobs')
      .set('Authorization', `Bearer ${cronSecret}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.processed).toBe(0);
    expect(res.body.completed).toBe(0);
    expect(res.body.failed).toBe(0);
  });

  it('POST /lector-facturas/confirmar con body inválido responde 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/lector-facturas/confirmar')
      .set('Authorization', `Bearer ${token}`)
      .send({ foo: 'bar' })
      .expect(400);
  });

  it('POST /lector-facturas/confirmar con tipo inválido responde 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/lector-facturas/confirmar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        log_id: '00000000-0000-0000-0000-000000000001',
        direccion: 'recibida',
        tipo_operacion: 'compra',
        tipo_comprobante: 'tipo_inventado',
        fecha: '2026-01-15',
        items: [],
        subtotal: 0,
        iva_monto: 0,
        total: 0,
      })
      .expect(400);
  });

  it('POST /lector-facturas/tabla-ocr sin archivo responde 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/lector-facturas/tabla-ocr')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('POST /public/lector-facturas/jobs sin api key responde 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/public/lector-facturas/jobs')
      .send({ archivos: [] })
      .expect(401);
  });

  it('POST /public/invoice-extractor/extract sin api key responde 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/public/invoice-extractor/extract')
      .send({ archivos: [] })
      .expect(401);
  });

  it('POST /lector-facturas/extraer sin archivo responde 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/lector-facturas/extraer')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  (geminiKey ? it : it.skip)(
    'POST /lector-facturas/extraer con archivo (requiere GEMINI_API_KEY)',
    async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/lector-facturas/extraer')
        .set('Authorization', `Bearer ${token}`)
        .attach('archivo', Buffer.from('%PDF-1.4 minimal'), {
          filename: 'factura-test.pdf',
          contentType: 'application/pdf',
        });

      expect([200, 422, 502, 503]).toContain(res.status);
    },
  );
});
