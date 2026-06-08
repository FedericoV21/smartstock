import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { emitirComprobante, type EmitirComprobanteBody } from '@/lib/facturacion/emitir-comprobante';
import { registrarIntentoEmisionFallido } from '@/lib/facturacion/emision-intento-error';
import { moduloGuard } from '@/lib/modulos/guard';
import { UUID_RE, parseFechaYmd, parseObject, strOrNull } from '@/lib/turnos/api';
import { ensureAgendaServiceProduct } from '@/lib/turnos/service-product';

const METODOS_PAGO = new Set([
  'efectivo',
  'debito',
  'credito',
  'transferencia',
  'cuenta_corriente',
]);

function normalizarMetodoPago(value: unknown): EmitirComprobanteBody['metodo_pago'] {
  const raw = String(value ?? 'efectivo').trim();
  return (METODOS_PAGO.has(raw) ? raw : 'efectivo') as EmitirComprobanteBody['metodo_pago'];
}

function normalizarTipo(value: unknown): string {
  const raw = String(value ?? 'factura').trim();
  return ['factura', 'factura_a', 'factura_b', 'factura_c'].includes(raw) ? raw : 'factura';
}

function esDestinoPos(value: unknown): boolean {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === 'pos' || raw === 'facturacion_pos';
}

