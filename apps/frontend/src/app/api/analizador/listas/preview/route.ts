import { NextResponse } from 'next/server';

import {
  esErrorExtraccionVisionIA,
  extraerArchivoYSubirAlStorage,
  LimiteIAError,
  MAX_ARCHIVO_LISTA_BYTES,
  MIME_TODOS_LISTA,
} from '@/lib/analizador/extraer-lista';
import { round2 } from '@/lib/analizador/descuento-proveedor';
import { getTenantSession, rejectIfVisor, rejectUnlessAnalizadorAccess } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

// ---------------------------------------------------------------------------
// POST /api/analizador/listas/preview — Extrae ítems + sube archivo; no crea lista
// ---------------------------------------------------------------------------

const LOG_PREVIEW = '[analizador listas preview]';

export async function POST(request: Request) {
  const debugId = request.headers.get('x-debug-request-id')?.trim() || '—';
  const t0 = Date.now();

  const guard = await moduloGuard('importador_excel');
  if (!guard.allowed) {
    console.info(`${LOG_PREVIEW} debugId=${debugId} moduloGuard denegado`);
    return guard.response;
  }

  const session = await getTenantSession();
  if ('error' in session) {
    console.info(`${LOG_PREVIEW} debugId=${debugId} sesión inválida`);
    return session.error;
  }

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const noAnalizador = rejectUnlessAnalizadorAccess(session.rol);
  if (noAnalizador) return noAnalizador;

  const { supabase, tenantId, userId } = session;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    console.error(`${LOG_PREVIEW} debugId=${debugId} formData falló`, (e as Error).message);
    return NextResponse.json(
      {
        error:
          'No se pudo leer el archivo (cuerpo multipart inválido o demasiado grande para el servidor).',
      },
      { status: 400 },
    );
  }

  const file = formData.get('archivo') as File | null;
  const proveedorId = formData.get('proveedor_id') as string | null;

  if (!file) {
    console.info(`${LOG_PREVIEW} debugId=${debugId} sin archivo`);
    return NextResponse.json({ error: 'No se envió ningún archivo' }, { status: 400 });
  }
  if (!proveedorId) {
    return NextResponse.json({ error: 'proveedor_id es obligatorio' }, { status: 400 });
  }

  const mimeType = file.type || 'application/octet-stream';
  console.info(`${LOG_PREVIEW} debugId=${debugId} tenant=${tenantId}`, {
    name: file.name,
    size: file.size,
    mimeType,
    proveedorId,
  });
  const { data: modulos, error: modErr } = await supabase
    .from('modulo_config')
    .select('ia_precios')
    .maybeSingle();

  if (modErr) {
    return NextResponse.json({ error: modErr.message }, { status: 500 });
  }

  if (!(MIME_TODOS_LISTA as readonly string[]).includes(mimeType)) {
    return NextResponse.json(
      { error: `Formato no soportado: ${mimeType}. Usá PDF, Excel, CSV, JPG, PNG o WebP.` },
      { status: 400 },
    );
  }

  if (file.size > MAX_ARCHIVO_LISTA_BYTES) {
    return NextResponse.json({ error: 'El archivo no puede superar 20 MB' }, { status: 400 });
  }

  const { data: proveedor } = await supabase
    .from('proveedor')
    .select('id, descuento_pct')
    .eq('id', proveedorId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!proveedor) {
    return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 });
  }

  const tBuf = Date.now();
  const arrayBuffer = await file.arrayBuffer();
  console.info(`${LOG_PREVIEW} debugId=${debugId} buffer`, {
    ms: Date.now() - tBuf,
    bytes: arrayBuffer.byteLength,
  });

  let resultado;
  const tExt = Date.now();
  try {
    resultado = await extraerArchivoYSubirAlStorage(supabase, {
      tenantId,
      userId,
      arrayBuffer,
      nombreArchivo: file.name,
      mimeType,
      iaPreciosHabilitado: Boolean(modulos?.ia_precios),
    });
    console.info(`${LOG_PREVIEW} debugId=${debugId} extracción OK`, {
      msExtraccion: Date.now() - tExt,
      items: resultado.items.length,
      iaUsada: resultado.iaUsada,
      msTotal: Date.now() - t0,
    });
  } catch (err) {
    console.error(`${LOG_PREVIEW} debugId=${debugId} extracción error`, {
      name: (err as Error).name,
      message: (err as Error).message,
      msExtraccion: Date.now() - tExt,
    });
    if (err instanceof LimiteIAError) {
      return NextResponse.json(
        { error: err.message, usadas: err.usadas, limite: err.limite },
        { status: 429 },
      );
    }
    if (esErrorExtraccionVisionIA(err)) {
      if (err.code === 'api_key' || err.code === 'config') {
        return NextResponse.json({ error: err.message }, { status: 503 });
      }
      if (err.code === 'timeout') {
        return NextResponse.json({ error: err.message }, { status: 504 });
      }
      return NextResponse.json({ error: `Error de IA: ${err.message}` }, { status: 502 });
    }
    return NextResponse.json(
      { error: (err as Error).message || 'Error al extraer items' },
      { status: 422 },
    );
  }

  if (resultado.items.length === 0) {
    return NextResponse.json(
      { error: 'No se pudo extraer ningún item válido del archivo' },
      { status: 422 },
    );
  }

  const d = round2(
    Math.min(99.99, Math.max(0, Number(proveedor.descuento_pct ?? 0))),
  );

  return NextResponse.json(
    {
      items: resultado.items,
      storage_path: resultado.storagePath,
      nombre_archivo: resultado.nombreArchivo,
      mime_type: resultado.mimeType,
      origen: resultado.origen,
      ia_usada: resultado.iaUsada,
      descuento_proveedor_default: d,
    },
    { status: 200 },
  );
}
