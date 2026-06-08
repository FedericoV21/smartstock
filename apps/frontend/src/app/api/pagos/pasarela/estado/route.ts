import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const url = new URL(request.url);
  const transaccionId = url.searchParams.get('transaccion_id')?.trim();
  const comprobanteId = url.searchParams.get('comprobante_id')?.trim();
  if (!transaccionId && !comprobanteId) {
    return NextResponse.json({ error: 'transaccion_id o comprobante_id requerido' }, { status: 400 });
  }

  const db = session.supabase as any;
  let q = db
    .from('pasarela_transaccion')
    .select('*')
    .eq('tenant_id', session.tenantId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (transaccionId) q = q.eq('id', transaccionId);
  if (comprobanteId) q = q.eq('comprobante_id', comprobanteId);

  const { data, error } = await q.maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Transaccion no encontrada' }, { status: 404 });
  return NextResponse.json({ transaccion: data });
}
