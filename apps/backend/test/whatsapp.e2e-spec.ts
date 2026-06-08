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

describe('NB-WA-001 WhatsApp foundation (e2e)', () => {
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

    app = moduleFixture.createNestApplication({ rawBody: true });
    const config = app.get(ConfigService);
    configureApp(app, config);
    await app.init();

    token = signTestJwt({ sub: DEMO_USER_SUB, rol: 'admin' });
    cronSecret = config.get<string>('CRON_SECRET', 'e2e-cron-secret');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /whatsapp/feature-flag responde 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/feature-flag')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(typeof res.body.enabled).toBe('boolean');
    expect(typeof res.body.rollout_stage).toBe('string');
    expect(typeof res.body.can_manage).toBe('boolean');
  });

  it('GET /whatsapp/channel responde 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/channel')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.mode).toBe('platform');
    expect(typeof res.body.has_channel).toBe('boolean');
    expect(typeof res.body.linked_verified_actors).toBe('number');
  });

  it('GET /whatsapp/branch-rules responde 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/branch-rules')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body.rules)).toBe(true);
    expect(Array.isArray(res.body.sucursales)).toBe(true);
  });

  it('GET /whatsapp/jobs responde 200 con lista vacía o jobs', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/jobs')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body.jobs)).toBe(true);
  });

  it('POST /whatsapp/webhook sin firma responde 401 si hay app secret', async () => {
    const originalSecret = process.env.WHATSAPP_WEBHOOK_APP_SECRET;
    process.env.WHATSAPP_WEBHOOK_APP_SECRET = 'test-webhook-secret';

    try {
      await request(app.getHttpServer())
        .post('/api/v1/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .send({ entry: [] })
        .expect(401);
    } finally {
      if (originalSecret === undefined) {
        delete process.env.WHATSAPP_WEBHOOK_APP_SECRET;
      } else {
        process.env.WHATSAPP_WEBHOOK_APP_SECRET = originalSecret;
      }
    }
  });

  it('POST /cron/whatsapp/send-outbound con CRON_SECRET responde 200', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cron/whatsapp/send-outbound')
      .set('Authorization', `Bearer ${cronSecret}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(typeof res.body.processed).toBe('number');
    expect(typeof res.body.sent).toBe('number');
    expect(typeof res.body.failed).toBe('number');
  });

  it('POST /cron/whatsapp/process-queued con CRON_SECRET responde 200', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cron/whatsapp/process-queued')
      .set('Authorization', `Bearer ${cronSecret}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(typeof res.body.processed).toBe('number');
  });

  it('GET /whatsapp/actors como admin responde 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/actors')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body.users)).toBe(true);
    expect(Array.isArray(res.body.actors)).toBe(true);
  });

  it('POST /whatsapp/actors body inválido responde 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/whatsapp/actors')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'request_otp' })
      .expect(400);
  });

  it('POST /cron/whatsapp/expire-otp con CRON_SECRET responde 200', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/cron/whatsapp/expire-otp')
      .set('Authorization', `Bearer ${cronSecret}`)
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(typeof res.body.expired).toBe('number');
    expect(typeof res.body.scanned_limit).toBe('number');
  });

  it('GET /whatsapp/sandbox/chat responde 200 con messages vacio', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/whatsapp/sandbox/chat')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(res.body.messages).toEqual([]);
  });

  it('POST /whatsapp/sandbox/chat mensaje vacio responde 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/whatsapp/sandbox/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: '' })
      .expect(400);
  });

  it('GET /whatsapp/report/download sin token responde 400', async () => {
    await request(app.getHttpServer()).get('/api/v1/whatsapp/report/download').expect(400);
  });
});
