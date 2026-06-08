import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import { fetchPedidosWorkflowEstadoIdsParaUsuario } from '@/lib/pedidos/workflow-visibilidad';
import { moduloGuardAny } from '@/lib/modulos/guard';

type ComprobanteRow = {
  id: string;
  tipo: string;
  numero: number;
  fecha: string;
  created_at: string;
  estado: string;
  total: number;
};

type PedidoRow = {
  id: string;
  estado: string;
  fecha: string;
  created_at: string;
  total: number;
};

type DocumentoOrden = {
  id: string;
  tipo: string;
  numero: number | null;
  numero_formateado: string;
  fecha: string;
  estado: string;
  total: number;
  url_detalle: string;
};

function urlDetalle(tipo: 'pedido' | string, id: string): string {
  if (tipo === 'pedido') return `/pedidos/${id}`;
  if (tipo === 'presupuesto') return `/presupuestos/${id}`;
  return `/facturacion/${id}`;
}

const PREFIJO_TIPO: Record<string, string> = {
  factura_a: 'FA',
  factura_b: 'FB',
  factura_c: 'FC',
  nota_credito_a: 'NCA',
  nota_credito_b: 'NCB',
  nota_credito_c: 'NCC',
  ticket: 'T',
  presupuesto: 'P',
  remito: 'R',
  devolucion_remito: 'DR',
  recibo: 'RC',
};

function numeroFormateadoDocumento(row: {
  tipo: 'pedido' | string;
  numero?: number | null;
  id: string;
}): string {
  if (row.tipo === 'pedido') {
    return `PED-${row.id.slice(0, 8).toUpperCase()}`;
  }
  if (row.numero != null) {
    const pref = PREFIJO_TIPO[row.tipo] ?? '';
    return pref ? `${pref}-${String(row.numero).padStart(8, '0')}` : String(row.numero).padStart(8, '0');
  }
  return row.id.slice(0, 8).toUpperCase();
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ numero_orden: string }> },
) {
  const guard = await moduloGuardAny(['facturador_simple', 'pedidos', 'presupuestos']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { numero_orden: numeroOrdenRaw } = await params;
  const numeroOrden = Number(numeroOrdenRaw);
  if (!Number.isInteger(numeroOrden) || numeroOrden <= 0) {
    return NextResponse.json({ error: 'numero_orden inválido' }, { status: 400 });
  }

  const vis = await fetchPedidosWorkflowEstadoIdsParaUsuario(session);
  if (!vis.ok) {
    return NextResponse.json({ error: vis.errorMessage }, { status: 500 });
  }
  const filterWorkflowIds =
    vis.filterIds != null && vis.filterIds.length > 0 ? vis.filterIds : null;

  let pedidoQuery = session.supabase
    .from('pedido')
    .select('id, estado, fecha, created_at, total')
    .eq('tenant_id', session.tenantId)
    .eq('numero_orden', numeroOrden)
    .order('created_at', { ascending: true });

  if (filterWorkflowIds) {
    pedidoQuery = pedidoQuery.in('workflow_estado_id', filterWorkflowIds);
  }

  const [{ data: comps, error: compErr }, { data: peds, error: pedErr }] = await Promise.all([
    session.supabase
      .from('comprobante')
      .select('id, tipo, numero, fecha, created_at, estado, total')
      .eq('tenant_id', session.tenantId)
      .eq('numero_orden', numeroOrden)
      .order('created_at', { ascending: true }),
    pedidoQuery,
  ]);

  if (compErr) {
    return NextResponse.json({ error: compErr.message }, { status: 500 });
  }
  if (pedErr) {
    return NextResponse.json({ error: pedErr.message }, { status: 500 });
  }

  const docsComp: DocumentoOrden[] = ((comps ?? []) as ComprobanteRow[]).map((c) => ({
    id: c.id,
    tipo: c.tipo,
    numero: c.numero ?? null,
    numero_formateado: numeroFormateadoDocumento({
      tipo: c.tipo,
      numero: c.numero,
      id: c.id,
    }),
    fecha: c.fecha,
    estado: c.estado,
    total: Number(c.total ?? 0),
    url_detalle: urlDetalle(c.tipo, c.id),
  }));

  const docsPed: DocumentoOrden[] = ((peds ?? []) as PedidoRow[]).map((p) => ({
    id: p.id,
    tipo: 'pedido',
    numero: null,
    numero_formateado: numeroFormateadoDocumento({ tipo: 'pedido', id: p.id }),
    fecha: p.fecha,
    estado: p.estado,
    total: Number(p.total ?? 0),
    url_detalle: urlDetalle('pedido', p.id),
  }));

  const documentosConOrden = [
    ...((comps ?? []) as ComprobanteRow[]).map((c, i) => ({
      created_at: c.created_at,
      doc: docsComp[i]!,
    })),
    ...((peds ?? []) as PedidoRow[]).map((p, i) => ({
      created_at: p.created_at,
      doc: docsPed[i]!,
    })),
  ]
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    .map((x) => x.doc);

  return NextResponse.json({
    numero_orden: numeroOrden,
    documentos: documentosConOrden,
  });
}
