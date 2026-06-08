import { NextResponse } from 'next/server';

import { withTesoreriaApi } from '@/lib/tesoreria/api-context';

export async function POST(request: Request) {
  return withTesoreriaApi(request, async ({ session, db, cajaTesoreriaId }) => {
    let body: { monto?: number; notas?: string | null; fecha?: string | null };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const monto = Number(body.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json({ error: 'monto debe ser mayor a cero' }, { status: 400 });
    }

    const { data, error } = await (db as any).rpc('registrar_ingreso_efectivo_tesoreria', {
      p_tenant_id: session.tenantId,
      p_caja_tesoreria_id: cajaTesoreriaId,
      p_monto: monto,
      p_notas: body.notas?.trim() || null,
      p_usuario_id: session.userId,
      p_fecha: body.fecha?.trim() || null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ movimiento: data });
  });
}
