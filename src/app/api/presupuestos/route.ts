import { NextResponse, type NextRequest } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { PRESUPUESTOS_ACCESO_BLOQUEADO } from '@/lib/features/presupuestos-acceso';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(request: NextRequest) {
  if (PRESUPUESTOS_ACCESO_BLOQUEADO) {
    return NextResponse.json({ error: 'Presupuestos no disponible por el momento.' }, { status: 403 });
  }
  const guard = await moduloGuard('presupuestos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { searchParams } = new URL(request.url);
  const pagina = Math.max(1, parseInt(searchParams.get('pagina') ?? '1', 10));
  const porPagina = Math.min(100, Math.max(1, parseInt(searchParams.get('por_pagina') ?? '25', 10)));
  const offset = (pagina - 1) * porPagina;

  const { data, error, count } = await session.supabase
    .from('comprobante')
    .select(
      'id, tipo, numero, fecha, subtotal, iva_monto, total, estado, cliente:cliente_id(nombre, razon_social), created_at',
      { count: 'exact' }
    )
    .eq('tipo', 'presupuesto')
    .order('fecha', { ascending: false })
    .order('numero', { ascending: false })
    .range(offset, offset + porPagina - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    presupuestos: data ?? [],
    total: count ?? 0,
    pagina,
    por_pagina: porPagina,
  });
}
