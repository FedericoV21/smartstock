import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

type TipoPago = Database['public']['Enums']['tipo_pago'];

type RpcPago = {
  pago_proveedor_movimiento_id?: string;
  nuevo_saldo?: number;
  pago_cuenta_corriente_id?: string;
  monto_aplicado?: number;
  saldo_a_favor_generado?: number;
};

/**
 * Registra un pago parcial o total contra una obligación (pago_proveedor_factura).
 * Si el monto supera el pendiente, el excedente queda como saldo a favor del tenant.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const { id: pagoProveedorFacturaId } = await ctx.params;

  let body: {
    monto?: number;
    tipo_pago?: TipoPago;
    notas?: string | null;
    /** Fecha del pago (YYYY-MM-DD). */
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

  const { data: row, error: loadErr } = await session.supabase
    .from('pago_proveedor_factura')
    .select('id, saldo_pendiente, proveedor_id, tenant_id, estado')
    .eq('id', pagoProveedorFacturaId)
    .maybeSingle();

  if (loadErr || !row) {
    return NextResponse.json(
      { error: loadErr?.message ?? 'Obligación no encontrada' },
      { status: loadErr ? 500 : 404 },
    );
  }

  if (row.estado === 'anulada') {
    return NextResponse.json({ error: 'Obligación anulada' }, { status: 400 });
  }

  const tipoPago = body.tipo_pago ?? 'efectivo';
  let fechaP: string | null = null;
  if (body.fecha != null && String(body.fecha).trim() !== '') {
    const s = String(body.fecha).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return NextResponse.json({ error: 'fecha inválida (usá YYYY-MM-DD)' }, { status: 400 });
    }
    fechaP = s;
  }

  const { data, error } = await session.supabase.rpc('registrar_pago_proveedor', {
    p_pago_proveedor_factura_id: pagoProveedorFacturaId,
    p_monto: monto,
    p_tipo_pago: tipoPago,
    p_notas: body.notas?.trim() || null,
    p_usuario_id: session.userId,
    p_fecha: fechaP,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('supera el saldo') || msg.includes('encontrad')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const resultado = data as RpcPago;
  if (resultado.pago_proveedor_movimiento_id && resultado.pago_cuenta_corriente_id) {
    const { error: linkErr } = await session.supabase
      .from('pago_proveedor_movimiento')
      .update({ pago_cuenta_corriente_id: resultado.pago_cuenta_corriente_id })
      .eq('tenant_id', session.tenantId)
      .eq('id', resultado.pago_proveedor_movimiento_id);

    if (linkErr) {
      return NextResponse.json(
        { error: `Pago registrado, pero no se pudo vincular para reversión: ${linkErr.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ resultado });
}
