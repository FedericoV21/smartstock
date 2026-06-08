import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import {
  IMPORTACION_BORRADOR_MAX_BYTES,
  puedeAccederBorrador,
  uuidOk,
} from '@/lib/importar/borradores-server';
import { moduloGuardAny } from '@/lib/modulos/guard';

type RouteCtx = { params: Promise<{ id: string }> };

const EXT_OK = new Set(['.xlsx', '.xls', '.csv', '.pdf']);

function extDeNombre(nombre: string): string {
  const i = nombre.lastIndexOf('.');
  return i >= 0 ? nombre.slice(i).toLowerCase() : '';
}

async function cargarBorrador(session: any, id: string) {
  if (!uuidOk(id)) {
    return { response: NextResponse.json({ error: 'ID invalido' }, { status: 400 }) };
  }
  const { data, error } = await (session.supabase as any)
    .from('importacion_borrador')
    .select('id, tenant_id, usuario_id')
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Formulario invalido' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 });
  }
  if (file.size > IMPORTACION_BORRADOR_MAX_BYTES) {
    return NextResponse.json({ error: 'El archivo no puede superar 20 MB' }, { status: 400 });
  }
  const nombre = file.name || 'archivo';
  const ext = extDeNombre(nombre);
  const esPdf = file.type === 'application/pdf' || nombre.toLowerCase().endsWith('.pdf');
  if (!EXT_OK.has(ext) && !esPdf) {
    return NextResponse.json(
      { error: 'Solo se aceptan archivos .xlsx, .xls, .csv o PDF' },
      { status: 400 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const db = session.supabase as any;
  const { error } = await db.from('importacion_borrador_archivo').upsert(
    {
      borrador_id: id,
      archivo_nombre: nombre,
      archivo_mime: file.type || null,
      archivo_tamano: file.size,
      archivo_bytes: buf,
    },
    { onConflict: 'borrador_id' },
  );
  if (error) {
    console.error('[importar/borradores/:id/archivo]', error.message);
    return NextResponse.json({ error: 'No se pudo guardar el archivo' }, { status: 500 });
  }

  const { error: updErr } = await db
    .from('importacion_borrador')
    .update({
      archivo_mime: file.type || null,
      archivo_tamano: file.size,
    })
    .eq('id', id)
    .eq('tenant_id', session.tenantId);
  if (updErr) {
    console.warn('[importar/borradores/:id/archivo] metadata:', updErr.message);
  }

  return NextResponse.json({
    archivo_mime: file.type || null,
    archivo_tamano: file.size,
  });
}
