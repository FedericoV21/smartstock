import { readFileSync } from 'node:fs';

import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/bootstrap/configure-app';
import { AppModule } from '../src/app.module';
import {
  DEMO_COMPROBANTE_PENDIENTE_ARCA,
  DEMO_PRODUCTO_ID,
  DEMO_SUCURSAL_ID,
} from './helpers/e2e-constants';
import { runSeedDemo } from './helpers/run-seed-demo';
import { signTestJwt } from './helpers/sign-test-jwt';

const AFIP_HOMO_ENABLED = process.env.ARCA_HOMO_E2E === '1' || process.env.ARCA_HOMO_E2E === 'true';

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'X-Sucursal-Id': DEMO_SUCURSAL_ID,
  };
}

describe('NB-ARC-106 homologación ARCA (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;

  beforeAll(async () => {
    await runSeedDemo();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const config = app.get(ConfigService);
    configureApp(app, config);
    await app.init();

    adminToken = signTestJwt();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('readiness y evidencia (CI)', () => {
    it('GET /arca/homologation-readiness expone checklist NB-ARC-106', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/arca/homologation-readiness')
        .set(authHeaders(adminToken))
        .expect(200);

      const data = res.body?.data;
      expect(data).toBeDefined();
      expect(Array.isArray(data.checks)).toBe(true);
      expect(data.checks.length).toBeGreaterThan(5);
      expect(typeof data.bloqueantes).toBe('number');
      expect(typeof data.advertencias).toBe('number');
      expect(Array.isArray(data.flujo_recomendado)).toBe(true);
      expect(data.comprobante_prueba_sugerido).toBe(DEMO_COMPROBANTE_PENDIENTE_ARCA);
    });

    it('readiness detecta certificados faltantes sin bloquear env/JWT', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/arca/homologation-readiness')
        .set(authHeaders(adminToken))
        .expect(200);

      const checks = res.body.data.checks as Array<{ id: string; ok: boolean }>;
      const envKey = checks.find((c) => c.id === 'env_arca_encryption_key');
      const jwt = checks.find((c) => c.id === 'env_jwt_secret');
      const certs = checks.find((c) => c.id === 'arca_certificados');

      expect(envKey?.ok).toBe(true);
      expect(jwt?.ok).toBe(true);
      expect(certs?.ok).toBe(false);
      expect(res.body.data.listo_para_homologacion).toBe(false);
      expect(res.body.data.bloqueantes).toBeGreaterThan(0);
    });

    it('GET /arca/homologation-evidence devuelve snapshot anonimizado', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/arca/homologation-evidence')
        .set(authHeaders(adminToken))
        .expect(200);

      expect(res.body.data.generado_at).toBeDefined();
      expect(res.body.data.readiness).toBeDefined();
      expect(Array.isArray(res.body.data.comprobantes)).toBe(true);
      expect(Array.isArray(res.body.data.logs)).toBe(true);
    });

    it('GET /arca/logs devuelve logs demo para evidencia', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/arca/logs?limit=5')
        .set(authHeaders(adminToken))
        .expect(200);

      expect(res.body.data.logs.length).toBeGreaterThan(0);
      expect(res.body.data.logs[0]).toMatchObject({
        servicio: expect.any(String),
        exitoso: expect.any(Boolean),
      });
    });

    it('POST /branches/active fija sucursal demo', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/branches/active')
        .set(authHeaders(adminToken))
        .send({ sucursalId: DEMO_SUCURSAL_ID })
        .expect(201);
    });
  });

  const describeAfip = AFIP_HOMO_ENABLED ? describe : describe.skip;

  describeAfip('AFIP homologación real (ARCA_HOMO_E2E=1)', () => {
    const certPath = process.env.ARCA_HOMO_CERT_PATH ?? process.env.ARCA_HOMO_CERT_PEM_PATH;
    const keyPath = process.env.ARCA_HOMO_KEY_PATH ?? process.env.ARCA_HOMO_KEY_PEM_PATH;
    const cuit = process.env.ARCA_HOMO_CUIT ?? '20123456789';
    const puntoDeVenta = Number.parseInt(process.env.ARCA_HOMO_PUNTO_VENTA ?? '3', 10);

    beforeAll(() => {
      process.env.ARCA_WORKER_STUB = 'false';
    });

    async function ensureArcaConfig(server: App) {
      const readiness = await request(server)
        .get('/api/v1/arca/homologation-readiness')
        .set(authHeaders(adminToken))
        .expect(200);

      const certsOk = (readiness.body.data.checks as Array<{ id: string; ok: boolean }>).find(
        (c) => c.id === 'arca_certificados',
      )?.ok;

      if (certsOk) {
        return;
      }

      if (!certPath || !keyPath) {
        throw new Error(
          'Sin certificados en arca_config para la sucursal demo. ' +
            'Configurarlos con PUT /api/v1/arca/config (por cliente/sucursal) ' +
            'o definir ARCA_HOMO_CERT_PATH + ARCA_HOMO_KEY_PATH como atajo.',
        );
      }

      await request(server)
        .put('/api/v1/arca/config')
        .set(authHeaders(adminToken))
        .send({
          sucursalId: DEMO_SUCURSAL_ID,
          cuitEmisor: cuit,
          puntoDeVenta,
          ambiente: 'homologacion',
          certificadoPem: readFileSync(certPath, 'utf8'),
          clavePrivadaPem: readFileSync(keyPath, 'utf8'),
        })
        .expect(200);
    }

    it('4.1 — config en BD + test-connection WSAA/WSFE', async () => {
      await ensureArcaConfig(app.getHttpServer());

      const readiness = await request(app.getHttpServer())
        .get('/api/v1/arca/homologation-readiness')
        .set(authHeaders(adminToken))
        .expect(200);

      expect(readiness.body.data.listo_para_homologacion).toBe(true);
      expect(readiness.body.data.bloqueantes).toBe(0);

      const conn = await request(app.getHttpServer())
        .post(`/api/v1/arca/test-connection?sucursalId=${DEMO_SUCURSAL_ID}`)
        .set(authHeaders(adminToken))
        .expect(201);

      expect(conn.body?.data?.wsaa?.ok).toBe(true);
    });

    it('4.2 — sync numeración + emit v9 con CAE inline (flujo A)', async () => {
      await ensureArcaConfig(app.getHttpServer());
      await request(app.getHttpServer())
        .post(`/api/v1/arca/sync-numeracion?sucursalId=${DEMO_SUCURSAL_ID}`)
        .set(authHeaders(adminToken))
        .expect(201);

      const emit = await request(app.getHttpServer())
        .post('/api/v1/facturacion/comprobantes')
        .set(authHeaders(adminToken))
        .send({
          tipo: 'factura_b',
          metodoPago: 'efectivo',
          items: [{ productoId: DEMO_PRODUCTO_ID, cantidad: 1 }],
        })
        .expect(201);

      const comprobante = emit.body?.data ?? emit.body;
      expect(comprobante.estado).toBe('emitido');
      expect(comprobante.cae).toBeTruthy();
      expect(comprobante.numero).toBeTruthy();

      const pdf = await request(app.getHttpServer())
        .get(`/api/v1/facturacion/comprobantes/${comprobante.id}/pdf`)
        .set(authHeaders(adminToken))
        .expect(200);

      expect(Buffer.isBuffer(pdf.body) ? pdf.body.length : pdf.text?.length).toBeGreaterThan(100);
    });

    it('4.2b — retry CAE sobre comprobante pendiente (flujo B)', async () => {
      await runSeedDemo();
      await ensureArcaConfig(app.getHttpServer());

      const retry = await request(app.getHttpServer())
        .post(`/api/v1/facturacion/comprobantes/${DEMO_COMPROBANTE_PENDIENTE_ARCA}/retry-arca`)
        .set(authHeaders(adminToken))
        .expect(201);

      const data = retry.body?.data ?? retry.body;
      expect(['emitido', 'error_arca', 'pendiente_arca']).toContain(data.estado);
      if (data.estado === 'emitido') {
        expect(data.cae).toBeTruthy();
      }
    });
  });
});
