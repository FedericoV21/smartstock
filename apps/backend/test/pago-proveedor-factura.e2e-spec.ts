import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import { DEMO_OBLIGACION_PROVEEDOR, DEMO_USER_SUB } from './helpers/e2e-constants';
import { runSeedDemo } from './helpers/run-seed-demo';
import { signTestJwt } from './helpers/sign-test-jwt';

const OBLIGACION_INEXISTENTE = '00000000-0000-4000-8000-000000000097';

describe('NB-PF-001 pago-proveedor-factura (e2e)', () => {
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

  it('POST pago parcial responde 200 con resultado', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/pago-proveedor-factura/${DEMO_OBLIGACION_PROVEEDOR}/pago`)
      .set('Authorization', `Bearer ${token}`)
      .send({ monto: 1000, tipo_pago: 'efectivo', notas: 'Pago demo e2e' })
      .expect(200);

    expect(res.body.resultado).toBeDefined();
    expect(res.body.resultado.pago_proveedor_movimiento_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(res.body.resultado.pago_cuenta_corriente_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(Number(res.body.resultado.nuevo_saldo)).toBe(4000);
  });

  it('POST obligación inexistente responde 404', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/pago-proveedor-factura/${OBLIGACION_INEXISTENTE}/pago`)
      .set('Authorization', `Bearer ${token}`)
      .send({ monto: 100 })
      .expect(404);
  });

  it('POST monto inválido responde 400', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/pago-proveedor-factura/${DEMO_OBLIGACION_PROVEEDOR}/pago`)
      .set('Authorization', `Bearer ${token}`)
      .send({ monto: 0 })
      .expect(400);
  });
});
