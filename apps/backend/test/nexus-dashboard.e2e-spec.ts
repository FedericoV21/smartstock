import { join } from 'node:path';

import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import { runSeedDemo } from './helpers/run-seed-demo';
import {
  buildSetCookieHeader,
  getNexusDashboardPassword,
  NEXUS_DASHBOARD_COOKIE,
  nexusDashboardCookieOptions,
  signNexusDashboardSession,
} from '../src/nexus-dashboard/utils/auth-cookie.util';

describe('NB-NEX-001 nexus-dashboard (e2e)', () => {
  let app: INestApplication<App>;

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
  });

  afterAll(async () => {
    await app?.close();
  });

  it('POST /nexus-dashboard/login con contraseña incorrecta responde 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/nexus-dashboard/login')
      .send({ password: 'wrong-password' })
      .expect(401);
  });

  it('POST /nexus-dashboard/login con contraseña correcta setea cookie y GET session ok', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/nexus-dashboard/login')
      .send({ password: getNexusDashboardPassword() })
      .expect(200);

    expect(login.body).toEqual({ ok: true });
    const cookie = login.headers['set-cookie']?.[0] as string | undefined;
    expect(cookie).toBeDefined();
    expect(cookie).toContain(NEXUS_DASHBOARD_COOKIE);

    const session = await request(app.getHttpServer())
      .get('/api/v1/nexus-dashboard/session')
      .set('Cookie', cookie!)
      .expect(200);

    expect(session.body).toEqual({ ok: true });
  });

  it('GET /nexus-dashboard/tenants sin cookie responde 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/nexus-dashboard/tenants').expect(401);
  });

  it('GET /nexus-dashboard/tenants con cookie responde rows', async () => {
    const token = signNexusDashboardSession();
    const cookie = buildSetCookieHeader(
      NEXUS_DASHBOARD_COOKIE,
      token,
      nexusDashboardCookieOptions(),
    );

    const res = await request(app.getHttpServer())
      .get('/api/v1/nexus-dashboard/tenants')
      .set('Cookie', cookie)
      .expect(200);

    expect(Array.isArray(res.body.rows)).toBe(true);
  });
});
