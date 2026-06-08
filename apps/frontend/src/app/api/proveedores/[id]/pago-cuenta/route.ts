import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { rejectUnlessProveedorEdicion } from '@/lib/api/permissions';
import { moduloGuard } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

type TipoPago = Database['public']['Enums']['tipo_pago'];

/**
 * Pago directo a la cuenta del proveedor. Si supera la deuda o no hay deuda,
 * deja saldo a favor del tenant frente al proveedor.
 * Útil para ajustar deuda heredada o pagos a cuenta no asociados a pago_proveedor_factura.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;
  const deniedProv = await rejectUnlessProveedorEdicion(session.supabase, session);
  if (deniedProv) return deniedProv;

  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const { id: proveedorId } = await ctx.params;

  let body: {
    monto?: number;
    tipo_pago?: TipoPago;
    notas?: string | null;
    referencia?: string | null;
    fecha?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const monto = Number(body.monto);
  if (!Number.isFinite(monto) || monto <= 0) {
    return NextResponse.json({ error: 'monto debe ser un número mayor a cero' }, { status: 400 });
  }

  const { data: prov, error: pErr } = await session.supabase
    .from('proveedor')
    .select('id')
    .eq('id', proveedorId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (pErr || !prov) {
    return NextResponse.json(
      { error: pErr?.message ?? 'Proveedor no encontrado' },
      { status: pErr ? 500 : 404 },
    );
  }

  let fechaP: string | null = null;
  if (body.fecha != null && String(body.fecha).trim() !== '') {
    const s = String(body.fecha).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return NextResponse.json({ error: 'fecha inválida (usá YYYY-MM-DD)' }, { status: 400 });
    }
    fechaP = s;
  }

  const { data, error: rpcErr } = await session.supabase.rpc('registrar_pago_cuenta_proveedor', {
    p_tenant_id: session.tenantId,
    p_proveedor_id: proveedorId,
    p_monto: monto,
    p_tipo_pago: body.tipo_pago ?? 'efectivo',
    p_comprobante_id: null,
    p_referencia: body.referencia?.trim() || null,
    p_notas: body.notas?.trim() || null,
    p_usuario_id: session.userId,
    p_fecha: fechaP,
  });

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 400 });
  }

  return NextResponse.json({ pago: data });
}
