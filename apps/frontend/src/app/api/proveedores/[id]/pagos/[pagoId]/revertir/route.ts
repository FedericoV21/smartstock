import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { rejectUnlessProveedorEdicion } from '@/lib/api/permissions';
import { moduloGuard } from '@/lib/modulos/guard';
import type { createServerClient } from '@/lib/supabase/server';
import type { Tables } from '@/types/database';

type SupabaseServerClient = Awaited<ReturnType<typeof createServerClient>>;

type PagoProveedor = Pick<
  Tables<'pago'>,
  | 'id'
  | 'tenant_id'
  | 'proveedor_id'
  | 'cuenta_id'
  | 'comprobante_id'
  | 'monto'
  | 'tipo_pago'
  | 'fecha'
  | 'usuario_id'
  | 'notas'
  | 'created_at'
>;

type MovimientoProveedor = Pick<
  Tables<'pago_proveedor_movimiento'>,
  | 'id'
  | 'tenant_id'
  | 'pago_proveedor_factura_id'
  | 'pago_cuenta_corriente_id'
  | 'monto'
  | 'tipo_pago'
  | 'fecha'
  | 'usuario_id'
  | 'notas'
  | 'recibo_comprobante_id'
>;

type ObligacionProveedor = Pick<
  Tables<'pago_proveedor_factura'>,
  'id' | 'tenant_id' | 'proveedor_id' | 'comprobante_id' | 'monto_original' | 'saldo_pendiente' | 'estado'
>;

