import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { emitirComprobante } from '@/lib/facturacion/emitir-comprobante';
import {
  asegurarNumeroOrdenOrigen,
  validarOrdenSinFacturaFiscal,
  validarOrdenSinTicketEmitido,
} from '@/lib/facturacion/numero-orden';
import { PRESUPUESTOS_ACCESO_BLOQUEADO } from '@/lib/features/presupuestos-acceso';
import { moduloGuard } from '@/lib/modulos/guard';

type MetodoPagoTicket = 'efectivo' | 'debito' | 'credito' | 'transferencia' | 'cuenta_corriente';

const METODOS: MetodoPagoTicket[] = [
  'efectivo',
  'debito',
  'credito',
  'transferencia',
  'cuenta_corriente',
];

function parseMetodoPago(raw: unknown): MetodoPagoTicket {
  if (typeof raw === 'string' && (METODOS as string[]).includes(raw)) {
    return raw as MetodoPagoTicket;
  }
  return 'efectivo';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (PRESUPUESTOS_ACCESO_BLOQUEADO) {
    return NextResponse.json({ error: 'Presupuestos no disponible por el momento.' }, { status: 403 });
  }
  const presGuard = await moduloGuard('presupuestos');
  if (!presGuard.allowed) return presGuard.response;

  const posGuard = await moduloGuard('facturador_pos');
  if (!posGuard.allowed) return posGuard.response;

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

  const bodyObj = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
  const metodoPago = parseMetodoPago(bodyObj?.metodo_pago);
  const sucursalRaw = bodyObj?.sucursal_id;
  const sucursalScope = await resolveAndValidateSucursalScope(
    session,
    typeof sucursalRaw === 'string' ? sucursalRaw : null,
  );
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }
  const sucursalId = sucursalScope.sucursalId;
  const stockBloqueanteRaw = bodyObj?.stock_bloqueante;
  const stock_bloqueante =
    typeof stockBloqueanteRaw === 'boolean' ? stockBloqueanteRaw : undefined;

  const { data: presupuesto, error: presErr } = await session.supabase
    .from('comprobante')
    .select(
      'id, tipo, estado, numero, numero_orden, cliente_id, descuento_global_pct, recargo_global_pct, descuento_global_monto, recargo_global_monto, items:comprobante_item(producto_id, cantidad, precio_unitario, descuento_manual_pct, recargo_manual_pct)',
    )
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

  if (metodoPago === 'cuenta_corriente' && !presupuesto.cliente_id) {
    return NextResponse.json(
      { error: 'Cuenta corriente requiere un cliente en el presupuesto (no alcanza consumidor final sin cuenta).' },
      { status: 400 },
    );
  }

  const items =
    (
      presupuesto as {
        items: {
          producto_id: string;
          cantidad: number;
          precio_unitario: number;
          descuento_manual_pct?: number | null;
          recargo_manual_pct?: number | null;
        }[];
      }
    ).items ?? [];
  const pres = presupuesto as {
    descuento_global_pct?: number | null;
    recargo_global_pct?: number | null;
    descuento_global_monto?: number | null;
    recargo_global_monto?: number | null;
  };
  if (!items.length) {
    return NextResponse.json({ error: 'El presupuesto no tiene ítems' }, { status: 400 });
  }

  const presupuestoRow = presupuesto as { id: string; numero: number; numero_orden: number | null };
  const validacionFactura = await validarOrdenSinFacturaFiscal(session.supabase, {
    tenantId: session.tenantId,
    numeroOrden: presupuestoRow.numero_orden,
  });
  if (!validacionFactura.ok) {
    return NextResponse.json({ error: validacionFactura.error }, { status: validacionFactura.status });
  }

  const validacionTicket = await validarOrdenSinTicketEmitido(session.supabase, {
    tenantId: session.tenantId,
    numeroOrden: presupuestoRow.numero_orden,
  });
  if (!validacionTicket.ok) {
    return NextResponse.json({ error: validacionTicket.error }, { status: validacionTicket.status });
  }

  const ordenResult = await asegurarNumeroOrdenOrigen(session.supabase, {
    tenantId: session.tenantId,
    origen: 'comprobante',
    origenId: presupuestoRow.id,
    numeroOrdenActual: presupuestoRow.numero_orden,
  });
  if (!ordenResult.ok) {
    return NextResponse.json({ error: ordenResult.error }, { status: ordenResult.status });
  }

  const validacionTicketTrasOrden = await validarOrdenSinTicketEmitido(session.supabase, {
    tenantId: session.tenantId,
    numeroOrden: ordenResult.numeroOrden,
  });
  if (!validacionTicketTrasOrden.ok) {
    return NextResponse.json(
      { error: validacionTicketTrasOrden.error },
      { status: validacionTicketTrasOrden.status },
    );
  }

  const result = await emitirComprobante(
    session.supabase,
    { tenantId: session.tenantId, userId: session.userId },
    {
      tipo: 'ticket',
      sucursal_id: sucursalId,
      cliente_id: presupuesto.cliente_id,
      metodo_pago: metodoPago,
      items: items.map((i) => ({
        producto_id: i.producto_id,
        cantidad: i.cantidad,
        precio_unitario: i.precio_unitario,
        descuento_manual_pct: Number(i.descuento_manual_pct ?? 0),
        recargo_manual_pct: Number(i.recargo_manual_pct ?? 0),
      })),
      descuento_global_pct: Number(pres.descuento_global_pct ?? 0),
      recargo_global_pct: Number(pres.recargo_global_pct ?? 0),
      descuento_global_monto: Number(pres.descuento_global_monto ?? 0),
      recargo_global_monto: Number(pres.recargo_global_monto ?? 0),
      notas: `Venta en ticket (no fiscal) desde presupuesto #${presupuestoRow.numero}`,
      ...(stock_bloqueante !== undefined ? { stock_bloqueante } : {}),
    },
    {
      numeroOrdenExplicito: ordenResult.numeroOrden,
      ticketSinTurnoCaja: true,
      clienteSinRestriccionSucursal: true,
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      presupuesto_id: presupuesto.id,
      sucursal_id: sucursalId,
      comprobante_id: result.data.comprobante.id,
      pdf_url: result.data.comprobante.pdf_url,
      comprobante: result.data.comprobante,
    },
    { status: 201 },
  );
}
