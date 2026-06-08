import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { byteaValueToBuffer } from '@/lib/importar/bytea-buffer';
import type { ImportacionBorradorPayloadV1 } from '@/lib/importar/borradores';
import {
  contarChunksBorrador,
  metadataDesdePayload,
  nuevoCargaId,
  puedeAccederBorrador,
  uuidOk,
  validarPayloadBorrador,
} from '@/lib/importar/borradores-server';
import { moduloGuardAny } from '@/lib/modulos/guard';

type RouteCtx = { params: Promise<{ id: string }> };

async function cargarBorrador(session: any, id: string) {
  if (!uuidOk(id)) {
    return { response: NextResponse.json({ error: 'ID invalido' }, { status: 400 }) };
  }
  const { data, error } = await (session.supabase as any)
    .from('importacion_borrador')
    .select('id, tenant_id, usuario_id, sucursal_id, archivo_nombre, payload')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .eq('estado', 'activo')
    .maybeSingle();
  if (error) return { response: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!data) return { response: NextResponse.json({ error: 'Borrador no encontrado' }, { status: 404 }) };
  if (!puedeAccederBorrador(session, data)) {
    return { response: NextResponse.json({ error: 'Sin permisos' }, { status: 403 }) };
  }
  return { data };
}

export async function POST(request: Request, ctx: RouteCtx) {
  const guard = await moduloGuardAny(['importador_excel', 'ia_precios']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await ctx.params;
  const loaded = await cargarBorrador(session, id);
  if ('response' in loaded) return loaded.response;

  let body: { filas_incluidas?: number[] | null } = {};
  try {
    const raw = await request.text();
    if (raw.trim()) {
      body = JSON.parse(raw) as { filas_incluidas?: number[] | null };
    }
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const db = session.supabase as any;

  if (Array.isArray(body.filas_incluidas) && body.filas_incluidas.length > 0) {
    let payload: ImportacionBorradorPayloadV1;
    try {
      payload = validarPayloadBorrador(loaded.data.payload);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    const filasIncluidas = body.filas_incluidas.filter(
      (n): n is number => typeof n === 'number' && Number.isFinite(n),
    );
    const nextPayload: ImportacionBorradorPayloadV1 = {
      ...payload,
      preview: {
        ...payload.preview,
        importConfirm: {
          ...payload.preview?.importConfirm,
          filas_incluidas: filasIncluidas,
        },
      },
    };
    const { error: updErr } = await db
      .from('importacion_borrador')
      .update(metadataDesdePayload(nextPayload))
      .eq('id', id)
      .eq('tenant_id', session.tenantId);
    if (updErr) {
      console.error('[importar/borradores/preparar] payload confirm:', updErr.message);
      return NextResponse.json({ error: 'No se pudo guardar la confirmación del borrador' }, { status: 500 });
    }
  }

  const cargaId = nuevoCargaId();
  let archivoMime: string | null = null;
  let archivoTamano: number | null = null;

  const { data: arc, error: arcErr } = await db
    .from('importacion_borrador_archivo')
    .select('archivo_nombre, archivo_mime, archivo_tamano, archivo_bytes')
    .eq('borrador_id', id)
    .maybeSingle();

  if (arcErr) {
    console.error('[importar/borradores/preparar] archivo:', arcErr.message);
    return NextResponse.json({ error: 'No se pudo leer el archivo del borrador' }, { status: 500 });
  }

  if (arc?.archivo_bytes != null) {
    const bytes = byteaValueToBuffer(arc.archivo_bytes);
    if (!bytes || bytes.length === 0) {
      return NextResponse.json({ error: 'El archivo guardado esta vacio' }, { status: 500 });
    }
    const { error } = await db.from('importacion_archivo').upsert(
      {
        tenant_id: session.tenantId,
        carga_id: cargaId,
        archivo_nombre: arc.archivo_nombre ?? loaded.data.archivo_nombre ?? 'importacion',
        archivo_mime: arc.archivo_mime ?? null,
        archivo_bytes: bytes,
      },
      { onConflict: 'tenant_id,carga_id' },
    );
    if (error) {
      console.error('[importar/borradores/preparar] importacion_archivo:', error.message);
      return NextResponse.json({ error: 'No se pudo preparar el archivo de confirmacion' }, { status: 500 });
    }
    archivoMime = arc.archivo_mime ?? null;
    archivoTamano =
      typeof arc.archivo_tamano === 'number' && Number.isFinite(arc.archivo_tamano)
        ? arc.archivo_tamano
        : bytes.length;
  }

  let chunkCount = 0;
  try {
    chunkCount = await contarChunksBorrador(db, id);
  } catch (e) {
    console.error('[importar/borradores/preparar] chunks:', (e as Error).message);
    return NextResponse.json({ error: 'No se pudo contar los lotes del borrador' }, { status: 500 });
  }

  return NextResponse.json({
    carga_id: cargaId,
    sucursal_id: loaded.data.sucursal_id ?? null,
    archivo_storage_path: null,
    archivo_mime: archivoMime,
    archivo_tamano: archivoTamano,
    chunk_count: chunkCount,
  });
}
