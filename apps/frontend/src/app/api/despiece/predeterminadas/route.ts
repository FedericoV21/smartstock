import { NextResponse } from 'next/server';

import { rejectUnlessDespieceEditar } from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { IVA_DESPIECE } from '@/lib/despiece/constantes';
import { forzarIvaDespiece } from '@/lib/despiece/iva';
import { PLANTILLAS_DESPIECE_PREDETERMINADAS } from '@/lib/despiece/predeterminadas';
import { moduloGuardDespieceConNegocio } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

type ProductoSeed = {
  codigo: string;
  nombre: string;
  precioCosto: number;
  precioVenta?: number;
  esPadre?: boolean;
};

async function ensureProducto(params: {
  session: Exclude<Awaited<ReturnType<typeof getTenantSession>>, { error: NextResponse }>;
  sucursalId: string;
  producto: ProductoSeed;
}) {
  const { session, sucursalId, producto } = params;
  const { data: existente, error: findErr } = await session.supabase
    .from('producto')
    .select('id, codigo, nombre')
    .eq('tenant_id', session.tenantId)
    .eq('codigo', producto.codigo)
    .eq('activo', true)
    .limit(1)
    .maybeSingle();

  if (findErr) throw new Error(findErr.message);
  if (existente) {
    if (producto.esPadre) {
      await session.supabase
        .from('producto')
        .update({ es_despiece_padre: true } as Database['public']['Tables']['producto']['Update'])
        .eq('id', existente.id)
        .eq('tenant_id', session.tenantId);
    }
    return existente.id;
  }

  const nombreProducto = producto.nombre.trim();
  const { data: existentePorNombre, error: findNombreErr } = await session.supabase
    .from('producto')
    .select('id, codigo, nombre')
    .eq('tenant_id', session.tenantId)
    .ilike('nombre', nombreProducto)
    .eq('activo', true)
    .limit(1)
    .maybeSingle();

  if (findNombreErr) throw new Error(findNombreErr.message);
  if (existentePorNombre) {
    if (producto.esPadre) {
      await session.supabase
        .from('producto')
        .update({ es_despiece_padre: true } as Database['public']['Tables']['producto']['Update'])
        .eq('id', existentePorNombre.id)
        .eq('tenant_id', session.tenantId);
    }
    return existentePorNombre.id;
  }

  const insert: Database['public']['Tables']['producto']['Insert'] = {
    tenant_id: session.tenantId,
    sucursal_id: sucursalId,
    codigo: producto.codigo,
    nombre: producto.nombre,
    descripcion: 'Creado por plantilla predeterminada de despiece',
    unidad: 'kg',
    precio_costo: producto.precioCosto,
    precio_venta: producto.precioVenta ?? producto.precioCosto,
    stock_actual: 0,
    stock_minimo: 0,
    moneda: '$',
    es_pesable: true,
    es_despiece_padre: producto.esPadre === true,
    iva_porcentaje: IVA_DESPIECE,
  };

  const { data, error } = await session.supabase.from('producto').insert(insert).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function POST(request: Request) {
  const guard = await moduloGuardDespieceConNegocio();
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = await rejectUnlessDespieceEditar(session.supabase, session);
  if (forbidden) return forbidden;

  const sucursalScope = await resolveAndValidateSucursalScope(session, null);
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const slug = typeof b.slug === 'string' ? b.slug : 'todas';
  const slugNormalizado = slug === 'pollo-reyes' ? 'cajon-pollo-7' : slug;
  const plantillas =
    slugNormalizado === 'todas'
      ? PLANTILLAS_DESPIECE_PREDETERMINADAS
      : PLANTILLAS_DESPIECE_PREDETERMINADAS.filter((p) => p.slug === slugNormalizado);

  if (plantillas.length === 0) {
    return NextResponse.json({ error: 'Plantilla predeterminada no encontrada.' }, { status: 404 });
  }

  try {
    const creadas: Array<{ id: string; nombre: string; existente: boolean }> = [];

    for (const pred of plantillas) {
      const padreId = await ensureProducto({
        session,
        sucursalId: sucursalScope.sucursalId,
        producto: {
          codigo: pred.padre.codigo,
          nombre: pred.padre.nombre,
          precioCosto: pred.padre.costoKg,
          precioVenta: pred.padre.costoKg,
          esPadre: true,
        },
      });

      const corteIds: string[] = [];
      for (const corte of pred.cortes) {
        const id = await ensureProducto({
          session,
          sucursalId: sucursalScope.sucursalId,
          producto: {
            codigo: corte.codigo,
            nombre: corte.nombre,
            precioCosto: pred.padre.costoKg,
            precioVenta: corte.precioAnclado ?? pred.padre.costoKg,
          },
        });
        corteIds.push(id);
      }

      const { data: existente, error: existeErr } = await session.supabase
        .from('despiece_plantilla')
        .select('id')
        .eq('tenant_id', session.tenantId)
        .eq('producto_padre_id', padreId)
        .eq('nombre', pred.nombre)
        .maybeSingle();
      if (existeErr) throw new Error(existeErr.message);

      if (existente) {
        await forzarIvaDespiece(
          session.supabase,
          session.tenantId,
          [padreId, ...corteIds],
        );
        creadas.push({ id: existente.id, nombre: pred.nombre, existente: true });
        continue;
      }

      const { data: plantilla, error: plantillaErr } = await session.supabase
        .from('despiece_plantilla')
        .insert({
          tenant_id: session.tenantId,
          nombre: pred.nombre,
          producto_padre_id: padreId,
          peso_total_kg: pred.padre.pesoTotalKg,
          unidad_base_tipo: pred.unidadBase?.tipo ?? 'kg',
          unidad_base_nombre: pred.unidadBase?.nombre ?? null,
          unidad_base_cantidad: pred.unidadBase?.cantidad ?? 1,
          unidad_contenedor_nombre: pred.unidadBase?.contenedorNombre ?? null,
          unidad_contenedor_cantidad: pred.unidadBase?.unidadesPorContenedor ?? null,
          rentabilidad_objetivo_pct: pred.rentabilidadObjetivoPct,
          activo: true,
          notas: 'Plantilla predeterminada creada desde Carnicerias.xlsx',
        })
        .select('id')
        .single();
      if (plantillaErr) throw new Error(plantillaErr.message);

      const { error: cortesErr } = await session.supabase.from('despiece_corte').insert(
        pred.cortes.map((corte, index) => ({
          tenant_id: session.tenantId,
          plantilla_id: plantilla.id,
          producto_hijo_id: corteIds[index],
          kg_rendimiento: corte.kgRendimiento,
          factor_ajuste_pct: corte.factorAjustePct,
          precio_anclado: corte.precioAnclado,
          nombre_en_plantilla: corte.nombre,
          plu_sugerido: null,
          orden: index,
        })),
      );
      if (cortesErr) throw new Error(cortesErr.message);

      await forzarIvaDespiece(
        session.supabase,
        session.tenantId,
        [padreId, ...corteIds],
      );

      creadas.push({ id: plantilla.id, nombre: pred.nombre, existente: false });
    }

    return NextResponse.json({ plantillas: creadas });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudieron cargar las plantillas.' },
      { status: 500 },
    );
  }
}
