import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import {
  esNotaCredito,
  tipoIncluido,
} from '@/lib/caja/cierre-z-calculo';
import { aplanarRepresentativosVentaPorOrden } from '@/lib/facturacion/ventas-representativas-por-orden';
import { fechaYmdArgentina } from '@/lib/utils/formatters';

type MedioRow = {
  metodo_pago: string;
  monto_neto: number;
  cantidad_comprobantes: number;
};

type DbError = { message: string };
type QueryListResult<T> = { data: T[] | null; error: DbError | null };
type QuerySingleResult<T> = { data: T | null; error: DbError | null };

type QueryBuilder<T> = PromiseLike<QueryListResult<T>> & {
  select(columns: string): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  gte(column: string, value: unknown): QueryBuilder<T>;
  lte(column: string, value: unknown): QueryBuilder<T>;
  is(column: string, value: unknown): QueryBuilder<T>;
  order(column: string, opts?: { ascending?: boolean }): QueryBuilder<T>;
  maybeSingle(): Promise<QuerySingleResult<T>>;
};

type CierreZRow = {
  id: string;
  caja_id: string;
  fecha_operativa: string;
  tipo_cierre: string;
  rango_desde: string;
  rango_hasta: string;
  total_comprobantes: number;
  ventas_brutas: number;
  notas_credito_total: number;
  ventas_netas: number;
  pagos_cta_cte_total: number;
  created_at: string;
  payload_resumen: Record<string, unknown> | null;
};

type ClienteJoin = { nombre?: string | null; razon_social?: string | null } | null;
type UsuarioJoin = { nombre?: string | null; apellido?: string | null } | null;

type ComprobanteCierreDetalleRow = {
  id: string;
  tipo: string;
  numero: number | null;
  numero_caja: number | null;
  numero_orden: number | null;
  fecha: string;
  created_at: string;
  total: number;
  metodo_pago: string | null;
  metodo_pago_detalle: Record<string, unknown> | null;
  caja_id: string | null;
  cliente: ClienteJoin;
  usuario: UsuarioJoin;
};

type SupabaseCajaResumenClient = {
  from(table: 'cierre_z'): QueryBuilder<CierreZRow>;
  from(table: 'cierre_z_medio_pago'): QueryBuilder<MedioRow>;
  from(table: 'comprobante'): QueryBuilder<ComprobanteCierreDetalleRow>;
};

function numeroVisible(row: ComprobanteCierreDetalleRow): string {
  if (row.tipo === 'ticket' && row.numero_caja != null && Number.isFinite(Number(row.numero_caja))) {
    return String(Number(row.numero_caja)).padStart(8, '0');
  }
  if (row.numero != null && Number.isFinite(Number(row.numero))) {
    return String(Number(row.numero)).padStart(8, '0');
  }
  if (row.numero_orden != null && Number.isFinite(Number(row.numero_orden))) {
    return `Orden #${Number(row.numero_orden)}`;
  }
  return row.id.slice(0, 8).toUpperCase();
}

function nombreCliente(cliente: ClienteJoin): string {
  const razon = typeof cliente?.razon_social === 'string' ? cliente.razon_social.trim() : '';
  const nombre = typeof cliente?.nombre === 'string' ? cliente.nombre.trim() : '';
  return razon || nombre || 'Consumidor final';
}

function nombreUsuario(usuario: UsuarioJoin): string | null {
  const nombre = typeof usuario?.nombre === 'string' ? usuario.nombre.trim() : '';
  const apellido = typeof usuario?.apellido === 'string' ? usuario.apellido.trim() : '';
  const full = `${nombre} ${apellido}`.trim();
  return full || null;
}

