import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import {
  DEMO_CAJA_ID,
  DEMO_SUCURSAL_ID,
  DEMO_USER_SUB,
} from './helpers/e2e-constants';
import { runSeedDemo } from './helpers/run-seed-demo';
import { signTestJwt } from './helpers/sign-test-jwt';

describe('NB-CAJA-002 gastos e historial (e2e)', () => {
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

  it('GET historial-movimientos responde con eventos', async () => {
    const hoy = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
    }).format(new Date());

    const res = await request(app.getHttpServer())
      .get('/api/v1/caja/historial-movimientos')
      .query({
        sucursal_id: DEMO_SUCURSAL_ID,
        fecha_operativa: hoy,
        caja_id: DEMO_CAJA_ID,
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.sucursal_id).toBe(DEMO_SUCURSAL_ID);
    expect(Array.isArray(res.body.eventos)).toBe(true);
  });

  it('CRUD gastos de sesión con turno abierto', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/caja/turno/abrir')
      .set('Authorization', `Bearer ${token}`)
      .send({ caja_id: DEMO_CAJA_ID, monto_inicial: 1000 })
      .expect(201);

    const vacio = await request(app.getHttpServer())
      .get('/api/v1/caja/gastos')
      .query({ caja_id: DEMO_CAJA_ID, sucursal_id: DEMO_SUCURSAL_ID })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(vacio.body.items).toEqual([]);
    expect(vacio.body.total).toBe(0);
    expect(vacio.body.caja_apertura_id).toEqual(expect.any(String));

    const creado = await request(app.getHttpServer())
      .post('/api/v1/caja/gastos')
      .set('Authorization', `Bearer ${token}`)
      .send({ caja_id: DEMO_CAJA_ID, concepto: 'Compra insumos', monto: 150.5 })
      .expect(201);

    expect(creado.body.item.concepto).toBe('Compra insumos');
    expect(creado.body.item.monto).toBe(150.5);
    expect(creado.body.total).toBe(150.5);

    const listado = await request(app.getHttpServer())
      .get('/api/v1/caja/gastos')
      .query({ caja_id: DEMO_CAJA_ID })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listado.body.items).toHaveLength(1);

    const anulado = await request(app.getHttpServer())
      .delete(`/api/v1/caja/gastos/${creado.body.item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(anulado.body.ok).toBe(true);
    expect(anulado.body.total).toBe(0);

    await request(app.getHttpServer())
      .post('/api/v1/caja/turno/cerrar')
      .set('Authorization', `Bearer ${token}`)
      .send({ usar_efectivo_esperado_del_sistema: true })
      .expect(201);
  });

  it('GET cierre-z/:id/resumen devuelve detalle tras cierre', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/caja/cierre-z')
      .query({ sucursal_id: DEMO_SUCURSAL_ID, caja_id: DEMO_CAJA_ID, limit: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const cierreId = list.body.cierres?.[0]?.id as string | undefined;
    expect(cierreId).toEqual(expect.any(String));

    const res = await request(app.getHttpServer())
      .get(`/api/v1/caja/cierre-z/${cierreId}/resumen`)
      .query({ sucursal_id: DEMO_SUCURSAL_ID })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.cierre.id).toBe(cierreId);
    expect(Array.isArray(res.body.medios)).toBe(true);
    expect(Array.isArray(res.body.ordenes)).toBe(true);
  });
});
