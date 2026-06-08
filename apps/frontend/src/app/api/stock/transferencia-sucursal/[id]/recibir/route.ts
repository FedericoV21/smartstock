import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

function rpcErrorStatus(message: string): number {
  const lower = message.toLowerCase();
  if (lower.includes('no esta pendiente') || lower.includes('no está pendiente')) return 409;
  if (lower.includes('no encontrada') || lower.includes('no encontrado')) return 404;
  return 500;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const denied = rejectIfVisor(session.rol);
  if (denied) return denied;

  const { id } = await params;
  const transferenciaId = id.trim();
  if (!transferenciaId) {
    return NextResponse.json({ error: 'transferencia_id es obligatorio.' }, { status: 400 });
  }

  const { data: transferencia, error: findErr } = await (session.supabase as any)
    .from('stock_transferencia_sucursal')
    .select('id, sucursal_destino_id, estado')
    .eq('id', transferenciaId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
  if (!transferencia) {
    return NextResponse.json({ error: 'Transferencia no encontrada.' }, { status: 404 });
  }
  if (transferencia.estado !== 'pendiente') {
    return NextResponse.json({ error: 'La transferencia ya no esta pendiente.' }, { status: 409 });
  }

  const scope = await resolveAndValidateSucursalScope(session, transferencia.sucursal_destino_id);
  if (!scope.ok) return scope.response;

  const { data, error } = await (session.supabase as any).rpc('aceptar_transferencia_stock_sucursal', {
    p_tenant_id: session.tenantId,
    p_transferencia_id: transferenciaId,
    p_usuario_id: session.userId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: rpcErrorStatus(error.message) });
  }

  return NextResponse.json(data);
}
