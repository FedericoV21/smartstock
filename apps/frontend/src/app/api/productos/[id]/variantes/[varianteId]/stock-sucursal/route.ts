import { NextResponse } from 'next/server';

import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; varianteId: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id: productoId, varianteId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const sucursalId = typeof b.sucursal_id === 'string' ? b.sucursal_id.trim() : '';
  if (!sucursalId) return NextResponse.json({ error: 'sucursal_id es obligatorio.' }, { status: 400 });

  const operable = await idsSucursalesOperables(session);
  if (!operable.ok) return operable.response;
  if (!operable.ids.includes(sucursalId)) {
    return NextResponse.json({ error: 'No tenés permisos para esa sucursal.' }, { status: 403 });
  }

  const { data: variante, error: vErr } = await session.supabase
    .from('producto_variante')
    .select('id')
    .eq('id', varianteId)
    .eq('producto_id', productoId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  if (!variante) return NextResponse.json({ error: 'Variante no encontrada.' }, { status: 404 });

  const updates = {
    stock_actual: Number.isFinite(Number(b.stock_actual)) ? Number(b.stock_actual) : 0,
    stock_minimo: Number.isFinite(Number(b.stock_minimo)) ? Number(b.stock_minimo) : 0,
    ubicacion: typeof b.ubicacion === 'string' && b.ubicacion.trim() ? b.ubicacion.trim() : null,
  };

  const { data, error } = await session.supabase
    .from('producto_variante_stock_sucursal')
    .upsert(
      {
        tenant_id: session.tenantId,
        producto_id: productoId,
        variante_id: varianteId,
        sucursal_id: sucursalId,
        ...updates,
      },
      { onConflict: 'variante_id,sucursal_id' },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
