import { join } from 'node:path';

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

const FECHA_LUNES = '2026-06-08';

describe('NB-TUR-001 turnos (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let agendaId: string;

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
  });

  afterAll(async () => {
    await app?.close();
  });

  it('POST /turnos/agendas crea agenda con disponibilidad', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/turnos/agendas')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Sucursal-Id', DEMO_SUCURSAL_ID)
      .send({
        nombre: 'Consulta E2E',
        precio: 5000,
        disponibilidad: [{ dia_semana: 1, hora_inicio: '09:00', hora_fin: '18:00' }],
      })
      .expect(201);

    expect(res.body.agenda).toBeDefined();
    expect(res.body.agenda.nombre).toBe('Consulta E2E');
    expect(res.body.agenda.disponibilidad).toHaveLength(1);
    agendaId = res.body.agenda.id;
  });

  it('POST /turnos/reservas crea reserva en horario disponible', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/turnos/reservas')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Sucursal-Id', DEMO_SUCURSAL_ID)
      .send({
        agenda_id: agendaId,
        fecha: FECHA_LUNES,
        hora_inicio: '10:00',
        nombre: 'Paciente Test',
      })
      .expect(201);

    expect(res.body.reserva).toBeDefined();
    expect(res.body.reserva.estado).toBe('reservado');
    expect(res.body.reserva.hora_inicio).toBe('10:00');
  });

  it('POST /turnos/reservas mismo slot responde 409', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/turnos/reservas')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Sucursal-Id', DEMO_SUCURSAL_ID)
      .send({
        agenda_id: agendaId,
        fecha: FECHA_LUNES,
        hora_inicio: '10:00',
        nombre: 'Otro Paciente',
      })
      .expect(409);
  });

  it('GET /turnos/slots devuelve slots con estado reservado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/turnos/slots')
      .query({
        sucursal_id: DEMO_SUCURSAL_ID,
        agenda_id: agendaId,
        desde: FECHA_LUNES,
        hasta: FECHA_LUNES,
      })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.sucursal_id).toBe(DEMO_SUCURSAL_ID);
    expect(Array.isArray(res.body.slots)).toBe(true);
    expect(res.body.slots.length).toBeGreaterThan(0);
    const slot10 = res.body.slots.find(
      (s: { hora_inicio: string }) => s.hora_inicio === '10:00',
    );
    expect(slot10).toBeDefined();
    expect(slot10.estado).toBe('reservado');
  });
});
