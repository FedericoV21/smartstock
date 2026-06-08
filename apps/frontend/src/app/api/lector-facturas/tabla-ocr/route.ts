import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { extraerTablaFacturaConOcr } from '@/lib/lector-facturas/ocr-tabla';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';

export const runtime = 'nodejs';

const MIME_TYPES_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Formulario invalido' }, { status: 400 });
  }

  const file = formData.get('archivo');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Imagen requerida' }, { status: 400 });
  }

  if (!MIME_TYPES_PERMITIDOS.includes(file.type)) {
    return NextResponse.json(
      { error: `Formato no soportado: ${file.type || 'desconocido'}. Usa JPG, PNG o WebP.` },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'La imagen no puede superar 12 MB' }, { status: 400 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const resultado = await extraerTablaFacturaConOcr({
      bytes,
      mimeType: file.type,
      archivoNombre: file.name || 'factura.jpg',
    });
    return NextResponse.json(resultado);
  } catch (e) {
    const msg = (e as Error).message || 'No se pudo leer la tabla con OCR';
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