async function parseJson(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    return parseObject(await request.json());
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const turnosGuard = await moduloGuard('turnos');
  if (!turnosGuard.allowed) return turnosGuard.response;

  const parsed = await parseJson(request);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;
  const destinoPos = esDestinoPos(body.destino);

  const facturadorGuard = await moduloGuard(destinoPos ? 'facturador_pos' : 'facturador_simple');
  if (!facturadorGuard.allowed) return facturadorGuard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  const scope = await resolveAndValidateSucursalScope(session, null);
  if (!scope.ok) return scope.response;
  if (!scope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Reserva invalida' }, { status: 400 });

  const fechaVencimiento = body.fecha_vencimiento_pago == null || body.fecha_vencimiento_pago === ''
    ? null
    : parseFechaYmd(body.fecha_vencimiento_pago);
  if (body.fecha_vencimiento_pago && !fechaVencimiento) {
    return NextResponse.json({ error: 'fecha_vencimiento_pago debe ser YYYY-MM-DD' }, { status: 400 });
  }

  const db = session.supabase as any;
  const { data: reserva, error: reservaErr } = await db
    .from('turno_reserva')
    .select('*, agenda:turno_agenda(*)')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .maybeSingle();
  if (reservaErr) return NextResponse.json({ error: reservaErr.message }, { status: 500 });
  if (!reserva) return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 });
  if (reserva.estado === 'cobrado') {
    return NextResponse.json({ error: 'La reserva ya esta cobrada' }, { status: 409 });
  }
  if (reserva.estado !== 'reservado') {
    return NextResponse.json({ error: 'La reserva no esta disponible para cobrar' }, { status: 409 });
  }

  const agenda = reserva.agenda;
  if (!agenda) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 });

  let productoId = agenda.producto_id as string | null;
  if (!productoId) {
    const { data: tenant } = await db
      .from('tenant')
      .select('iva_porcentaje_default')
      .eq('id', session.tenantId)
      .maybeSingle();
    const product = await ensureAgendaServiceProduct(db, {
      tenantId: session.tenantId,
      sucursalId: scope.sucursalId,
      agendaId: agenda.id,
      nombre: agenda.nombre,
      precio: Number(agenda.precio ?? reserva.precio_snapshot ?? 0),
      ivaPorcentaje: tenant?.iva_porcentaje_default ?? 21,
    });
    if (!product.ok) return NextResponse.json({ error: product.error }, { status: 400 });
    productoId = product.productoId;
    await db
      .from('turno_agenda')
      .update({ producto_id: productoId })
      .eq('id', agenda.id)
      .eq('tenant_id', session.tenantId);
  }

  const precio = Math.round(Number(reserva.precio_snapshot ?? agenda.precio ?? 0) * 100) / 100;
  const senaMonto = Math.min(
    precio,
    Math.max(0, Math.round(Number(reserva.sena_monto ?? 0) * 100) / 100),
  );

  if (destinoPos) {
    const { data: producto, error: productoErr } = await db
      .from('producto')
      .select('id,codigo,codigo_barras,nombre,precio_venta,stock_actual,iva_porcentaje,unidad,es_servicio')
      .eq('id', productoId)
      .eq('tenant_id', session.tenantId)
      .maybeSingle();
    if (productoErr) return NextResponse.json({ error: productoErr.message }, { status: 500 });
    if (!producto) return NextResponse.json({ error: 'Producto de servicio no encontrado' }, { status: 404 });

    const horaInicio = String(reserva.hora_inicio ?? '').slice(0, 5);
    return NextResponse.json({
      pos_payload: {
        turnoReservaId: reserva.id,
        turnoLabel: `${agenda.nombre} - ${reserva.fecha} ${horaInicio}`,
        clienteId: reserva.cliente_id ?? '',
        senaMonto,
        items: [
          {
            producto: {
              id: producto.id,
              codigo: producto.codigo ?? `TURNO-${String(agenda.id).slice(0, 8).toUpperCase()}`,
              codigo_barras: producto.codigo_barras ?? null,
              nombre: producto.nombre ?? `Turno - ${agenda.nombre}`,
              precio_venta: precio,
              stock_actual: 999999,
              iva_porcentaje: producto.iva_porcentaje ?? null,
              unidad: producto.unidad ?? 'unidad',
              es_servicio: true,
            },
            cantidad: 1,
          },
        ],
      },
    });
  }

  const reservaLock = await db
    .from('turno_reserva')
    .update({ estado: 'cobrando' })
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId)
    .eq('estado', 'reservado')
    .select('id')
    .maybeSingle();
  if (reservaLock.error) return NextResponse.json({ error: reservaLock.error.message }, { status: 400 });
  if (!reservaLock.data) {
    return NextResponse.json({ error: 'La reserva ya fue tomada por otro cobro' }, { status: 409 });
  }

  const notasExtra = strOrNull(body.notas, 500);
  const notas = [
    `Turno: ${agenda.nombre}`,
    `Reserva: ${reserva.fecha} ${String(reserva.hora_inicio).slice(0, 5)}`,
    senaMonto > 0 ? `Seña descontada: ${senaMonto.toFixed(2)}` : null,
    notasExtra,
  ].filter(Boolean).join(' | ');

  const emitirBody: EmitirComprobanteBody = {
    tipo: normalizarTipo(body.tipo),
    sucursal_id: scope.sucursalId,
    cliente_id: reserva.cliente_id ?? null,
    items: [
      {
        producto_id: productoId,
        cantidad: 1,
        precio_unitario: precio,
      },
    ],
    notas,
    metodo_pago: normalizarMetodoPago(body.metodo_pago),
    medio_pago_opcion_id: UUID_RE.test(String(body.medio_pago_opcion_id ?? ''))
      ? String(body.medio_pago_opcion_id)
      : null,
    fecha_vencimiento_pago: fechaVencimiento,
    descuento_global_monto: senaMonto > 0 ? senaMonto : undefined,
  };

  const result = await emitirComprobante(
    session.supabase,
    {
      tenantId: session.tenantId,
      userId: session.userId,
      rol: session.rol,
      isSuperAdmin: session.isSuperAdmin,
    },
    emitirBody,
    { clienteSinRestriccionSucursal: true },
  );

  if (!result.ok) {
    await db
      .from('turno_reserva')
      .update({ estado: 'reservado' })
      .eq('id', id)
      .eq('tenant_id', session.tenantId)
      .eq('estado', 'cobrando');
    await registrarIntentoEmisionFallido({
      supabase: session.supabase,
      tenantId: session.tenantId,
      userId: session.userId,
      sucursalId: scope.sucursalId,
      body: emitirBody,
      status: result.status,
      error: result.error,
    });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data: reservaCobrada, error: updateErr } = await db
    .from('turno_reserva')
    .update({
      estado: 'cobrado',
      comprobante_id: result.data.comprobante.id,
    })
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .select('*')
    .single();
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json(
    {
      reserva: reservaCobrada,
      comprobante: result.data.comprobante,
      importes: result.data.importes,
      qr_url: result.data.qr_url,
    },
    { status: 201 },
  );
}
