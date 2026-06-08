import { NextResponse } from 'next/server';

import { withTesoreriaApi } from '@/lib/tesoreria/api-context';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: chequeId } = await params;
  return withTesoreriaApi(request, async ({ session, db, cajaTesoreriaId }) => {
    let body: { estado?: string; notas?: string | null };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const estado = body.estado?.trim();
    if (estado !== 'depositado' && estado !== 'rechazado') {
      return NextResponse.json({ error: 'estado debe ser depositado o rechazado' }, { status: 400 });
    }

    const { data: chequeRow } = await (db as any)
      .from('caja_tesoreria_cheque')
      .select('id')
      .eq('id', chequeId)
      .eq('caja_tesoreria_id', cajaTesoreriaId)
      .maybeSingle();

    if (!chequeRow) return NextResponse.json({ error: 'Cheque no encontrado' }, { status: 404 });

    const { data, error } = await (db as any).rpc('cambiar_estado_cheque_tesoreria', {
      p_tenant_id: session.tenantId,
      p_cheque_id: chequeId,
      p_estado: estado,
      p_notas: body.notas?.trim() || null,
      p_usuario_id: session.userId,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ cheque: data });
  });
}
