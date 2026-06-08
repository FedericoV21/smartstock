import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor, type TenantSession } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

async function assertPuedeOperarSucursal(
  session: Exclude<TenantSession, { error: NextResponse }>,
  sucursalId: string
): Promise<NextResponse | null> {
  const db = session.supabase;
  if (session.isSuperAdmin || session.rol === 'admin') {
    const { data, error } = await db
      .from('sucursal')
      .select('id')
      .eq('id', sucursalId)
      .eq('tenant_id', session.tenantId)
      .eq('activa', true)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Sucursal no encontrada o inactiva.' }, { status: 404 });
    return null;
  }
  const { data: allowed, error } = await db.rpc('usuario_puede_operar_sucursal', {
    p_sucursal_id: sucursalId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!allowed) {
    return NextResponse.json(
      { error: 'No tenés permisos para operar en una de las sucursales involucradas.' },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Tamaño de tanda hacia el RPC. Pocas filas por sentencia evita `statement_timeout`
 * (cada producto hace varias consultas en PL/pgSQL).
 */
const CHUNK_RPC = 40;
/** Máx. IDs por request HTTP: el cliente envía varias peticiones en serie con progreso. */
const MAX_PRODUCTO_IDS_POR_REQUEST = 300;

/**
 * Clona productos (ficha, precios, etc.) a otra sucursal; stock siempre 0. Idempotente por código+unidad.
 */
export async function POST(request: Request) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const noVisor = rejectIfVisor(session.rol);
  if (noVisor) return noVisor;

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
  const origen = typeof b.sucursal_origen_id === 'string' ? b.sucursal_origen_id.trim() : '';
  const destSingle = typeof b.sucursal_destino_id === 'string' ? b.sucursal_destino_id.trim() : '';
  const destsRaw = b.sucursal_destino_ids;
  const destIds: string[] = (() => {
    const fromArray = Array.isArray(destsRaw)
      ? destsRaw
          .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          .map((x) => x.trim())
      : [];
    if (fromArray.length > 0) {
      return [...new Set(fromArray)];
    }
    if (destSingle) {
      return [destSingle];
    }
    return [];
  })();

  const idsRaw = b.producto_ids;
  if (!origen || destIds.length === 0) {
    return NextResponse.json(
      {
        error:
          'sucursal_origen_id y al menos un destino (sucursal_destino_id o sucursal_destino_ids) son obligatorios.',
      },
      { status: 400 },
    );
  }
  if (destIds.some((d) => d === origen)) {
    return NextResponse.json({ error: 'Origen y destino deben ser distintos.' }, { status: 400 });
  }

  const productoIds = Array.isArray(idsRaw)
    ? idsRaw.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
    : [];
  if (productoIds.length === 0) {
    return NextResponse.json({ error: 'Indicá al menos un producto_id en producto_ids.' }, { status: 400 });
  }
  if (productoIds.length > MAX_PRODUCTO_IDS_POR_REQUEST) {
    return NextResponse.json(
      {
        error: `Máximo ${MAX_PRODUCTO_IDS_POR_REQUEST} productos por petición. El listado reintenta en lotes automáticos.`,
        code: 'BATCH_TOO_LARGE' as const,
        max: MAX_PRODUCTO_IDS_POR_REQUEST,
      },
      { status: 400 },
    );
  }

  for (const sid of [origen, ...destIds]) {
    const ax = await assertPuedeOperarSucursal(session, sid);
    if (ax) return ax;
  }

  type R = {
    total_creados?: number;
    creados?: unknown;
    omitidos?: unknown;
  };
  const mergeR = (parts: R[]): R => {
    let t = 0;
    const c: unknown[] = [];
    const o: unknown[] = [];
    for (const p of parts) {
      t += p.total_creados ?? 0;
      if (Array.isArray(p.creados)) c.push(...p.creados);
      if (Array.isArray(p.omitidos)) o.push(...p.omitidos);
    }
    return { total_creados: t, creados: c, omitidos: o };
  };
  const runBatches = async (dest: string) => {
    const chunks: string[][] = [];
    for (let i = 0; i < productoIds.length; i += CHUNK_RPC) {
      chunks.push(productoIds.slice(i, i + CHUNK_RPC));
    }
    const parts: R[] = [];
    for (const chunk of chunks) {
      const { data, error } = await session.supabase.rpc('clonar_productos_a_sucursal', {
        p_tenant_id: session.tenantId,
        p_sucursal_origen_id: origen,
        p_sucursal_destino_id: dest,
        p_producto_ids: chunk,
      });
      if (error) {
        return { err: error.message, dest, parts: null as R[] | null };
      }
      const row = (data as R) ?? {};
      parts.push(row);
    }
    return { err: null, dest, parts };
  };

  if (destIds.length === 1) {
    const one = await runBatches(destIds[0]!);
    if (one.err) {
      return NextResponse.json({ error: one.err }, { status: 400 });
    }
    return NextResponse.json(mergeR(one.parts ?? []), { status: 201 });
  }

  const resultados: { sucursal_destino_id: string; total_creados?: number; creados?: unknown; omitidos?: unknown; error?: string }[] = [];
  for (const d of destIds) {
    const r = await runBatches(d);
    if (r.err) {
      resultados.push({ sucursal_destino_id: d, error: r.err });
    } else {
      resultados.push({ sucursal_destino_id: d, ...mergeR(r.parts ?? []) });
    }
  }

  const conError = resultados.find((r) => r.error);
  if (conError) {
    return NextResponse.json({ error: conError.error, resultados }, { status: 400 });
  }

  return NextResponse.json({ resultados }, { status: 201 });
}
