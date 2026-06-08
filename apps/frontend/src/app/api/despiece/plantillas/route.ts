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
  producto_padre:producto_padre_id(id, nombre, precio_costo, precio_venta, proveedor_id),
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

export async function GET(request: Request) {
  const guard = await moduloGuardDespieceConNegocio();
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = await rejectUnlessDespieceVer(session.supabase, session);
  if (forbidden) return forbidden;

  const url = new URL(request.url);
  const activo = url.searchParams.get('activo');
  const q = (url.searchParams.get('q') ?? '').trim();

  let query = session.supabase
    .from('despiece_plantilla')
    .select(PLANTILLA_SELECT)
    .eq('tenant_id', session.tenantId)
    .order('updated_at', { ascending: false });

  if (activo === 'true') query = query.eq('activo', true);
  if (activo === 'false') query = query.eq('activo', false);
  if (q) query = query.ilike('nombre', `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ plantillas: data ?? [] });
}

export async function POST(request: Request) {
  const guard = await moduloGuardDespieceConNegocio();
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = await rejectUnlessDespieceEditar(session.supabase, session);
  if (forbidden) return forbidden;

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
    const { data: padre, error: padreErr } = await session.supabase
      .from('producto')
      .select('id')
      .eq('id', payload.producto_padre_id)
      .eq('tenant_id', session.tenantId)
      .maybeSingle();
    if (padreErr) return NextResponse.json({ error: padreErr.message }, { status: 500 });
    if (!padre) return NextResponse.json({ error: 'Producto padre no encontrado.' }, { status: 404 });
  }

  const { data: plantilla, error } = await session.supabase
    .from('despiece_plantilla')
    .insert({
      tenant_id: session.tenantId,
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
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (cortes.length > 0) {
    const { error: cortesErr } = await session.supabase.from('despiece_corte').insert(
      cortes.map((corte, index) => ({
        tenant_id: session.tenantId,
        plantilla_id: plantilla.id,
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
    if (cortesErr) {
      await session.supabase.from('despiece_plantilla').delete().eq('id', plantilla.id);
      return NextResponse.json({ error: cortesErr.message }, { status: 400 });
    }
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

  return NextResponse.json({ plantilla }, { status: 201 });
}