function rangoFechasArgentina(desdeIso: string, hastaIso: string): { desde: string; hasta: string } {
  const desdeDate = new Date(desdeIso);
  const hastaDate = new Date(hastaIso);
  const desde = Number.isFinite(desdeDate.getTime()) ? fechaYmdArgentina(desdeDate) : '';
  const hasta = Number.isFinite(hastaDate.getTime()) ? fechaYmdArgentina(hastaDate) : desde;
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const sp = new URL(request.url).searchParams;
  const sucursalScope = await resolveAndValidateSucursalScope(session, sp.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const { id } = await params;
  const cierreId = String(id || '').trim();
  if (!cierreId) {
    return NextResponse.json({ error: 'cierre_id requerido' }, { status: 400 });
  }

  const sb = session.supabase as unknown as SupabaseCajaResumenClient;
  const { data: cierre, error: cierreErr } = await sb
    .from('cierre_z')
    .select('*')
    .eq('id', cierreId)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', sucursalScope.sucursalId)
    .maybeSingle();

  if (cierreErr) return NextResponse.json({ error: cierreErr.message }, { status: 500 });
  if (!cierre) return NextResponse.json({ error: 'Cierre no encontrado.' }, { status: 404 });

  const [{ data: mediosRows, error: mediosErr }] = await Promise.all([
    sb
      .from('cierre_z_medio_pago')
      .select('metodo_pago, monto_neto, cantidad_comprobantes')
      .eq('tenant_id', session.tenantId)
      .eq('cierre_z_id', cierreId),
  ]);
  if (mediosErr) return NextResponse.json({ error: mediosErr.message }, { status: 500 });

  const fechas = rangoFechasArgentina(String(cierre.rango_desde), String(cierre.rango_hasta));
  let comprobantesQuery = sb
    .from('comprobante')
    .select(
      'id, tipo, numero, numero_caja, numero_orden, fecha, created_at, total, metodo_pago, metodo_pago_detalle, caja_id, cliente:cliente_id(nombre, razon_social), usuario:usuario_id(nombre, apellido)',
    )
    .eq('tenant_id', session.tenantId)
    .eq('estado', 'emitido')
    .eq('sucursal_id', sucursalScope.sucursalId)
    .gte('created_at', cierre.rango_desde)
    .lte('created_at', cierre.rango_hasta);

  if (fechas.desde) {
    comprobantesQuery = comprobantesQuery.gte('fecha', fechas.desde).lte('fecha', fechas.hasta);
  }
  if (String(cierre.caja_id) === '__sin_caja__') {
    comprobantesQuery = comprobantesQuery.is('caja_id', null);
  } else {
    comprobantesQuery = comprobantesQuery.eq('caja_id', String(cierre.caja_id));
  }

  const { data: comprobantesRows, error: compErr } = await comprobantesQuery.order('created_at', {
    ascending: true,
  });
  if (compErr) return NextResponse.json({ error: compErr.message }, { status: 500 });

  const representativos = aplanarRepresentativosVentaPorOrden(
    ((comprobantesRows ?? []) as ComprobanteCierreDetalleRow[]).filter((row) => tipoIncluido(row.tipo)),
  );

  const ordenes = representativos.map((row) => {
    const total = Number(row.total ?? 0);
    return {
      id: row.id,
      numero_orden: row.numero_orden,
      tipo: row.tipo,
      numero: row.numero,
      numero_caja: row.numero_caja,
      numero_visible: numeroVisible(row),
      fecha: row.fecha,
      created_at: row.created_at,
      cliente: nombreCliente(row.cliente),
      usuario: nombreUsuario(row.usuario),
      metodo_pago: row.metodo_pago,
      total: esNotaCredito(row.tipo) ? -Math.abs(total) : total,
      url_detalle: `/facturacion/${row.id}`,
    };
  });

  return NextResponse.json({
    cierre: {
      id: cierre.id,
      caja_id: cierre.caja_id,
      fecha_operativa: cierre.fecha_operativa,
      tipo_cierre: cierre.tipo_cierre,
      rango_desde: cierre.rango_desde,
      rango_hasta: cierre.rango_hasta,
      total_comprobantes: Number(cierre.total_comprobantes ?? 0),
      ventas_brutas: Number(cierre.ventas_brutas ?? 0),
      notas_credito_total: Number(cierre.notas_credito_total ?? 0),
      ventas_netas: Number(cierre.ventas_netas ?? 0),
      pagos_cta_cte_total: Number(cierre.pagos_cta_cte_total ?? 0),
      created_at: cierre.created_at,
      payload_resumen: cierre.payload_resumen ?? null,
    },
    medios: ((mediosRows ?? []) as MedioRow[]).map((m) => ({
      metodo_pago: String(m.metodo_pago),
      monto_neto: Number(m.monto_neto ?? 0),
      cantidad_comprobantes: Number(m.cantidad_comprobantes ?? 0),
    })),
    ordenes,
  });
}
