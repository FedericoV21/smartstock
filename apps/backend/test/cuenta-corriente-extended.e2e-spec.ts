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
  DEMO_SUCURSAL_ID,
  DEMO_USER_SUB,
} from './helpers/e2e-constants';
import { runSeedDemo } from './helpers/run-seed-demo';
import { signTestJwt } from './helpers/sign-test-jwt';

const PAGO_INEXISTENTE = '00000000-0000-4000-8000-000000000099';
const COMPROBANTE_INEXISTENTE = '00000000-0000-4000-8000-000000000098';

describe('NB-CC-003 / NB-CLI-002 cuenta corriente extendida (e2e)', () => {
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

  it('GET /cuenta-corriente/cargos-hoy responde 200 con estructura esperada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/cuenta-corriente/cargos-hoy')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.sucursal_id).toBe(DEMO_SUCURSAL_ID);
    expect(typeof res.body.habilitado).toBe('boolean');
    expect(res.body.por_cliente).toBeDefined();
  });

  it('GET /customers/:id/comprobantes responde 200 con items', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/customers/${DEMO_CLIENTE_ID}/comprobantes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('GET liquidacion comprobante sin sucursal_id responde 400', async () => {
    await request(app.getHttpServer())
      .get(
        `/api/v1/customers/${DEMO_CLIENTE_ID}/cuenta-corriente/comprobantes/${COMPROBANTE_INEXISTENTE}/liquidacion`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET liquidacion comprobante inexistente responde 404 o 403', async () => {
    const res = await request(app.getHttpServer())
      .get(
        `/api/v1/customers/${DEMO_CLIENTE_ID}/cuenta-corriente/comprobantes/${COMPROBANTE_INEXISTENTE}/liquidacion`,
      )
      .query({ sucursal_id: DEMO_SUCURSAL_ID })
      .set('Authorization', `Bearer ${token}`);

    expect([403, 404]).toContain(res.status);
  });

  it('PATCH pago extracto inexistente responde 404', async () => {
    const hoy = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
    }).format(new Date());

    await request(app.getHttpServer())
      .patch(`/api/v1/customers/${DEMO_CLIENTE_ID}/cuenta-corriente/pagos/${PAGO_INEXISTENTE}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ monto: 100, fecha: hoy, tipo_pago: 'efectivo' })
      .expect(404);
  });

  it('POST revertir pago proveedor inexistente responde 404', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${DEMO_PROVEEDOR_ID}/pagos/${PAGO_INEXISTENTE}/revertir`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
