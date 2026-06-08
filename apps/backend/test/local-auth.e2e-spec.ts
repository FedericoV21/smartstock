import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import {
  DEMO_LOCAL_PIN,
  DEMO_LOCAL_USER_SUB,
  DEMO_LOCAL_USERNAME,
  DEMO_SUCURSAL_ID,
  DEMO_TENANT_CODE,
  DEMO_TENANT_ID,
} from './helpers/e2e-constants';
import { runSeedDemo } from './helpers/run-seed-demo';
import { signTestJwt } from './helpers/sign-test-jwt';

describe('NB-AUTH-010 local login (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
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

  it('POST /auth/local-login devuelve JWT con tenantCode + username + pin', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/local-login')
      .send({
        tenantCode: DEMO_TENANT_CODE,
        username: DEMO_LOCAL_USERNAME,
        pin: DEMO_LOCAL_PIN,
      })
      .expect(200);

    expect(res.body.access_token).toEqual(expect.any(String));
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(3600);
    expect(res.body.user).toMatchObject({
      id: DEMO_LOCAL_USER_SUB,
      tenant_id: DEMO_TENANT_ID,
      rol: 'operador',
      username_local: DEMO_LOCAL_USERNAME,
    });
  });

  it('JWT emitido permite GET /auth/me', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/local-login')
      .send({
        tenantId: DEMO_TENANT_ID,
        username: DEMO_LOCAL_USERNAME,
        pin: DEMO_LOCAL_PIN,
      })
      .expect(200);

    const token = login.body.access_token as string;

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(me.body?.data?.sub).toBe(DEMO_LOCAL_USER_SUB);
    expect(me.body?.data?.tenantId).toBe(DEMO_TENANT_ID);
    expect(me.body?.data?.appRole).toBe('operador');
  });

  it('POST /auth/local-login 401 con PIN incorrecto', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/local-login')
      .send({
        tenantCode: DEMO_TENANT_CODE,
        username: DEMO_LOCAL_USERNAME,
        pin: '000000',
      })
      .expect(401);
  });

  it('POST /auth/local-login 401 con tenantCode inválido', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/local-login')
      .send({
        tenantCode: 'no-existe',
        username: DEMO_LOCAL_USERNAME,
        pin: DEMO_LOCAL_PIN,
      })
      .expect(401);
  });

  it('cajero local puede leer tenant con su JWT', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/local-login')
      .send({
        tenantCode: DEMO_TENANT_CODE,
        username: DEMO_LOCAL_USERNAME,
        pin: DEMO_LOCAL_PIN,
      })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/tenant')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .expect(200);

    expect(res.body?.data?.tenantId).toBe(DEMO_TENANT_ID);
  });

  it('admin JWT sigue funcionando en paralelo al login local', async () => {
    const adminToken = signTestJwt({ rol: 'admin' });

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Sucursal-Id', DEMO_SUCURSAL_ID)
      .expect(200);
  });

  describe('register + login email', () => {
    const unique = Date.now();
    const email = `reg-${unique}@test.local`;
    const password = 'secret123';

    it('POST /auth/register crea negocio y POST /auth/login emite JWT', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          negocio: `Negocio ${unique}`,
          nombre: 'Reg',
          apellido: 'Test',
          email,
          password,
        })
        .expect(201);

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);

      expect(login.body.access_token).toEqual(expect.any(String));

      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .expect(200);

      expect(me.body?.data?.appRole).toBe('admin');
      expect(me.body?.data?.email).toBe(email);
    });

    it('POST /auth/login devuelve refresh_token y POST /auth/refresh renueva sesión', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);

      expect(login.body.refresh_token).toEqual(expect.any(String));

      const refreshed = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refresh_token: login.body.refresh_token })
        .expect(200);

      expect(refreshed.body.access_token).toEqual(expect.any(String));
      expect(refreshed.body.refresh_token).toEqual(expect.any(String));
    });

    it('POST /auth/register 409 si el email ya existe', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          negocio: 'Otro',
          nombre: 'Dup',
          apellido: 'Test',
          email,
          password,
        })
        .expect(409);
    });
  });

  describe('invite + accept-invite', () => {
    const unique = Date.now();
    const inviteEmail = `invite-${unique}@test.local`;

    it('admin invita, usuario acepta invitación y obtiene JWT', async () => {
      const adminToken = signTestJwt({ rol: 'admin' });

      const invited = await request(app.getHttpServer())
        .post('/api/v1/config/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: inviteEmail,
          nombre: 'Invitado',
          apellido: 'Test',
          rol: 'operador',
        })
        .expect(201);

      expect(invited.body.invite_token).toEqual(expect.any(String));

      const accepted = await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .send({
          token: invited.body.invite_token,
          password: 'invite123',
        })
        .expect(200);

      expect(accepted.body.access_token).toEqual(expect.any(String));

      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accepted.body.access_token}`)
        .expect(200);

      expect(me.body?.data?.email).toBe(inviteEmail);
      expect(me.body?.data?.appRole).toBe('operador');
    });
  });
});
