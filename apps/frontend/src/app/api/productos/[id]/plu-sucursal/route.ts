import { NextResponse } from 'next/server';

import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';
import { pluDisponibleEnSucursal } from '@/lib/producto/plu-sucursal';
import { tenantPermiteBalanzaPorSucursal } from '@/lib/pos/prefs';
import { normalizarPlu5 } from '@/lib/productos/normalizar-plu';

/**
 * Upsert o elimina override de PLU por depósito (`plu_sucursal`).
 * Body: `{ sucursal_id, plu }` — `plu: null` o vacío elimina el override (hereda producto.plu).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const operable = await idsSucursalesOperables(session);
  if (!operable.ok) return operable.response;

  const { data: tenantRow } = await session.supabase
    .from('tenant')
    .select('pos_prefs')
    .eq('id', session.tenantId)
    .maybeSingle();
  if (!tenantPermiteBalanzaPorSucursal(tenantRow?.pos_prefs)) {
    return NextResponse.json(
      {
        error:
          'La configuración de PLU por sucursal no está activa. Activá «Formato de balanza distinto por sucursal» en Configuración → Preferencias POS.',
      },
      { status: 403 },
    );
  }

  const { id: productoId } = await params;

  const { data: producto, error: pErr } = await session.supabase
    .from('producto')
    .select('id, sucursal_id, plu, es_pesable, unidad')
    .eq('id', productoId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (pErr || !producto?.sucursal_id) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }
  if (!operable.ids.includes(producto.sucursal_id)) {
    return NextResponse.json(
      { error: 'No tenes permisos para ver este producto.' },
      { status: 403 },
    );
  }

  const usaPlu =
    producto.es_pesable === true ||
    (producto.unidad === 'unidad' && !!(producto.plu ?? '').trim());
  if (!usaPlu) {
    return NextResponse.json(
      { error: 'Este producto no usa PLU de balanza.' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const b =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const sucursalId = typeof b.sucursal_id === 'string' ? b.sucursal_id.trim() : '';
  if (!sucursalId) {
    return NextResponse.json({ error: 'sucursal_id es obligatorio.' }, { status: 400 });
  }
  if (!operable.ids.includes(sucursalId)) {
    return NextResponse.json({ error: 'No tenes permisos para ese deposito.' }, { status: 403 });
  }

  if (!('plu' in b)) {
    return NextResponse.json({ error: 'plu es obligatorio (null para heredar del producto).' }, { status: 400 });
  }

  const pluNormalizado =
    b.plu === null || b.plu === '' || b.plu === undefined
      ? null
      : normalizarPlu5(b.plu);

  if (b.plu != null && b.plu !== '' && !pluNormalizado) {
    return NextResponse.json({ error: 'PLU inválido.' }, { status: 400 });
  }

  if (pluNormalizado === null) {
    const { error: delErr } = await session.supabase
      .from('plu_sucursal')
      .delete()
      .eq('tenant_id', session.tenantId)
      .eq('producto_id', productoId)
      .eq('sucursal_id', sucursalId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, deleted: true });
  }

  const disponible = await pluDisponibleEnSucursal(session.supabase, {
    tenantId: session.tenantId,
    sucursalId,
    plu: pluNormalizado,
    excludeProductoId: productoId,
  });
  if (!disponible) {
    return NextResponse.json(
      { error: 'Ya existe otro producto con ese PLU en esta sucursal.' },
      { status: 409 },
    );
  }

  const { data, error } = await session.supabase
    .from('plu_sucursal')
    .upsert(
      {
        tenant_id: session.tenantId,
        producto_id: productoId,
        sucursal_id: sucursalId,
        plu: pluNormalizado,
      },
      { onConflict: 'producto_id,sucursal_id' },
    )
    .select('sucursal_id, plu')
    .single();

  if (error) {
    const msg = error.message.includes('idx_plu_sucursal_tenant_sucursal_plu')
      ? 'Ya existe otro producto con ese PLU en esta sucursal.'
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json(data);
}
