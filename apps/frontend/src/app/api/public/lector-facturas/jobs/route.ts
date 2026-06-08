import { NextResponse } from 'next/server';

import { authenticateApiIntegrationKey } from '@/lib/api-integraciones/keys';
import {
  buscarJobIdempotente,
  crearLectorFacturaJob,
  subirArchivoLectorFacturaJob,
} from '@/lib/lector-facturas/jobs';
import {
  validarArchivosFacturaIa,
  type ArchivoFacturaEntrada,
} from '@/lib/lector-facturas/procesar-factura-ia';
import { getSupabaseServiceRoleKey } from '@/lib/supabase/env-keys';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t || null;
}

function callbackUrl(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function idempotencyKeyDesdeRequest(request: Request, raw: unknown): string | null {
  const header = request.headers.get('idempotency-key')?.trim();
  if (header) return header.slice(0, 200);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return stringValue((raw as Record<string, unknown>).idempotency_key)?.slice(0, 200) ?? null;
}

function archivoDesdeJsonRow(row: unknown, idx: number): ArchivoFacturaEntrada | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const base64 = stringValue(r.base64 ?? r.data_base64 ?? r.contenido_base64);
  const mimeType = stringValue(r.mime_type ?? r.mimeType ?? r.type);
  if (!base64 || !mimeType) return null;
  const nombre = stringValue(r.nombre ?? r.name ?? r.filename) ?? `factura-${idx + 1}`;
  const clean = base64.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  const bytes = new Uint8Array(Buffer.from(clean, 'base64'));
  if (bytes.byteLength === 0) return null;
  return {
    name: nombre,
    type: mimeType,
    size: bytes.byteLength,
    bytes,
  };
}

function archivosDesdeJson(raw: unknown): {
  archivos: ArchivoFacturaEntrada[];
  externalId: string | null;
  idempotencyKey: string | null;
  callbackUrl: string | null;
} | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const rows = Array.isArray(b.archivos)
    ? b.archivos
    : Array.isArray(b.files)
      ? b.files
      : b.archivo_base64 || b.base64
        ? [
            {
              base64: b.archivo_base64 ?? b.base64,
              mime_type: b.mime_type ?? b.mimeType,
              nombre: b.nombre ?? b.filename,
            },
          ]
        : [];

  const archivos = rows
    .map((row, idx) => archivoDesdeJsonRow(row, idx))
    .filter((item): item is ArchivoFacturaEntrada => item != null);

  return {
    archivos,
    externalId: stringValue(b.external_id),
    idempotencyKey: stringValue(b.idempotency_key),
    callbackUrl: callbackUrl(b.callback_url),
  };
}

async function archivosDesdeMultipart(request: Request): Promise<{
  archivos: ArchivoFacturaEntrada[];
  externalId: string | null;
  idempotencyKey: string | null;
  callbackUrl: string | null;
}> {
  const formData = await request.formData();
  const files = formData.getAll('archivo').filter((v): v is File => v instanceof File);
  const archivos: ArchivoFacturaEntrada[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const bytes = new Uint8Array(await file.arrayBuffer());
    archivos.push({
      name: file.name || `factura-${i + 1}`,
      type: file.type,
      size: file.size || bytes.byteLength,
      bytes,
    });
  }

  return {
    archivos,
    externalId: stringValue(formData.get('external_id')),
    idempotencyKey: stringValue(formData.get('idempotency_key')),
    callbackUrl: callbackUrl(formData.get('callback_url')),
  };
}

function statusUrl(request: Request, jobId: string): string {
  const url = new URL(request.url);
  url.pathname = `/api/public/lector-facturas/jobs/${jobId}`;
  url.search = '';
  return url.toString();
}

export async function POST(request: Request) {
  if (!getSupabaseServiceRoleKey()) {
    return jsonError('Service role key no configurada', 503);
  }

  const db = createServiceRoleClient() as any;
  const auth = await authenticateApiIntegrationKey({
    db,
    request,
    scope: 'lector_facturas:jobs:create',
  });
  if (!auth.ok) return jsonError(auth.error, auth.status);

  let payload: {
    archivos: ArchivoFacturaEntrada[];
    externalId: string | null;
    idempotencyKey: string | null;
    callbackUrl: string | null;
  } | null = null;

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  try {
    if (contentType.includes('multipart/form-data')) {
      payload = await archivosDesdeMultipart(request);
    } else {
      const raw = await request.json();
      const parsed = archivosDesdeJson(raw);
      if (!parsed) return jsonError('JSON invalido', 400);
      payload = {
        ...parsed,
        idempotencyKey: idempotencyKeyDesdeRequest(request, raw) ?? parsed.idempotencyKey,
      };
    }
  } catch {
    return jsonError('Body invalido', 400);
  }

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || payload.idempotencyKey;
  const existing = await buscarJobIdempotente({
    db,
    tenantId: auth.tenantId,
    apiKeyId: auth.key.id,
    idempotencyKey,
  });
  if (existing?.id) {
    return NextResponse.json(
      {
        job_id: existing.id,
        status: existing.status,
        status_url: statusUrl(request, existing.id),
        idempotent_replay: true,
      },
      { status: 202 },
    );
  }

  const validacion = validarArchivosFacturaIa(payload.archivos);
  if (!validacion.ok) return jsonError(validacion.error, validacion.status);

  let archivosGuardados;
  try {
    archivosGuardados = await Promise.all(
      payload.archivos.map((archivo) =>
        subirArchivoLectorFacturaJob({
          db,
          tenantId: auth.tenantId,
          source: 'api_publica',
          archivo,
        }),
      ),
    );
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }

  try {
    const job = await crearLectorFacturaJob({
      db,
      tenantId: auth.tenantId,
      sucursalId: auth.sucursalId,
      userId: auth.userId,
      apiKeyId: auth.key.id,
      source: 'api_publica',
      archivos: archivosGuardados,
      externalId: payload.externalId,
      idempotencyKey,
      callbackUrl: payload.callbackUrl,
    });

    return NextResponse.json(
      {
        job_id: job.id,
        status: job.status,
        status_url: statusUrl(request, job.id),
      },
      { status: 202 },
    );
  } catch (e) {
    return jsonError((e as Error).message, 500);
  }
}
