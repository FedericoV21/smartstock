#!/usr/bin/env node
/**
 * Runner NB-ARC-106 — homologación ARCA contra API Nest en ejecución.
 *
 * Los certificados se configuran **por cliente (tenant + sucursal)** en `arca_config`
 * vía `PUT /api/v1/arca/config` (mismo modelo que la UI `/configuracion/arca`).
 * Si el tenant ya tiene certificados cargados, el runner no los vuelve a subir.
 *
 * Uso (desde apps/backend):
 *   node --env-file=.env scripts/run-arca-homologacion.mjs
 *
 * Requiere:
 *   - API levantada (`npm run start:dev`)
 *   - JWT admin en ARCA_HOMO_JWT o generado con JWT_SECRET + tenant demo
 *   - Certificados en BD (PUT /arca/config) **o** atajo local ARCA_HOMO_CERT_PATH + ARCA_HOMO_KEY_PATH
 */
import { readFileSync } from 'node:fs';

const BASE = (process.env.ARCA_HOMO_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const SUCURSAL_ID = process.env.ARCA_HOMO_SUCURSAL_ID ?? 'd0000001-0001-4001-8001-000000000001';
const COMPROBANTE_PENDIENTE =
  process.env.ARCA_HOMO_COMPROBANTE_ID ?? 'c0000001-0001-4001-8001-000000000003';
const PRODUCTO_ID = process.env.ARCA_HOMO_PRODUCTO_ID ?? 'b0000001-0001-4001-8001-000000000001';

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function step(n, title) {
  console.log(`\n--- Paso ${n}: ${title} ---`);
}

async function api(method, path, { token, body, expectStatus = 200 } = {}) {
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Sucursal-Id': SUCURSAL_ID,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (res.status !== expectStatus) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

async function signDemoJwt() {
  const secret = process.env.JWT_SECRET ?? process.env.SUPABASE_JWT_SECRET;
  if (!secret?.trim()) {
    throw new Error('Definir JWT_SECRET o ARCA_HOMO_JWT');
  }
  const { JwtService } = await import('@nestjs/jwt');
  const jwt = new JwtService({ secret });
  return jwt.sign({
    sub: '33333333-3333-4333-8333-333333333333',
    tenant_id: '00000000-0000-4000-8000-000000000001',
    rol: 'admin',
    sucursal_default_id: SUCURSAL_ID,
  });
}

function certsCheckOk(readiness) {
  const checks = readiness?.data?.checks ?? [];
  return checks.find((c) => c.id === 'arca_certificados')?.ok === true;
}

async function main() {
  const certPath = process.env.ARCA_HOMO_CERT_PATH ?? process.env.ARCA_HOMO_CERT_PEM_PATH;
  const keyPath = process.env.ARCA_HOMO_KEY_PATH ?? process.env.ARCA_HOMO_KEY_PEM_PATH;

  if (process.env.ARCA_WORKER_STUB === 'true' || process.env.ARCA_WORKER_STUB === '1') {
    fail('ARCA_WORKER_STUB debe ser false para NB-ARC-106.');
    return;
  }

  const token = process.env.ARCA_HOMO_JWT?.trim() || (await signDemoJwt());
  const cuit = process.env.ARCA_HOMO_CUIT ?? '20123456789';
  const puntoDeVenta = Number.parseInt(process.env.ARCA_HOMO_PUNTO_VENTA ?? '3', 10);

  console.log(`NB-ARC-106 runner → ${BASE}`);
  console.log(`Sucursal: ${SUCURSAL_ID}`);

  try {
    step(0, 'Health');
    const health = await api('GET', '/api/v1/health', { token, expectStatus: 200 });
    ok(`Health: ${health?.data?.status ?? 'ok'}`);

    step(1, 'Sucursal activa');
    await api('POST', '/api/v1/branches/active', {
      token,
      body: { sucursalId: SUCURSAL_ID },
      expectStatus: 201,
    });
    ok('Sucursal activa');

    step(2, 'Readiness pre-config');
    let readiness = await api('GET', '/api/v1/arca/homologation-readiness', { token });
    console.log(`  bloqueantes=${readiness.data.bloqueantes}, advertencias=${readiness.data.advertencias}`);

    const certsEnBd = certsCheckOk(readiness);
    if (certsEnBd) {
      step(3, 'Config ARCA (ya en BD por tenant+sucursal)');
      const cfg = await api('GET', '/api/v1/arca/config', { token });
      ok(
        `Certificados en arca_config (hasCertificado=${cfg.data.hasCertificado}, ambiente=${cfg.data.ambiente})`,
      );
    } else {
      step(3, 'Cargar config ARCA homo (PUT /arca/config)');
      if (!certPath || !keyPath) {
        throw new Error(
          'Sin certificados en arca_config para esta sucursal. ' +
            'Configurarlos con PUT /api/v1/arca/config (UI /configuracion/arca o Postman) ' +
            'o definir ARCA_HOMO_CERT_PATH + ARCA_HOMO_KEY_PATH como atajo local.',
        );
      }
      await api('PUT', '/api/v1/arca/config', {
        token,
        body: {
          sucursalId: SUCURSAL_ID,
          cuitEmisor: cuit,
          puntoDeVenta,
          ambiente: 'homologacion',
          certificadoPem: readFileSync(certPath, 'utf8'),
          clavePrivadaPem: readFileSync(keyPath, 'utf8'),
        },
      });
      ok('Config ARCA cargada en BD (cifrada con ARCA_ENCRYPTION_KEY)');
    }

    step(4, 'Readiness post-config');
    readiness = await api('GET', '/api/v1/arca/homologation-readiness', { token });
    if (!readiness.data.listo_para_homologacion) {
      console.log(JSON.stringify(readiness.data.checks.filter((c) => !c.ok), null, 2));
      throw new Error('listo_para_homologacion=false tras cargar certificados');
    }
    ok('listo_para_homologacion=true');

    step(5, 'Test connection WSAA + WSFE');
    const conn = await api('POST', `/api/v1/arca/test-connection?sucursalId=${SUCURSAL_ID}`, {
      token,
      expectStatus: 201,
    });
    ok(`Conexión: ${JSON.stringify(conn.data).slice(0, 120)}…`);

    step(6, 'Sync numeración');
    const sync = await api('POST', `/api/v1/arca/sync-numeracion?sucursalId=${SUCURSAL_ID}`, {
      token,
      expectStatus: 201,
    });
    ok(`Numeración: ${JSON.stringify(sync.data).slice(0, 120)}…`);

    step(7, 'Emit v9 factura_b (flujo A)');
    const emit = await api('POST', '/api/v1/facturacion/comprobantes', {
      token,
      body: {
        tipo: 'factura_b',
        metodoPago: 'efectivo',
        items: [{ productoId: PRODUCTO_ID, cantidad: 1 }],
      },
      expectStatus: 201,
    });
    const comp = emit.data ?? emit;
    ok(`Emitido id=${comp.id} estado=${comp.estado} cae=…${String(comp.cae ?? '').slice(-4)} nro=${comp.numero}`);

    step(8, 'PDF post-CAE');
    const pdfRes = await fetch(`${BASE}/api/v1/facturacion/comprobantes/${comp.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Sucursal-Id': SUCURSAL_ID },
    });
    if (!pdfRes.ok) throw new Error(`PDF ${pdfRes.status}`);
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
    ok(`PDF ${pdfBuf.length} bytes`);

    if (process.env.ARCA_HOMO_RUN_RETRY === '1') {
      step(9, 'Retry comprobante pendiente (flujo B)');
      const retry = await api(
        'POST',
        `/api/v1/facturacion/comprobantes/${COMPROBANTE_PENDIENTE}/retry-arca`,
        { token, expectStatus: 201 },
      );
      const r = retry.data ?? retry;
      ok(`Retry estado=${r.estado} cae=…${String(r.cae ?? '').slice(-4)}`);
    }

    step(10, 'Logs ARCA (evidencia)');
    const logs = await api('GET', '/api/v1/arca/logs?limit=10', { token });
    ok(`${logs.data.total} log(s) recientes`);

    step(11, 'Snapshot evidencia NB-ARC-106');
    const evidence = await api('GET', '/api/v1/arca/homologation-evidence', { token });
    ok(
      `Evidence snapshot: ${evidence.data.comprobantes.length} comprobante(s), listo=${evidence.data.readiness.listo_para_homologacion}`,
    );

    console.log('\n=== NB-ARC-106 runner OK ===');
    console.log('Archivar evidencia: docs/homologacion-evidencia/evidencia-YYYY-MM-DD.md');
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

main();
