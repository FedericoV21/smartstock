import { NextResponse } from 'next/server';

import { rejectUnlessDespieceAplicarPrecios } from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import {
  prepararCambiosCatalogoDespiece,
  validarConflictosPluCatalogo,
  type CorteCatalogoSync,
  type SolicitudSyncCatalogo,
} from '@/lib/despiece/api';
import { upsertPrecioSucursalDespiece } from '@/lib/despiece/catalogo';
import { IVA_DESPIECE } from '@/lib/despiece/constantes';
import { moduloGuardDespieceConNegocio } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

const PLANTILLA_SYNC_SELECT = `
  id,
  rentabilidad_objetivo_pct,
  cortes:despiece_corte(
    producto_hijo_id,
    nombre_en_plantilla,
    precio_anclado,
    plu_sugerido,
    orden,
    producto_hijo:producto_hijo_id(
      id,
      nombre,
      precio_costo,
      precio_venta,
      plu,
      activo,
      es_pesable,
      unidad
    )
  )
`;

function readRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function parseSolicitudes(body: unknown): SolicitudSyncCatalogo[] {
  const b = readRecord(body);
  const raw = Array.isArray(b.cambios) ? b.cambios : [];
  return raw
    .map((item) => {
      const row = readRecord(item);
      return {
        producto_id: typeof row.producto_id === 'string' ? row.producto_id.trim() : '',
        aplicar_nombre: row.aplicar_nombre === true,
        aplicar_precio: row.aplicar_precio === true,
        aplicar_plu: row.aplicar_plu === true,
        precio_nuevo:
          row.precio_nuevo == null || row.precio_nuevo === '' ? null : Number(row.precio_nuevo),
      };
    })
    .filter((row) => row.producto_id);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const solicitudes = parseSolicitudes(body);
  if (solicitudes.length === 0) {
    return NextResponse.json({ error: 'Selecciona al menos un cambio para aplicar.' }, { status: 400 });
  }

  const { id } = await params;
  const { data, error } = await session.supabase
    .from('despiece_plantilla')
    .select(PLANTILLA_SYNC_SELECT)
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Plantilla no encontrada.' }, { status: 404 });

  const plantillaSync = data as { cortes?: CorteCatalogoSync[] | null; rentabilidad_objetivo_pct?: number | null };
  const cortes = (plantillaSync.cortes ?? []).slice();
  const preparado = prepararCambiosCatalogoDespiece(
    cortes,
    solicitudes,
    Number(plantillaSync.rentabilidad_objetivo_pct ?? 0),
  );
  if (preparado.error) return NextResponse.json({ error: preparado.error }, { status: 400 });
  if (preparado.cambios.length === 0) return NextResponse.json({ cambios: [] });

  const plusDestino = Array.from(
    new Set(preparado.cambios.map((cambio) => cambio.plu_nuevo).filter((plu): plu is string => Boolean(plu))),
  );
  if (plusDestino.length > 0) {
    const { data: productosConPlu, error: pluErr } = await session.supabase
      .from('producto')
      .select('id, nombre, plu')
      .eq('tenant_id', session.tenantId)
      .eq('activo', true)
      .in('plu', plusDestino);
    if (pluErr) return NextResponse.json({ error: pluErr.message }, { status: 500 });

    const conflicto = validarConflictosPluCatalogo(preparado.cambios, productosConPlu ?? []);
    if (conflicto) return NextResponse.json({ error: conflicto }, { status: 409 });
  }

  const cambiosAplicados: typeof preparado.cambios = [];
  for (const cambio of preparado.cambios) {
    const update: Database['public']['Tables']['producto']['Update'] = {};
    if (cambio.nombre_nuevo !== undefined) update.nombre = cambio.nombre_nuevo;
    if (cambio.precio_nuevo !== undefined) {
      update.precio_costo = cambio.precio_costo_nuevo ?? cambio.precio_costo;
      update.precio_venta = cambio.precio_nuevo;
      update.iva_porcentaje = IVA_DESPIECE;
    }
    if (cambio.plu_nuevo !== undefined) {
      update.plu = cambio.plu_nuevo;
      update.codigo_barras = null;
      update.es_pesable = true;
    }

    const { error: updErr } = await session.supabase
      .from('producto')
      .update(update)
      .eq('id', cambio.producto_id)
      .eq('tenant_id', session.tenantId)
      .eq('activo', true);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

    if (cambio.precio_nuevo !== undefined) {
      try {
        await upsertPrecioSucursalDespiece(session.supabase, {
          tenantId: session.tenantId,
          productoId: cambio.producto_id,
          sucursalId: sucursalScope.sucursalId,
          precioCosto: cambio.precio_costo_nuevo ?? cambio.precio_costo,
          precioVenta: cambio.precio_nuevo,
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
    }

    if (cambio.precio_nuevo !== undefined) {
      const margenAnterior =
        cambio.precio_costo > 0
          ? ((cambio.precio_anterior - cambio.precio_costo) / cambio.precio_costo) * 100
          : 0;
      const margenNuevo =
        (cambio.precio_costo_nuevo ?? cambio.precio_costo) > 0
          ? ((cambio.precio_nuevo - (cambio.precio_costo_nuevo ?? cambio.precio_costo)) /
              (cambio.precio_costo_nuevo ?? cambio.precio_costo)) *
            100
          : 0;

      await session.supabase.from('precio_historial').insert({
        tenant_id: session.tenantId,
        producto_id: cambio.producto_id,
        precio_costo_anterior: cambio.precio_costo,
        precio_costo_nuevo: cambio.precio_costo_nuevo ?? cambio.precio_costo,
        precio_venta_anterior: cambio.precio_anterior,
        precio_venta_nuevo: cambio.precio_nuevo,
        margen_anterior: round2(margenAnterior),
        margen_nuevo: round2(margenNuevo),
        origen: 'despiece' as Database['public']['Enums']['origen_precio'],
      });
    }

    cambiosAplicados.push(cambio);
  }

  return NextResponse.json({ cambios: cambiosAplicados });
}
