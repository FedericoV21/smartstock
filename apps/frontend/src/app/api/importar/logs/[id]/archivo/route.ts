import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { byteaValueToBuffer } from '@/lib/importar/bytea-buffer';
import { moduloGuard } from '@/lib/modulos/guard';

const BUCKET = 'listas-precios';

type RouteCtx = { params: Promise<{ id: string }> };

/** RFC 5987: `filename` ASCII seguro + `filename*` UTF-8 para tildes/ñ. */
function contentDispositionAttachment(nombre: string): string {
  const safe = nombre.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 200) || 'importacion';
  const encoded = encodeURIComponent(nombre.replace(/"/g, ''));
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

/**
 * Descarga el archivo: primero desde Postgres (`importacion_archivo` por `carga_id`);
 * si no hay, URL firmada de Storage (importaciones antiguas).
 */
export async function GET(_request: Request, ctx: RouteCtx) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
  }

  const { data: row, error } = await session.supabase
    .from('importacion_log')
    .select('tenant_id, archivo_storage_path, archivo_nombre, carga_id')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (error) {
    console.error('[importar/logs/archivo]', error.message);
    return NextResponse.json({ error: 'No se pudo leer el registro' }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 });
  }

  const cargaId = row.carga_id?.trim();
  if (cargaId && /^[0-9a-f-]{36}$/i.test(cargaId)) {
    const { data: arc, error: arcErr } = await session.supabase
      .from('importacion_archivo')
      .select('archivo_bytes, archivo_mime, archivo_nombre')
      .eq('tenant_id', session.tenantId)
      .eq('carga_id', cargaId)
      .maybeSingle();

    if (arcErr) {
      console.error('[importar/logs/archivo] importacion_archivo:', arcErr.message);
    } else if (arc?.archivo_bytes != null) {
      const body = byteaValueToBuffer(arc.archivo_bytes);
      if (body && body.length > 0) {
        const nombre = arc.archivo_nombre ?? row.archivo_nombre ?? 'importacion';
        const mimeRaw = arc.archivo_mime?.trim();
        const mime = mimeRaw ? mimeRaw : 'application/octet-stream';
        return new Response(Uint8Array.from(body), {
          status: 200,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(body.length),
            'Content-Disposition': contentDispositionAttachment(nombre),
            'Cache-Control': 'no-store',
          },
        });
      }
    }
  }

  const path = row.archivo_storage_path?.trim();
  if (!path) {
    return NextResponse.json({ error: 'Esta importación no tiene archivo guardado' }, { status: 404 });
  }
  if (!path.startsWith(`${session.tenantId}/`)) {
    return NextResponse.json({ error: 'Ruta no permitida' }, { status: 403 });
  }

  const { data: signed, error: signErr } = await session.supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 300);

  if (signErr || !signed?.signedUrl) {
    console.error('[importar/logs/archivo] signedUrl:', signErr?.message);
    return NextResponse.json({ error: 'No se pudo generar el enlace de descarga' }, { status: 500 });
  }

  return NextResponse.json({
    url: signed.signedUrl,
    expires_in: 300,
    archivo_nombre: row.archivo_nombre ?? 'importacion',
  });
}
