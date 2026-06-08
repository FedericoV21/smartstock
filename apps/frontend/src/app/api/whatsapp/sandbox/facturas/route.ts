import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { type ArchivoFacturaEntrada } from '@/lib/lector-facturas/procesar-factura-ia';
import { processWhatsAppSandboxInvoiceUpload } from '@/lib/whatsapp/sandbox-invoice';
import { sandboxRoleFromSession } from '@/lib/whatsapp/sandbox';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function stringValue(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function archivosDesdeFormData(formData: FormData): Promise<ArchivoFacturaEntrada[]> {
  const files = formData.getAll('archivo').filter((value): value is File => value instanceof File);
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
  return archivos;
}

export async function POST(request: Request) {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const visorBlock = rejectIfVisor(session.rol);
  if (visorBlock) return visorBlock;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'FormData invalido.' }, { status: 400 });
  }

  const sucursalScope = await resolveAndValidateSucursalScope(
    session,
    stringValue(formData.get('sucursal_id')),
  );
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const archivos = await archivosDesdeFormData(formData);
  const db = createServiceRoleClient() as any;

  try {
    const result = await processWhatsAppSandboxInvoiceUpload({
      db,
      tenantId: session.tenantId,
      userId: session.userId,
      role: sandboxRoleFromSession({
        rol: session.rol,
        isSuperAdmin: session.isSuperAdmin,
      }),
      sucursalId: sucursalScope.sucursalId,
      archivos,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, messages: result.messages },
        { status: result.status },
      );
    }

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
