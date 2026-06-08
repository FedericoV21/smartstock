import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';
import { NextResponse } from 'next/server';

export async function GET() {
  const guard = await moduloGuardAny(MODULOS_ACCESO_LECTOR_FACTURAS);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { data, error } = await session.supabase
    .from('lector_factura_log')
    .select(
      'id, created_at, updated_at, estado, direccion, archivo_nombre, comprobante_id, error_mensaje',
    )
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ logs: data ?? [] });
}
