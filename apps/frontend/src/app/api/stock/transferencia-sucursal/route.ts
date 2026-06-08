import { NextResponse, type NextRequest } from 'next/server';

import { rejectUnlessStockAjustar, rejectUnlessStockVer } from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuard } from '@/lib/modulos/guard';

function rpcErrorStatus(message: string): number {
  const lower = message.toLowerCase();
  if (lower.includes('insuficiente') || lower.includes('cantidad')) return 400;
  if (lower.includes('no encontrado') || lower.includes('no encontrada')) return 404;
  if (lower.includes('no esta pendiente') || lower.includes('no está pendiente')) return 409;
  if (lower.includes('no coinciden') || lower.includes('codigo de barras') || lower.includes('código de barras')) {
    return 400;
  }
  return 500;
}

/**
 * GET ?producto_id=&sucursal_origen_id=&sucursal_destino_id=
 * Indica si en destino existe la fila de stock. Tambien lista transferencias pendientes con:
 * GET ?estado=pendientes&sucursal_destino_id=
 */
export async function GET(request: NextRequest) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const permisoVer = await rejectUnlessStockVer(session.supabase, session);
  if (permisoVer) return permisoVer;

  const { searchParams } = new URL(request.url);
  const estado = (searchParams.get('estado') ?? '').trim().toLowerCase();

  if (estado === 'pendientes' || estado === 'pendiente') {
    const sucursalDestino = (searchParams.get('sucursal_destino_id') ?? '').trim();
    if (!sucursalDestino) {
      return NextResponse.json({ error: 'sucursal_destino_id es obligatorio.' }, { status: 400 });
    }

    const scope = await resolveAndValidateSucursalScope(session, sucursalDestino);
    if (!scope.ok) return scope.response;

    const { data, error } = await (session.supabase as any)
      .from('stock_transferencia_sucursal')
      .select(
        [
          'id',
          'cantidad',
          'motivo',
          'estado',
          'enviado_at',
          'deposito_destino_existia',
          'producto:producto_id(id, codigo, nombre, unidad)',
          'variante:producto_variante_id(id, codigo, codigo_barras, atributos, etiqueta)',
          'sucursal_origen:sucursal_origen_id(id, codigo, nombre)',
          'sucursal_destino:sucursal_destino_id(id, codigo, nombre)',
          'usuario_envio:usuario_envio_id(nombre, apellido)',
        ].join(', '),
      )
      .eq('tenant_id', session.tenantId)
      .eq('sucursal_destino_id', sucursalDestino)
      .eq('estado', 'pendiente')
      .order('enviado_at', { ascending: false })
      .limit(100);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      sucursal_destino_id: sucursalDestino,
      transferencias: data ?? [],
    });
  }

  const productoId = (searchParams.get('producto_id') ?? '').trim();
  const productoVarianteId = (searchParams.get('producto_variante_id') ?? '').trim() || null;
  const sucursalOrigen = (searchParams.get('sucursal_origen_id') ?? '').trim();
  const sucursalDestino = (searchParams.get('sucursal_destino_id') ?? '').trim();

  if (!productoId || !sucursalOrigen || !sucursalDestino) {
    return NextResponse.json(
      { error: 'producto_id, sucursal_origen_id y sucursal_destino_id son obligatorios.' },
      { status: 400 },
    );
  }

  if (sucursalOrigen === sucursalDestino) {
    return NextResponse.json(
      { error: 'Elegi una sucursal de destino distinta a la de origen.' },
      { status: 400 },
    );
  }

  const destinoScope = await resolveAndValidateSucursalScope(session, sucursalDestino);
  if (!destinoScope.ok) return destinoScope.response;

  const origenScope = await resolveAndValidateSucursalScope(session, sucursalOrigen);
  if (!origenScope.ok) return origenScope.response;

  const { data: producto, error: e0 } = await session.supabase
    .from('producto')
    .select('id, codigo, nombre, unidad, activo, usa_variantes')
    .eq('id', productoId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (e0) return NextResponse.json({ error: e0.message }, { status: 500 });
  if (!producto) {
    return NextResponse.json({ error: 'Producto no encontrado.' }, { status: 404 });
  }

  if ((producto as { usa_variantes?: boolean }).usa_variantes && !productoVarianteId) {
    return NextResponse.json(
      { error: 'Este producto usa variantes. Selecciona una variante para transferir stock.' },
      { status: 400 },
    );
  }

  const stockTable = productoVarianteId ? 'producto_variante_stock_sucursal' : 'stock_sucursal';
  let stockOrigenQuery = (session.supabase as any)
    .from(stockTable)
    .select('stock_actual')
    .eq('tenant_id', session.tenantId)
    .eq('producto_id', productoId)
    .eq('sucursal_id', sucursalOrigen);
  let stockDestinoQuery = (session.supabase as any)
    .from(stockTable)
    .select('id, stock_actual')
    .eq('tenant_id', session.tenantId)
    .eq('producto_id', productoId)
    .eq('sucursal_id', sucursalDestino);
  if (productoVarianteId) {
    stockOrigenQuery = stockOrigenQuery.eq('variante_id', productoVarianteId);
    stockDestinoQuery = stockDestinoQuery.eq('variante_id', productoVarianteId);
  }

  const { data: stockOrigen, error: e1 } = await stockOrigenQuery.maybeSingle();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  const { data: stockDestino, error: e2 } = await stockDestinoQuery.maybeSingle();
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    estado: stockDestino ? 'listo' : 'creara_deposito',
    producto: { id: producto.id, nombre: producto.nombre, codigo: producto.codigo, activo: producto.activo },
    stock_origen: { sucursal_id: sucursalOrigen, stock_actual: stockOrigen?.stock_actual ?? 0 },
    stock_destino: { sucursal_id: sucursalDestino, stock_actual: stockDestino?.stock_actual ?? 0 },
    mensaje: stockDestino
      ? undefined
      : 'En destino aun no existe el deposito para este producto. Se creara automaticamente al aceptar la recepcion.',
  });
}

