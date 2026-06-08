import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

const LOG = '[importar/archivo]';

const MAX_BYTES = 10 * 1024 * 1024;

const EXT_OK = new Set(['.xlsx', '.xls', '.csv']);

function extDeNombre(nombre: string): string {
  const i = nombre.lastIndexOf('.');
  return i >= 0 ? nombre.slice(i).toLowerCase() : '';
}

/**
 * Guarda el archivo original de la importación en Postgres (`importacion_archivo`), una fila por carga.
 */
export async function POST(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const guard = await moduloGuard('importador_excel');
  if (!guard.allowed) {
    console.info(LOG, 'módulo bloqueado');
    return guard.response;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Formulario inválido' }, { status: 400 });
  }

  const cargaIdRaw = form.get('carga_id');
  const file = form.get('file');
  if (typeof cargaIdRaw !== 'string' || !/^[0-9a-f-]{36}$/i.test(cargaIdRaw.trim())) {
    return NextResponse.json({ error: 'carga_id inválido' }, { status: 400 });
  }
  const carga_id = cargaIdRaw.trim();

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'El archivo no puede superar 10 MB' }, { status: 400 });
  }

  const nombre = file.name || 'archivo';
  const ext = extDeNombre(nombre);
  if (!EXT_OK.has(ext)) {
    return NextResponse.json(
      { error: 'Solo se aceptan archivos .xlsx, .xls o .csv' },
      { status: 400 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const tenantId = session.tenantId;

  const { error: upErr } = await session.supabase.from('importacion_archivo').upsert(
    {
      tenant_id: tenantId,
      carga_id,
      archivo_nombre: nombre,
      archivo_mime: file.type || null,
      archivo_bytes: buf,
    },
    { onConflict: 'tenant_id,carga_id' },
  );

  if (upErr) {
    console.error(LOG, 'DB', upErr.code ?? '', upErr.message);
    return NextResponse.json({ error: 'No se pudo guardar el archivo' }, { status: 500 });
  }

  console.info(LOG, 'guardado Postgres', {
    tenantShort: tenantId.slice(0, 8),
    cargaShort: `${carga_id.slice(0, 8)}…`,
    nombre,
    bytes: buf.length,
    mime: file.type || null,
  });

  return NextResponse.json({
    carga_id,
    archivo_storage_path: null,
    archivo_mime: file.type || null,
    archivo_tamano: file.size,
  });
}
