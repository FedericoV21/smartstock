import { NextResponse } from 'next/server';

import { withTesoreriaApi } from '@/lib/tesoreria/api-context';
import type { Database } from '@/types/database';

type TipoPago = Database['public']['Enums']['tipo_pago'];

export async function POST(request: Request) {
  return withTesoreriaApi(request, async ({ session, db, cajaTesoreriaId }) => {
    let body: {
      proveedor_id?: string;
      monto?: number;
      tipo_pago?: TipoPago;
      cheque_id?: string | null;
      pago_proveedor_factura_id?: string | null;
      notas?: string | null;
      fecha?: string | null;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const proveedorId = body.proveedor_id?.trim();
    if (!proveedorId) return NextResponse.json({ error: 'proveedor_id es obligatorio' }, { status: 400 });

    const monto = Number(body.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json({ error: 'monto debe ser mayor a cero' }, { status: 400 });
    }

    const tipoPago: TipoPago = body.tipo_pago === 'cheque' ? 'cheque' : 'efectivo';
    if (tipoPago === 'cheque' && !body.cheque_id?.trim()) {
      return NextResponse.json({ error: 'cheque_id es obligatorio para pago con cheque' }, { status: 400 });
    }

    const { data: prov } = await db
      .from('proveedor')
      .select('id')
      .eq('id', proveedorId)
      .eq('tenant_id', session.tenantId)
      .maybeSingle();

    if (!prov) return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 });

    const { data, error } = await (db as any).rpc('registrar_pago_proveedor_tesoreria', {
      p_tenant_id: session.tenantId,
      p_caja_tesoreria_id: cajaTesoreriaId,
      p_proveedor_id: proveedorId,
      p_monto: monto,
      p_tipo_pago: tipoPago,
      p_cheque_id: body.cheque_id?.trim() || null,
      p_pago_proveedor_factura_id: body.pago_proveedor_factura_id?.trim() || null,
      p_notas: body.notas?.trim() || null,
      p_usuario_id: session.userId,
      p_fecha: body.fecha?.trim() || null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ resultado: data });
  });
}
