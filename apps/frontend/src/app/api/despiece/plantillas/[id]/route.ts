import { NextResponse } from 'next/server';

import {
  rejectUnlessDespieceEditar,
  rejectUnlessDespieceVer,
} from '@/lib/api/permissions';
import { getTenantSession } from '@/lib/api/tenant-session';
import {
  parsePlantillaPayload,
  validarPlantillaPayload,
  validarProductosCorteElegibles,
  type DespieceCortePayload,
} from '@/lib/despiece/api';
import { forzarIvaDespiece } from '@/lib/despiece/iva';
import { moduloGuardDespieceConNegocio } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

type TenantSessionOk = Extract<Awaited<ReturnType<typeof getTenantSession>>, { tenantId: string }>;

const PLANTILLA_SELECT = `
  id,
  nombre,
  producto_padre_id,
  peso_total_kg,
  unidad_base_tipo,
  unidad_base_nombre,
  unidad_base_cantidad,
  unidad_contenedor_nombre,
  unidad_contenedor_cantidad,
  rentabilidad_objetivo_pct,
  activo,
  notas,
  created_at,
  updated_at,
  producto_padre:producto_padre_id(id, nombre, precio_costo, precio_venta),
  cortes:despiece_corte(
    id,
    producto_hijo_id,
    kg_rendimiento,
    factor_ajuste_pct,
    precio_anclado,
    nombre_en_plantilla,
    plu_sugerido,
    peso_promedio_unidad_kg,
    orden,
    producto_hijo:producto_hijo_id(id, nombre, precio_costo, precio_venta, unidad, plu, activo, es_pesable)
  )
`;

