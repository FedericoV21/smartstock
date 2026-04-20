import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { generarEAN13Interno } from '@/lib/pos/ean13';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await params;

  // Check product exists
  const { data: producto } = await session.supabase
    .from('producto')
    .select('id, codigo_barras, es_pesable')
    .eq('id', id)
    .maybeSingle();

  if (!producto) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  if (producto.es_pesable) {
    return NextResponse.json(
      { error: 'Los productos pesables no usan código de barras (usá PLU).' },
      { status: 400 }
    );
  }

  if (producto.codigo_barras) {
    return NextResponse.json(
      { error: 'El producto ya tiene un código de barras asignado. Eliminalo primero para generar uno nuevo.' },
      { status: 400 }
    );
  }

  // Get next sequential: MAX of existing internal codes (prefix 20) for this tenant
  const { data: maxRow } = await session.supabase
    .from('producto')
    .select('codigo_barras')
    .like('codigo_barras', '20%')
    .eq('activo', true)
    .order('codigo_barras', { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextSeq = 1;
  if (maxRow?.codigo_barras) {
    const currentBody = maxRow.codigo_barras.substring(2, 12);
    nextSeq = parseInt(currentBody, 10) + 1;
  }

  const nuevoCodigo = generarEAN13Interno(nextSeq);

  const { data: updated, error } = await session.supabase
    .from('producto')
    .update({ codigo_barras: nuevoCodigo })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ producto: updated, codigo_generado: nuevoCodigo }, { status: 201 });
}
