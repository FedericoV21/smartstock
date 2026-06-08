import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor, rejectUnlessAnalizadorAccess } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await moduloGuard('importador_excel');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const v = rejectIfVisor(session.rol);
  if (v) return v;
  const a = rejectUnlessAnalizadorAccess(session.rol);
  if (a) return a;

  const { id: listaId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const b =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const dest = typeof b.sucursal_destino_id === 'string' ? b.sucursal_destino_id.trim() : '';
  if (!dest) {
    return NextResponse.json({ error: 'sucursal_destino_id es obligatorio.' }, { status: 400 });
  }

  const { data: lp, error: lErr } = await session.supabase
    .from('lista_precios')
    .select('id, tenant_id, sucursal_id')
    .eq('id', listaId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });
  if (!lp) {
    return NextResponse.json({ error: 'Lista no encontrada.' }, { status: 404 });
  }

  const sucLista = lp.sucursal_id;
  if (!sucLista) {
    return NextResponse.json(
      { error: 'La lista no tiene sucursal de origen; reimportá o asigná sucursal en soporte.' },
      { status: 400 },
    );
  }
  if (sucLista === dest) {
    return NextResponse.json(
      { error: 'Elegí otra sucursal: la lista ya corresponde a esa sucursal de carga.' },
      { status: 400 },
    );
  }

  if (session.isSuperAdmin || session.rol === 'admin') {
    const { data, error } = await session.supabase
      .from('sucursal')
      .select('id')
      .eq('id', dest)
      .eq('tenant_id', session.tenantId)
      .eq('activa', true)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) {
      return NextResponse.json({ error: 'Sucursal de destino no encontrada o inactiva.' }, { status: 404 });
    }
  } else {
    const { data: allowed, error } = await session.supabase.rpc('usuario_puede_operar_sucursal', {
      p_sucursal_id: dest,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!allowed) {
      return NextResponse.json({ error: 'No tenés permisos en la sucursal de destino.' }, { status: 403 });
    }
  }

  const { data, error } = await session.supabase.rpc('clonar_lista_precios_a_sucursal', {
    p_tenant_id: session.tenantId,
    p_lista_id: listaId,
    p_sucursal_destino_id: dest,
    p_usuario_id: session.userId,
  });

  if (error) {
    if (error.message.includes('misma')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data, { status: 201 });
}
