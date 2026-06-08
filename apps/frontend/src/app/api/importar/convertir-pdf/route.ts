import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { convertirPdfTextoATabla } from '@/lib/importar/pdf-a-tabla';
import { PDF_TO_TABLE_MAX_BYTES, PDF_TO_TABLE_MAX_MB } from '@/lib/importar/pdf-upload-limits';
import { moduloGuardAny } from '@/lib/modulos/guard';

const LOG = '[importar/convertir-pdf]';

export async function POST(request: Request) {
  const debugId = request.headers.get('x-debug-request-id') ?? null;
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  /** Texto selectable vía pdf.js: sirve tanto a IA Precios como al importador estándar. */
  const guard = await moduloGuardAny(['ia_precios', 'importador_excel']);
  if (!guard.allowed) return guard.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    console.warn(LOG, 'form-data-invalido', { debugId });
    return NextResponse.json({ error: 'Formulario inválido' }, { status: 400 });
  }

  const file = form.get('archivo');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Archivo PDF requerido' }, { status: 400 });
  }

  if (file.size > PDF_TO_TABLE_MAX_BYTES) {
    return NextResponse.json({ error: `El PDF no puede superar ${PDF_TO_TABLE_MAX_MB} MB` }, { status: 400 });
  }

  const lower = (file.name || '').toLowerCase();
  if (file.type !== 'application/pdf' && !lower.endsWith('.pdf')) {
    return NextResponse.json({ error: 'Solo se aceptan archivos PDF' }, { status: 400 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { headers, filas, totalFilas } = await convertirPdfTextoATabla(bytes);
    console.info(LOG, 'ok', {
      debugId,
      tenantShort: session.tenantId.slice(0, 8),
      nombre: file.name,
      totalFilas,
      cols: headers.length,
    });
    return NextResponse.json({
      headers,
      filas,
      totalFilas,
      archivo_nombre: file.name || 'documento.pdf',
    });
  } catch (e) {
    const msg = (e as Error).message || 'Error al leer el PDF';
    console.warn(LOG, 'fallo', { debugId, error: msg });
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
