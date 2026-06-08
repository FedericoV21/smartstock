import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { id: productoId } = await params;

  const { data: prod, error: pErr } = await session.supabase
    .from('producto')
    .select('id')
    .eq('id', productoId)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }
  if (!prod) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  const { data, error } = await session.supabase
    .from('producto_promocion')
    .select(
      `
      promocion_id,
      promocion (
        id,
        nombre,
        tipo,
        activa,
        vigente_desde,
        vigente_hasta,
        dias_semana,
        cantidad_lleva,
        cantidad_paga,
        unidad_descuento,
        porcentaje,
        cantidad_minima
      )
    `,
    )
    .eq('producto_id', productoId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Embed = Record<string, unknown> | Record<string, unknown>[] | null;
  const promociones = (data ?? [])
    .map((row) => {
      const embed = row.promocion as Embed;
      const p = Array.isArray(embed) ? embed[0] : embed;
      return p as Record<string, unknown> | null;
    })
    .filter((p): p is Record<string, unknown> => p != null && typeof p.id === 'string');

  return NextResponse.json({ promociones });
}
