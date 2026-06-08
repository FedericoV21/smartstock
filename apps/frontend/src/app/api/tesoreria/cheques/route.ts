import { NextResponse } from 'next/server';

import { withTesoreriaApi } from '@/lib/tesoreria/api-context';

export async function GET(request: Request) {
  return withTesoreriaApi(request, async ({ db, cajaTesoreriaId }) => {
    const url = new URL(request.url);
    const estado = url.searchParams.get('estado')?.trim() || null;

    let q = (db as any)
      .from('caja_tesoreria_cheque')
      .select(
        'id, numero, banco, titular, fecha_emision, fecha_cobro, monto, estado, notas, created_at, pago_id',
      )
      .eq('caja_tesoreria_id', cajaTesoreriaId)
      .order('created_at', { ascending: false });

    if (estado) q = q.eq('estado', estado);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ cheques: data ?? [] });
  });
}

export async function POST(request: Request) {
  return withTesoreriaApi(request, async ({ session, db, cajaTesoreriaId }) => {
    let body: {
      numero?: string;
      banco?: string;
      titular?: string | null;
      fecha_emision?: string | null;
      fecha_cobro?: string | null;
      monto?: number;
      notas?: string | null;
      fecha?: string | null;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const monto = Number(body.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json({ error: 'monto debe ser mayor a cero' }, { status: 400 });
    }
    if (!body.numero?.trim()) return NextResponse.json({ error: 'numero es obligatorio' }, { status: 400 });
    if (!body.banco?.trim()) return NextResponse.json({ error: 'banco es obligatorio' }, { status: 400 });

    const { data, error } = await (db as any).rpc('registrar_cheque_tesoreria', {
      p_tenant_id: session.tenantId,
      p_caja_tesoreria_id: cajaTesoreriaId,
      p_numero: body.numero.trim(),
      p_banco: body.banco.trim(),
      p_titular: body.titular?.trim() || null,
      p_fecha_emision: body.fecha_emision?.trim() || null,
      p_fecha_cobro: body.fecha_cobro?.trim() || null,
      p_monto: monto,
      p_notas: body.notas?.trim() || null,
      p_usuario_id: session.userId,
      p_fecha: body.fecha?.trim() || null,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ resultado: data });
  });
}