export async function POST(request: Request) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const denied = rejectIfVisor(session.rol);
  if (denied) return denied;

  const permisoAjustar = await rejectUnlessStockAjustar(session.supabase, session);
  if (permisoAjustar) return permisoAjustar;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const productoId = typeof b.producto_id === 'string' ? b.producto_id.trim() : '';
  const productoVarianteId =
    typeof b.producto_variante_id === 'string' && b.producto_variante_id.trim()
      ? b.producto_variante_id.trim()
      : null;
  const sucursalOrigen = typeof b.sucursal_origen_id === 'string' ? b.sucursal_origen_id.trim() : '';
  const sucursalDestino = typeof b.sucursal_destino_id === 'string' ? b.sucursal_destino_id.trim() : '';
  const cantidad = Number(b.cantidad);
  const motivo = b.motivo != null ? String(b.motivo) : null;

  if (!productoId || !sucursalOrigen || !sucursalDestino) {
    return NextResponse.json(
      { error: 'producto_id, sucursal_origen_id y sucursal_destino_id son obligatorios.' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(cantidad) || cantidad <= 0) {
    return NextResponse.json({ error: 'La cantidad debe ser mayor a cero.' }, { status: 400 });
  }

  if (sucursalOrigen === sucursalDestino) {
    return NextResponse.json(
      { error: 'La sucursal de destino no puede ser la de origen.' },
      { status: 400 },
    );
  }

  for (const sid of [sucursalOrigen, sucursalDestino]) {
    const scope = await resolveAndValidateSucursalScope(session, sid);
    if (!scope.ok) return scope.response;
  }

  const { data: producto, error: prodErr } = await session.supabase
    .from('producto')
    .select('id, usa_variantes')
    .eq('id', productoId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });
  if (!producto) return NextResponse.json({ error: 'Producto no encontrado.' }, { status: 404 });
  if ((producto as { usa_variantes?: boolean }).usa_variantes && !productoVarianteId) {
    return NextResponse.json(
      { error: 'Este producto usa variantes. Selecciona una variante para transferir stock.' },
      { status: 400 },
    );
  }

  const { data, error } = await (session.supabase as any).rpc('crear_transferencia_stock_pendiente', {
    p_tenant_id: session.tenantId,
    p_producto_id: productoId,
    p_sucursal_origen_id: sucursalOrigen,
    p_sucursal_destino_id: sucursalDestino,
    p_cantidad: cantidad,
    p_motivo: motivo,
    p_usuario_id: session.userId,
    p_producto_variante_id: productoVarianteId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: rpcErrorStatus(error.message) });
  }

  return NextResponse.json(data, { status: 201 });
}
