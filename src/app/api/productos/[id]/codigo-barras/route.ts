import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { validarEAN13 } from '@/lib/pos/ean13';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await params;

  let body: { codigo_barras?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const codigo = body.codigo_barras?.trim();
  if (!codigo) {
    return NextResponse.json({ error: 'codigo_barras es requerido' }, { status: 400 });
  }

  if (!/^\d{8,14}$/.test(codigo)) {
    return NextResponse.json(
      { error: 'El código de barras debe tener entre 8 y 14 dígitos numéricos' },
      { status: 400 }
    );
  }

  // Check product exists and belongs to tenant
  const { data: producto } = await session.supabase
    .from('producto')
    .select('id, es_pesable')
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

  // Check for duplicates among active products in the same tenant
  const { data: duplicado } = await session.supabase
    .from('producto')
    .select('id, nombre')
    .eq('codigo_barras', codigo)
    .eq('activo', true)
    .neq('id', id)
    .maybeSingle();

  if (duplicado) {
    return NextResponse.json(
      {
        error: `El código ya está asignado a "${duplicado.nombre}"`,
        producto_duplicado: { id: duplicado.id, nombre: duplicado.nombre },
      },
      { status: 409 }
    );
  }

  // Assign barcode
  const { data, error } = await session.supabase
    .from('producto')
    .update({ codigo_barras: codigo })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Warn if not a valid EAN-13 (but still save it)
  const warning =
    codigo.length === 13 && !validarEAN13(codigo)
      ? 'El código no tiene un dígito verificador EAN-13 válido'
      : undefined;

  return NextResponse.json({ producto: data, warning });
}
