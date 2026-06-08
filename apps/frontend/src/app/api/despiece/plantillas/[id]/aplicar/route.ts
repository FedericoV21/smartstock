import { NextResponse } from 'next/server';

import { rejectUnlessDespieceAplicarPrecios } from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import {
  calcularDesdePlantilla,
  costoCatalogoDesdePrecioVentaDespiece,
  type PlantillaConRelaciones,
} from '@/lib/despiece/api';
import { upsertPrecioSucursalDespiece } from '@/lib/despiece/catalogo';
import { IVA_DESPIECE } from '@/lib/despiece/constantes';
import type { DespieceEstrategia } from '@/lib/despiece/tipos';
import { moduloGuardDespieceConNegocio } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function readRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await moduloGuardDespieceConNegocio();
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = await rejectUnlessDespieceAplicarPrecios(session.supabase, session);
  if (forbidden) return forbidden;

  const sucursalScope = await resolveAndValidateSucursalScope(session, null);
  if (!sucursalScope.ok) return sucursalScope.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = readRecord(body);
  const estrategia = String(b.estrategia ?? 'fija') as DespieceEstrategia;
  if (!['variable', 'fija', 'anclada'].includes(estrategia)) {
    return NextResponse.json({ error: 'Estrategia inválida.' }, { status: 400 });
  }

  const costoKgBody = Number(b.costo_kg);
  const usarCostoBody = Number.isFinite(costoKgBody) && costoKgBody > 0;

  const soloCortes = Array.isArray(b.solo_cortes)
    ? new Set(b.solo_cortes.map((x) => String(x)))
    : null;

  const { id } = await params;
  const { data, error } = await session.supabase
    .from('despiece_plantilla')
    .select(PLANTILLA_SELECT)
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Plantilla no encontrada.' }, { status: 404 });

  const plantilla = data as unknown as PlantillaConRelaciones;
  const costoDesdePadre = Number(plantilla.producto_padre?.precio_costo ?? 0);
  const costoKgCalculo = usarCostoBody ? costoKgBody : costoDesdePadre;
  const rentabilidadCatalogoPct = Number(plantilla.rentabilidad_objetivo_pct ?? 0);
  if (!(costoKgCalculo > 0)) {
    return NextResponse.json(
      {
        error:
          'Hace falta un costo por kg mayor a 0 (producto padre en catálogo o campo costo_kg al aplicar).',
      },
      { status: 400 },
    );
  }

  let resultado;
  try {
    resultado = calcularDesdePlantilla(plantilla, costoKgCalculo);
  } catch (calcError) {
    return NextResponse.json(
      { error: calcError instanceof Error ? calcError.message : 'No se pudo calcular la plantilla.' },
      { status: 400 },
    );
  }

  const cortesResultado = resultado.cortes.filter((corte) => !soloCortes || soloCortes.has(String(corte.id)));
  const productIds = cortesResultado.map((corte) => String(corte.id));
  if (productIds.length === 0) {
    return NextResponse.json({ diff: [], resultado });
  }

  const { data: productos, error: prodErr } = await session.supabase
    .from('producto')
    .select('id, nombre, precio_costo, precio_venta')
    .eq('tenant_id', session.tenantId)
    .in('id', productIds);
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });

  const productosPorId = new Map((productos ?? []).map((p) => [p.id, p]));
  const diff = cortesResultado
    .map((corte) => {
      const producto = productosPorId.get(String(corte.id));
      if (!producto) return null;
      const precioNuevoRaw =
        estrategia === 'variable'
          ? corte.variable.precioKg
          : estrategia === 'fija'
            ? corte.fija.precioKg
            : corte.anclada.precioKg;
      if (precioNuevoRaw == null) return null;
      const precioNuevo = round2(precioNuevoRaw);
      return {
        producto_id: producto.id,
        nombre: producto.nombre,
        precio_costo: Number(producto.precio_costo),
        precio_costo_nuevo: costoCatalogoDesdePrecioVentaDespiece(precioNuevo, rentabilidadCatalogoPct),
        precio_anterior: Number(producto.precio_venta),
        precio_nuevo: precioNuevo,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .filter(
      (row) =>
        row.precio_anterior !== row.precio_nuevo ||
        row.precio_costo !== row.precio_costo_nuevo,
    );

  for (const row of diff) {
    const margenAnterior =
      row.precio_costo > 0 ? ((row.precio_anterior - row.precio_costo) / row.precio_costo) * 100 : 0;
    const margenNuevo =
      row.precio_costo_nuevo > 0
        ? ((row.precio_nuevo - row.precio_costo_nuevo) / row.precio_costo_nuevo) * 100
        : 0;

    const { error: updErr } = await session.supabase
      .from('producto')
      .update({
        precio_costo: row.precio_costo_nuevo,
        precio_venta: row.precio_nuevo,
        iva_porcentaje: IVA_DESPIECE,
      } as Database['public']['Tables']['producto']['Update'])
      .eq('id', row.producto_id)
      .eq('tenant_id', session.tenantId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    try {
      await upsertPrecioSucursalDespiece(session.supabase, {
        tenantId: session.tenantId,
        productoId: row.producto_id,
        sucursalId: sucursalScope.sucursalId,
        precioCosto: row.precio_costo_nuevo,
        precioVenta: row.precio_nuevo,
      });
    } catch (precioSucursalError) {
      return NextResponse.json(
        {
          error:
            precioSucursalError instanceof Error
              ? precioSucursalError.message
              : 'No se pudo actualizar el precio de la sucursal.',
        },
        { status: 400 },
      );
    }

    await session.supabase.from('precio_historial').insert({
      tenant_id: session.tenantId,
      producto_id: row.producto_id,
      precio_costo_anterior: row.precio_costo,
      precio_costo_nuevo: row.precio_costo_nuevo,
      precio_venta_anterior: row.precio_anterior,
      precio_venta_nuevo: row.precio_nuevo,
      margen_anterior: margenAnterior,
      margen_nuevo: margenNuevo,
      origen: 'despiece' as Database['public']['Enums']['origen_precio'],
    });
  }

  return NextResponse.json({ diff, resultado });
}
