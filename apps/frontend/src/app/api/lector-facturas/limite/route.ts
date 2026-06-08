import { getTenantSession } from '@/lib/api/tenant-session';
import { verificarLimiteIA } from '@/lib/ia/limite';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { NextResponse } from 'next/server';

export async function GET() {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  try {
    const { permitido, usadas, limite } = await verificarLimiteIA(
      session.supabase,
      session.tenantId,
    );
    return NextResponse.json({ permitido, usadas, limite });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