async function validarProductosCorteEnTenant(
  session: TenantSessionOk,
  cortes: DespieceCortePayload[],
): Promise<NextResponse | null> {
  const ids = Array.from(new Set(cortes.map((c) => c.producto_hijo_id).filter(Boolean)));
  if (ids.length === 0) return null;

  const { data, error } = await session.supabase
    .from('producto')
    .select('id, nombre, activo, es_pesable, unidad')
    .eq('tenant_id', session.tenantId)
    .in('id', ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const validation = validarProductosCorteElegibles(cortes, data ?? []);
  if (validation) return NextResponse.json({ error: validation }, { status: 400 });
  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuardDespieceConNegocio();
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = await rejectUnlessDespieceVer(session.supabase, session);
  if (forbidden) return forbidden;

  const { id } = await params;
  const { data, error } = await session.supabase
    .from('despiece_plantilla')
    .select(PLANTILLA_SELECT)
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Plantilla no encontrada.' }, { status: 404 });

  return NextResponse.json({ plantilla: data });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuardDespieceConNegocio();
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = await rejectUnlessDespieceEditar(session.supabase, session);
  if (forbidden) return forbidden;

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const payload = parsePlantillaPayload(body);
  const validation = validarPlantillaPayload(payload);
  if (validation) return NextResponse.json({ error: validation }, { status: 400 });
  const cortes = payload.cortes ?? [];
  const productosCorteInvalidos = await validarProductosCorteEnTenant(session, cortes);
  if (productosCorteInvalidos) return productosCorteInvalidos;

  if (payload.producto_padre_id) {
    const { data: padreOk, error: padreErr } = await session.supabase
      .from('producto')
      .select('id')
      .eq('id', payload.producto_padre_id)
      .eq('tenant_id', session.tenantId)
      .maybeSingle();
    if (padreErr) return NextResponse.json({ error: padreErr.message }, { status: 500 });
    if (!padreOk) return NextResponse.json({ error: 'Producto padre no encontrado.' }, { status: 404 });
  }

  const { data: actual } = await session.supabase
    .from('despiece_plantilla')
    .select('id, producto_padre_id')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (!actual) return NextResponse.json({ error: 'Plantilla no encontrada.' }, { status: 404 });

  const { data, error } = await session.supabase
    .from('despiece_plantilla')
    .update({
      nombre: payload.nombre,
      producto_padre_id: payload.producto_padre_id,
      peso_total_kg: payload.peso_total_kg,
      unidad_base_tipo: payload.unidad_base_tipo,
      unidad_base_nombre: payload.unidad_base_tipo === 'unidad' ? payload.unidad_base_nombre : null,
      unidad_base_cantidad: payload.unidad_base_tipo === 'unidad' ? payload.unidad_base_cantidad : 1,
      unidad_contenedor_nombre:
        payload.unidad_base_tipo === 'unidad' ? payload.unidad_contenedor_nombre : null,
      unidad_contenedor_cantidad:
        payload.unidad_base_tipo === 'unidad' ? payload.unidad_contenedor_cantidad : null,
      rentabilidad_objetivo_pct: payload.rentabilidad_objetivo_pct,
      activo: payload.activo ?? true,
      notas: payload.notas ?? null,
    })
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { error: delErr } = await session.supabase
    .from('despiece_corte')
    .delete()
    .eq('plantilla_id', id)
    .eq('tenant_id', session.tenantId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

  if (cortes.length > 0) {
    const { error: cortesErr } = await session.supabase.from('despiece_corte').insert(
      cortes.map((corte, index) => ({
        tenant_id: session.tenantId,
        plantilla_id: id,
        producto_hijo_id: corte.producto_hijo_id,
        kg_rendimiento: corte.kg_rendimiento,
        factor_ajuste_pct: corte.factor_ajuste_pct ?? 0,
        precio_anclado: corte.precio_anclado,
        nombre_en_plantilla: corte.nombre_en_plantilla,
        plu_sugerido: corte.plu_sugerido,
        peso_promedio_unidad_kg: corte.peso_promedio_unidad_kg,
        orden: corte.orden ?? index,
      })),
    );
    if (cortesErr) return NextResponse.json({ error: cortesErr.message }, { status: 400 });
  }

  if (payload.producto_padre_id) {
    await session.supabase
      .from('producto')
      .update({ es_despiece_padre: true } as Database['public']['Tables']['producto']['Update'])
      .eq('id', payload.producto_padre_id)
      .eq('tenant_id', session.tenantId);
  }

  await forzarIvaDespiece(
    session.supabase,
    session.tenantId,
    [payload.producto_padre_id, ...cortes.map((c) => c.producto_hijo_id)],
  );

  const viejoPadre = actual.producto_padre_id;
  const nuevoPadre = payload.producto_padre_id;
  if (viejoPadre && viejoPadre !== nuevoPadre) {
    const { count } = await session.supabase
      .from('despiece_plantilla')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', session.tenantId)
      .eq('producto_padre_id', viejoPadre);
    if ((count ?? 0) === 0) {
      await session.supabase
        .from('producto')
        .update({ es_despiece_padre: false } as Database['public']['Tables']['producto']['Update'])
        .eq('id', viejoPadre)
        .eq('tenant_id', session.tenantId);
    }
  }

  return NextResponse.json({ plantilla: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuardDespieceConNegocio();
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = await rejectUnlessDespieceEditar(session.supabase, session);
  if (forbidden) return forbidden;

  const { id } = await params;
  const { data: actual } = await session.supabase
    .from('despiece_plantilla')
    .select('id, producto_padre_id')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (!actual) return NextResponse.json({ error: 'Plantilla no encontrada.' }, { status: 404 });

  const { error } = await session.supabase
    .from('despiece_plantilla')
    .update({ activo: false })
    .eq('id', id)
    .eq('tenant_id', session.tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (actual.producto_padre_id) {
    const { count } = await session.supabase
      .from('despiece_plantilla')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', session.tenantId)
      .eq('producto_padre_id', actual.producto_padre_id)
      .eq('activo', true);

    if ((count ?? 0) === 0) {
      await session.supabase
        .from('producto')
        .update({ es_despiece_padre: false } as Database['public']['Tables']['producto']['Update'])
        .eq('id', actual.producto_padre_id)
        .eq('tenant_id', session.tenantId);
    }
  }

  return NextResponse.json({ success: true });
}