function n(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function estadoObligacion(saldoPendiente: number, montoOriginal: number) {
  if (saldoPendiente <= 0.000001) return 'pagada';
  if (saldoPendiente + 0.000001 < montoOriginal) return 'parcial';
  return 'pendiente';
}

function errorJson(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function mismaMetadataMovimiento(
  query: ReturnType<typeof movimientoBaseQuery>,
  pago: PagoProveedor,
) {
  let q = query
    .eq('monto', pago.monto)
    .eq('tipo_pago', pago.tipo_pago)
    .eq('fecha', pago.fecha);

  q = pago.usuario_id == null ? q.is('usuario_id', null) : q.eq('usuario_id', pago.usuario_id);
  q = pago.notas == null ? q.is('notas', null) : q.eq('notas', pago.notas);
  return q;
}

function movimientoBaseQuery(supabase: SupabaseServerClient) {
  return supabase
    .from('pago_proveedor_movimiento')
    .select(
      'id, tenant_id, pago_proveedor_factura_id, pago_cuenta_corriente_id, monto, tipo_pago, fecha, usuario_id, notas, recibo_comprobante_id',
    );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; pagoId: string }> },
) {
  const guard = await moduloGuard('stock');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;
  const deniedProv = await rejectUnlessProveedorEdicion(session.supabase, session);
  if (deniedProv) return deniedProv;

  const { id: proveedorId, pagoId } = await params;

  const { data: pago, error: pagoErr } = await session.supabase
    .from('pago')
    .select('id, tenant_id, proveedor_id, cuenta_id, comprobante_id, monto, tipo_pago, fecha, usuario_id, notas, created_at')
    .eq('id', pagoId)
    .eq('tenant_id', session.tenantId)
    .eq('proveedor_id', proveedorId)
    .maybeSingle();

  if (pagoErr) return errorJson(pagoErr.message, 500);
  if (!pago) return errorJson('Pago de proveedor no encontrado', 404);

  const { data: cuenta, error: cuentaErr } = await session.supabase
    .from('cuenta_corriente')
    .select('id, saldo')
    .eq('id', pago.cuenta_id)
    .eq('tenant_id', session.tenantId)
    .eq('proveedor_id', proveedorId)
    .maybeSingle();

  if (cuentaErr) return errorJson(cuentaErr.message, 500);
  if (!cuenta) return errorJson('Cuenta corriente de proveedor no encontrada', 404);

  const { error: tesoreriaRevErr } = await (session.supabase as any).rpc('revertir_movimiento_tesoreria_por_pago', {
    p_tenant_id: session.tenantId,
    p_pago_id: pago.id,
  });
  if (tesoreriaRevErr) return errorJson(tesoreriaRevErr.message, 409);

  let movimiento: MovimientoProveedor | null = null;
  let obligacion: ObligacionProveedor | null = null;

  const { data: movimientosPorPagoRaw, error: movPorPagoErr } = await movimientoBaseQuery(session.supabase)
    .eq('tenant_id', session.tenantId)
    .eq('pago_cuenta_corriente_id', pago.id);

  if (movPorPagoErr) return errorJson(movPorPagoErr.message, 500);
  const movimientosPorPago = (movimientosPorPagoRaw ?? []) as MovimientoProveedor[];

  if (movimientosPorPago.length > 1) {
    if (movimientosPorPago.some((m) => m.recibo_comprobante_id)) {
      return errorJson('El pago tiene recibo asociado. Anula ese recibo antes de revertir el pago', 409);
    }

    const movimientoIds = movimientosPorPago.map((m) => m.id);
    const obligacionIds = [...new Set(movimientosPorPago.map((m) => m.pago_proveedor_factura_id))];

    const { data: obligacionesRaw, error: obligacionesErr } = await session.supabase
      .from('pago_proveedor_factura')
      .select('id, tenant_id, proveedor_id, comprobante_id, monto_original, saldo_pendiente, estado')
      .eq('tenant_id', session.tenantId)
      .eq('proveedor_id', proveedorId)
      .in('id', obligacionIds);

    if (obligacionesErr) return errorJson(obligacionesErr.message, 500);
    const obligaciones = (obligacionesRaw ?? []) as ObligacionProveedor[];
    if (obligaciones.length !== obligacionIds.length) {
      return errorJson('Una o mas obligaciones asociadas al pago no fueron encontradas', 404);
    }
    if (obligaciones.some((o) => o.estado === 'anulada')) {
      return errorJson('Una obligacion asociada esta anulada', 409);
    }

    const { data: movimientosObligacionesRaw, error: movimientosObligacionesErr } =
      await movimientoBaseQuery(session.supabase)
        .eq('tenant_id', session.tenantId)
        .in('pago_proveedor_factura_id', obligacionIds);

    if (movimientosObligacionesErr) return errorJson(movimientosObligacionesErr.message, 500);

    const movimientosRevertidos = new Set(movimientoIds);
    const movimientosRestantes = ((movimientosObligacionesRaw ?? []) as MovimientoProveedor[]).filter(
      (m) => !movimientosRevertidos.has(m.id),
    );

    const { error: deleteMovsErr } = await session.supabase
      .from('pago_proveedor_movimiento')
      .delete()
      .eq('tenant_id', session.tenantId)
      .in('id', movimientoIds);
    if (deleteMovsErr) return errorJson(deleteMovsErr.message, 500);

    for (const obl of obligaciones) {
      const totalRestante = movimientosRestantes
        .filter((m) => m.pago_proveedor_factura_id === obl.id)
        .reduce((acc, row) => acc + n(row.monto), 0);
      const saldoNuevo = Math.max(n(obl.monto_original) - totalRestante, 0);
      const estadoNuevo = estadoObligacion(saldoNuevo, n(obl.monto_original));

      const { error: updateOblErr } = await session.supabase
        .from('pago_proveedor_factura')
        .update({
          saldo_pendiente: saldoNuevo,
          estado: estadoNuevo,
          recordatorio_snooze_until: null,
        })
        .eq('tenant_id', session.tenantId)
        .eq('id', obl.id);

      if (updateOblErr) return errorJson(updateOblErr.message, 500);
    }

    const saldoCuentaNuevo = n(cuenta.saldo) + n(pago.monto);
    const { error: cuentaUpdateErr } = await session.supabase
      .from('cuenta_corriente')
      .update({ saldo: saldoCuentaNuevo })
      .eq('tenant_id', session.tenantId)
      .eq('id', cuenta.id);

    if (cuentaUpdateErr) return errorJson(cuentaUpdateErr.message, 500);

    const { error: pagoDeleteErr } = await session.supabase
      .from('pago')
      .delete()
      .eq('tenant_id', session.tenantId)
      .eq('id', pago.id);

    if (pagoDeleteErr) return errorJson(pagoDeleteErr.message, 500);

    return NextResponse.json({
      resultado: {
        pago_id: pago.id,
        proveedor_id: proveedorId,
        monto_revertido: n(pago.monto),
        saldo_cuenta_nuevo: saldoCuentaNuevo,
        obligaciones_revertidas: obligaciones.map((o) => o.id),
        movimientos_revertidos: movimientoIds,
      },
    });
  }

  movimiento = movimientosPorPago[0] ?? null;

  if (!movimiento && pago.comprobante_id) {
    const { data: obl, error: oblErr } = await session.supabase
      .from('pago_proveedor_factura')
      .select('id, tenant_id, proveedor_id, comprobante_id, monto_original, saldo_pendiente, estado')
      .eq('tenant_id', session.tenantId)
      .eq('proveedor_id', proveedorId)
      .eq('comprobante_id', pago.comprobante_id)
      .maybeSingle();

    if (oblErr) return errorJson(oblErr.message, 500);
    obligacion = obl as ObligacionProveedor | null;

    if (obligacion) {
      const { data: candidatos, error: candErr } = await mismaMetadataMovimiento(
        movimientoBaseQuery(session.supabase)
          .eq('tenant_id', session.tenantId)
          .eq('pago_proveedor_factura_id', obligacion.id)
          .is('pago_cuenta_corriente_id', null),
        pago as PagoProveedor,
      );

      if (candErr) return errorJson(candErr.message, 500);
      if ((candidatos ?? []).length === 0) {
        return errorJson('No se pudo vincular el pago con su movimiento de factura', 409);
      }
      if ((candidatos ?? []).length > 1) {
        return errorJson('Hay varios movimientos compatibles con este pago. No se puede revertir con seguridad', 409);
      }
      movimiento = candidatos?.[0] as MovimientoProveedor;
    }
  }

  if (!movimiento && !pago.comprobante_id) {
    const { data: obligacionesSinComprobante, error: oblSinCompErr } = await session.supabase
      .from('pago_proveedor_factura')
      .select('id')
      .eq('tenant_id', session.tenantId)
      .eq('proveedor_id', proveedorId)
      .is('comprobante_id', null);

    if (oblSinCompErr) return errorJson(oblSinCompErr.message, 500);
    const obligacionIds = (obligacionesSinComprobante ?? []).map((row) => row.id);
    if (obligacionIds.length > 0) {
      const { data: candidatos, error: candErr } = await mismaMetadataMovimiento(
        movimientoBaseQuery(session.supabase)
          .eq('tenant_id', session.tenantId)
          .in('pago_proveedor_factura_id', obligacionIds)
          .is('pago_cuenta_corriente_id', null),
        pago as PagoProveedor,
      );
      if (candErr) return errorJson(candErr.message, 500);
      if ((candidatos ?? []).length > 0) {
        return errorJson(
          'El pago podria pertenecer a una obligacion sin comprobante, pero no se pudo vincular con seguridad',
          409,
        );
      }
    }
  }

  if (movimiento) {
    if (movimiento.recibo_comprobante_id) {
      return errorJson('El pago tiene recibo asociado. Anula ese recibo antes de revertir el pago', 409);
    }

    if (!obligacion || obligacion.id !== movimiento.pago_proveedor_factura_id) {
      const { data: obl, error: oblErr } = await session.supabase
        .from('pago_proveedor_factura')
        .select('id, tenant_id, proveedor_id, comprobante_id, monto_original, saldo_pendiente, estado')
        .eq('tenant_id', session.tenantId)
        .eq('id', movimiento.pago_proveedor_factura_id)
        .maybeSingle();

      if (oblErr) return errorJson(oblErr.message, 500);
      if (!obl) return errorJson('Obligacion a proveedor no encontrada', 404);
      obligacion = obl as ObligacionProveedor;
    }

    if (obligacion.estado === 'anulada') {
      return errorJson('La obligacion asociada esta anulada', 409);
    }

    const { data: restantes, error: restantesErr } = await session.supabase
      .from('pago_proveedor_movimiento')
      .select('monto')
      .eq('tenant_id', session.tenantId)
      .eq('pago_proveedor_factura_id', obligacion.id)
      .neq('id', movimiento.id);

    if (restantesErr) return errorJson(restantesErr.message, 500);

    const totalRestante = (restantes ?? []).reduce((acc, row) => acc + n(row.monto), 0);
    const saldoNuevo = Math.max(n(obligacion.monto_original) - totalRestante, 0);
    const estadoNuevo = estadoObligacion(saldoNuevo, n(obligacion.monto_original));

    const { error: deleteMovErr } = await session.supabase
      .from('pago_proveedor_movimiento')
      .delete()
      .eq('tenant_id', session.tenantId)
      .eq('id', movimiento.id);
    if (deleteMovErr) return errorJson(deleteMovErr.message, 500);

    const { error: updateOblErr } = await session.supabase
      .from('pago_proveedor_factura')
      .update({
        saldo_pendiente: saldoNuevo,
        estado: estadoNuevo,
        recordatorio_snooze_until: null,
      })
      .eq('tenant_id', session.tenantId)
      .eq('id', obligacion.id);

    if (updateOblErr) return errorJson(updateOblErr.message, 500);
  }

  const saldoCuentaNuevo = n(cuenta.saldo) + n(pago.monto);
  const { error: cuentaUpdateErr } = await session.supabase
    .from('cuenta_corriente')
    .update({ saldo: saldoCuentaNuevo })
    .eq('tenant_id', session.tenantId)
    .eq('id', cuenta.id);

  if (cuentaUpdateErr) return errorJson(cuentaUpdateErr.message, 500);

  const { error: pagoDeleteErr } = await session.supabase
    .from('pago')
    .delete()
    .eq('tenant_id', session.tenantId)
    .eq('id', pago.id);

  if (pagoDeleteErr) return errorJson(pagoDeleteErr.message, 500);

  return NextResponse.json({
    resultado: {
      pago_id: pago.id,
      proveedor_id: proveedorId,
      monto_revertido: n(pago.monto),
      saldo_cuenta_nuevo: saldoCuentaNuevo,
      obligacion_id: obligacion?.id ?? null,
      movimiento_revertido_id: movimiento?.id ?? null,
    },
  });
}
