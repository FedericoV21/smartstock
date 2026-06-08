import { NextResponse } from 'next/server';

import { authenticateExtractorKey } from '@/lib/api-extractor/keys';
import {
  extraerFacturaIaPura,
  validarArchivosFacturaIa,
  type ArchivoFacturaEntrada,
} from '@/lib/lector-facturas/extraer-factura-ia-pura';
import type { VisionProviderConfig } from '@/lib/ia/vision-extraccion';
import { getSupabaseServiceRoleKey } from '@/lib/supabase/env-keys';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function extractorVisionConfig(): VisionProviderConfig {
  return {
    primary: envValue('INVOICE_EXTRACTOR_IA_PRIMARY') ?? 'gemini',
    geminiApiKey: envValue('INVOICE_EXTRACTOR_GEMINI_API_KEY') ?? envValue('GEMINI_API_KEY'),
    geminiModel: envValue('INVOICE_EXTRACTOR_GEMINI_MODEL') ?? 'gemini-2.5-flash',
    openRouterApiKey:
      envValue('INVOICE_EXTRACTOR_OPEN_ROUTER_API_KEY') ??
      envValue('INVOICE_EXTRACTOR_OPENROUTER_API_KEY'),
    openRouterModels: envValue('INVOICE_EXTRACTOR_OPEN_ROUTER_MODELS'),
    openRouterPdfEngine: envValue('INVOICE_EXTRACTOR_OPEN_ROUTER_PDF_ENGINE'),
    openRouterHttpReferer: envValue('INVOICE_EXTRACTOR_OPEN_ROUTER_HTTP_REFERER'),
    openRouterAppTitle: envValue('INVOICE_EXTRACTOR_OPEN_ROUTER_APP_TITLE'),
  };
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t || null;
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

function archivosDesdeExtractorJson(raw: unknown): ArchivoFacturaEntrada[] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  const rows = Array.isArray(b.archivos)
    ? b.archivos
    : Array.isArray(b.files)
      ? b.files
      : b.archivo && typeof b.archivo === 'object'
        ? [b.archivo]
        : b.archivo_base64 || b.base64
          ? [
              {
                base64: b.archivo_base64 ?? b.base64,
                mime_type: b.mime_type ?? b.mimeType,
                nombre: b.nombre ?? b.filename,
              },
            ]
          : [];

  return rows
    .map((row, idx) => archivoDesdeJsonRow(row, idx))
    .filter((item): item is ArchivoFacturaEntrada => item != null);
}

async function insertLog(params: {
  db: any;
  keyId: string;
  archivoNombre: string | null;
  archivoMime: string | null;
  archivoTamano: number | null;
  estado: 'extraido' | 'error';
  errorCode?: string | null;
  errorDetail?: string | null;
  duracionMs: number;
  meta?: Record<string, unknown> | null;
}) {
  await params.db.from('factura_extractor_log').insert({
    api_key_id: params.keyId,
    archivo_nombre: params.archivoNombre,
    archivo_mime: params.archivoMime,
    archivo_tamano: params.archivoTamano,
    estado: params.estado,
    error_code: params.errorCode ?? null,
    error_detail: params.errorDetail ?? null,
    duracion_ms: params.duracionMs,
    meta: params.meta ?? null,
  });
}

export async function POST(request: Request) {
  if (!getSupabaseServiceRoleKey()) {
    return jsonError('Service role key no configurada', 503);
  }

  const started = Date.now();
  const db = createServiceRoleClient() as any;
  const auth = await authenticateExtractorKey({
    db,
    request,
    scope: 'invoice:extract',
  });
  if (!auth.ok) return jsonError(auth.error, auth.status);

  let archivos: ArchivoFacturaEntrada[] | null = null;
  try {
    const raw = await request.json();
    archivos = archivosDesdeExtractorJson(raw);
  } catch {
    return jsonError('Body invalido', 400);
  }

  if (!archivos) return jsonError('JSON invalido', 400);
  const validacion = validarArchivosFacturaIa(archivos);
  if (!validacion.ok) {
    await insertLog({
      db,
      keyId: auth.key.id,
      archivoNombre: archivos[0]?.name ?? null,
      archivoMime: archivos[0]?.type ?? null,
      archivoTamano: archivos.reduce((acc, a) => acc + a.size, 0),
      estado: 'error',
      errorCode: `http_${validacion.status}`,
      errorDetail: validacion.error,
      duracionMs: Date.now() - started,
    });
    return jsonError(validacion.error, validacion.status);
  }

  const result = await extraerFacturaIaPura({
    archivos,
    source: 'extractor_publico',
    visionConfig: extractorVisionConfig(),
  });

  if (!result.ok) {
    await insertLog({
      db,
      keyId: auth.key.id,
      archivoNombre: result.archivoNombre ?? archivos[0]?.name ?? null,
      archivoMime: result.archivoMime ?? (archivos.length === 1 ? archivos[0]?.type ?? null : 'multipart/mixed'),
      archivoTamano: result.archivoTamano ?? validacion.totalBytes,
      estado: 'error',
      errorCode: `http_${result.status}`,
      errorDetail: result.error,
      duracionMs: Date.now() - started,
      meta: result.meta ? { ia: result.meta } : null,
    });
    return NextResponse.json(
      {
        error: result.error,
        ...(result.respuesta_raw ? { respuesta_raw: result.respuesta_raw } : {}),
      },
      { status: result.status },
    );
  }

  await insertLog({
    db,
    keyId: auth.key.id,
    archivoNombre: result.archivoNombre,
    archivoMime: result.archivoMime,
    archivoTamano: result.archivoTamano,
    estado: 'extraido',
    duracionMs: Date.now() - started,
    meta: {
      total_hojas: result.hojasResumen.length,
      reintento_usado: result.resultadosFinales === result.resultadosReintento,
    },
  });

  return NextResponse.json(result.clean);
}
