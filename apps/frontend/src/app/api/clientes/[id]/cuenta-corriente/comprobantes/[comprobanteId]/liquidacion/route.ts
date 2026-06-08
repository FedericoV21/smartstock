import { NextResponse, type NextRequest } from 'next/server';

import { rejectUnlessAccesoClientesApi } from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { loadEffectiveBusinessPrefs } from '@/lib/business-prefs/server';
import { validarComprobanteLiquidable } from '@/lib/cuenta-corriente/liquidar-items-dia';
import {
  mapComprobantesAMovimientosDia,
  type MovimientoDiaComprobanteRow,
} from '@/lib/cuenta-corriente/movimientos-dia';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { hoyEnAR } from '@/lib/utils/formatters';

/** Ítems de un comprobante CC liquidable (para edición desde extracto). */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; comprobanteId: string }> },
) {
  const guard = await moduloGuardAny(['facturador_simple', 'facturador_pos']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const deniedCli = await rejectUnlessAccesoClientesApi(session.supabase, session);
  if (deniedCli) return deniedCli;

  const { id: clienteId, comprobanteId } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const sucursalScope = await resolveAndValidateSucursalScope(
    session,
    searchParams.get('sucursal_id'),
  );
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'Indicá la sucursal operativa.' }, { status: 400 });
  }

  const businessPrefs = await loadEffectiveBusinessPrefs(
    session.supabase,
    session.tenantId,
    sucursalScope.sucursalId,
  );
  if (!businessPrefs.cuentaCorrienteDistribuidora.permitirLiquidacionItemsDia) {
    return NextResponse.json(
      { error: 'La liquidación de precios del día no está habilitada en esta sucursal.' },
      { status: 403 },
    );
  }

  const { data: comp, error: compErr } = await session.supabase
    .from('comprobante')
    .select(
      `
      id,
      cliente_id,
      tipo,
      numero,
      numero_caja,
      fecha,
      created_at,
      total,
      metodo_pago,
      estado,
      cae,
      sucursal_id,
      comprobante_item (
        id,
        cantidad,
        precio_unitario,
        subtotal,
        producto_variante_etiqueta,
        producto ( nombre, codigo, unidad, es_pesable )
      )
    `,
    )
    .eq('id', comprobanteId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (compErr || !comp) {
    return NextResponse.json({ error: 'Comprobante no encontrado.' }, { status: 404 });
  }
  if (comp.cliente_id !== clienteId) {
    return NextResponse.json({ error: 'El comprobante no corresponde a este cliente.' }, { status: 400 });
  }

  const val = validarComprobanteLiquidable({
    fechaHoy: hoyEnAR(),
    sucursalId: sucursalScope.sucursalId,
    comprobante: {
      fecha: comp.fecha,
      metodo_pago: comp.metodo_pago,
      estado: comp.estado,
      tipo: comp.tipo,
      cae: comp.cae,
      sucursal_id: comp.sucursal_id,
    },
  });
  if (!val.ok) {
    return NextResponse.json({ error: val.error }, { status: val.status });
  }

  const { data: tenant } = await session.supabase
    .from('tenant')
    .select('punto_de_venta')
    .maybeSingle();

  const mapped = mapComprobantesAMovimientosDia(
    [comp as MovimientoDiaComprobanteRow],
    tenant?.punto_de_venta ?? 1,
    { liquidacionHabilitada: true },
  );

  const dto = mapped[0];
  if (!dto) {
    return NextResponse.json({ error: 'No se pudo cargar el comprobante.' }, { status: 500 });
  }

  return NextResponse.json({
    comprobante_id: dto.id,
    descripcion: `${dto.tipoLabel} ${dto.numeroLabel}`,
    total_label: dto.totalLabel,
    items: dto.items,
  });
}
