import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import {
  procesarFacturaIa,
  validarArchivosFacturaIa,
  type ArchivoFacturaEntrada,
} from '@/lib/lector-facturas/procesar-factura-ia';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';

async function filesDesdeFormData(request: Request): Promise<ArchivoFacturaEntrada[]> {
  const formData = await request.formData();
  const files = formData.getAll('archivo').filter((v): v is File => v instanceof File);
  const archivos: ArchivoFacturaEntrada[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const arrayBuffer = await file.arrayBuffer();
    archivos.push({
      name: file.name || `factura-${i + 1}`,
      type: file.type,
      size: file.size,
      bytes: new Uint8Array(arrayBuffer),
    });
  }

  return archivos;
}

export async function POST(request: Request) {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const sessionCtx = await getTenantSession();
  if ('error' in sessionCtx) return sessionCtx.error;

  const visorBlock = rejectIfVisor(sessionCtx.rol);
  if (visorBlock) return visorBlock;

  const archivos = await filesDesdeFormData(request);
  const validacion = validarArchivosFacturaIa(archivos);
  if (!validacion.ok) {
    return NextResponse.json({ error: validacion.error }, { status: validacion.status });
  }

  const result = await procesarFacturaIa({
    supabase: sessionCtx.supabase,
    tenantId: sessionCtx.tenantId,
    userId: sessionCtx.userId,
    archivos,
    source: 'plataforma',
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        ...(result.respuesta_raw ? { respuesta_raw: result.respuesta_raw } : {}),
      },
      { status: result.status },
    );
  }

  return NextResponse.json(result.payload);
}
