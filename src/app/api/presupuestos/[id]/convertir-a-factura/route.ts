import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { emitirComprobante } from '@/lib/facturacion/emitir-comprobante';
import { PRESUPUESTOS_ACCESO_BLOQUEADO } from '@/lib/features/presupuestos-acceso';
import { moduloGuard } from '@/lib/modulos/guard';
import type { Database } from '@/types/database';

const TIPOS_FACTURA = new Set(['factura_a', 'factura_b', 'factura_c']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (PRESUPUESTOS_ACCESO_BLOQUEADO) {
    return NextResponse.json({ error: 'Presupuestos no disponible por el momento.' }, { status: 403 });
  }
  const guard = await moduloGuard('presupuestos');
  if (!guard.allowed) return guard.response;

  const facGuard = await moduloGuard('facturador_simple');
  if (!facGuard.allowed) return facGuard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const tipoRaw =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).tipo
      : undefined;
  const tipo =
    typeof tipoRaw === 'string' && TIPOS_FACTURA.has(tipoRaw)
      ? tipoRaw
      : ('factura_c' as Database['public']['Enums']['tipo_comprobante']);

  const { data: presupuesto, error: presErr } = await session.supabase
    .from('comprobante')
    .select('id, tipo, estado, numero, cliente_id, items:comprobante_item(producto_id, cantidad, precio_unitario)')
    .eq('id', id)
    .eq('tipo', 'presupuesto')
    .maybeSingle();

  if (presErr) {
    return NextResponse.json({ error: presErr.message }, { status: 500 });
  }
  if (!presupuesto) {
    return NextResponse.json({ error: 'Presupuesto no encontrado' }, { status: 404 });
  }

  if (presupuesto.estado === 'anulado') {
    return NextResponse.json({ error: 'El presupuesto está anulado' }, { status: 400 });
  }

  if (!presupuesto.cliente_id) {
    return NextResponse.json(
      { error: 'El presupuesto debe tener un cliente para facturar' },
      { status: 400 }
    );
  }

  const items = (presupuesto as { items: { producto_id: string; cantidad: number; precio_unitario: number }[] })
    .items ?? [];
  if (!items.length) {
    return NextResponse.json({ error: 'El presupuesto no tiene ítems' }, { status: 400 });
  }

  const result = await emitirComprobante(
    session.supabase,
    { tenantId: session.tenantId, userId: session.userId },
    {
      tipo,
      cliente_id: presupuesto.cliente_id,
      items: items.map((i) => ({
        producto_id: i.producto_id,
        cantidad: i.cantidad,
        precio_unitario: i.precio_unitario,
      })),
      notas: `Convertido desde presupuesto #${presupuesto.numero}`,
    }
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      presupuesto_id: presupuesto.id,
      comprobante_id: result.data.comprobante.id,
      pdf_url: result.data.comprobante.pdf_url,
      comprobante: result.data.comprobante,
    },
    { status: 201 }
  );
}
