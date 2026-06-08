import type { SupabaseClient } from '@supabase/supabase-js';

import {
  calcularVencimientoDia,
  proveedorTieneCondicionPagoCargada,
  vencimientoDefaultPersonalizado,
  vencimientoTimestamptzDesdeDia,
  type PagoProveedorEstadoUi,
  type ProveedorCondicionPago,
} from '@/lib/cuenta-corriente/pago-proveedor-vencimiento';
import { calcularSaldoPendienteNuevoCargo } from '@/lib/cuenta-corriente/saldo';
import type { Database } from '@/types/database';

export type ImportObligacionModoVenc = 'condicion' | 'fecha_fija';

export type InsertarObligacionImportListaInput = {
  proveedorId: string;
  monto: number;
  modo: ImportObligacionModoVenc;
  /** YYYY-MM-DD, base para venc. según condición (contado / días). */
  fechaOperacionYmd: string;
  /** YYYY-MM-DD si `modo === 'fecha_fija'`. */
  vencimientoYmd?: string;
  referencia: string;
};

export async function insertarObligacionImportLista(
  supabase: SupabaseClient<Database>,
  ctx: { tenantId: string },
  input: InsertarObligacionImportListaInput,
): Promise<{ id: string }> {
  if (!input.proveedorId) {
    throw new Error('Falta el proveedor');
  }
  if (input.monto == null || input.monto <= 0) {
    throw new Error('El monto de la obligación debe ser mayor a cero');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fechaOperacionYmd.slice(0, 10))) {
    throw new Error('La fecha de operación debe ser YYYY-MM-DD');
  }
  if (input.modo === 'fecha_fija') {
    const v = input.vencimientoYmd;
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw new Error('Indicá la fecha de vencimiento de pago');
    }
  }

  const { data: prov, error: pErr } = await supabase
    .from('proveedor')
    .select('id, condicion_pago_default, plazo_pago_dias')
    .eq('id', input.proveedorId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message);
  if (!prov) {
    throw new Error('Proveedor no encontrado');
  }

  const provC: ProveedorCondicionPago = {
    condicion_pago_default: prov.condicion_pago_default,
    plazo_pago_dias: prov.plazo_pago_dias,
  };

  if (input.modo === 'condicion' && !proveedorTieneCondicionPagoCargada(provC)) {
    throw new Error(
      'Cargá la condición de pago en la ficha del proveedor, o usá vencimiento con fecha fija.',
    );
  }

  const fOp = input.fechaOperacionYmd.slice(0, 10);
  const estado: PagoProveedorEstadoUi =
    input.modo === 'fecha_fija' ? 'pendiente_fecha_custom' : 'pendiente_condicion';

  let vencCustom = input.vencimientoYmd;
  if (estado === 'pendiente_fecha_custom' && (vencCustom == null || vencCustom.length < 10)) {
    vencCustom = vencimientoDefaultPersonalizado(fOp, null);
  }

  const { vencimientoDiaYmd, condicion } = calcularVencimientoDia({
    estado,
    fechaFacturaYmd: fOp,
    proveedor: provC,
    vencimientoCustomYmd: estado === 'pendiente_fecha_custom' ? vencCustom : null,
  });

  if (vencimientoDiaYmd < fOp) {
    throw new Error('El vencimiento no puede ser anterior a la fecha de la operación');
  }

  const montoR = Math.round(input.monto * 100) / 100;
  const vencAt = vencimientoTimestamptzDesdeDia(vencimientoDiaYmd);
  const ref = input.referencia.trim().slice(0, 500);
  const { data: cuenta } = await supabase
    .from('cuenta_corriente')
    .select('saldo')
    .eq('tenant_id', ctx.tenantId)
    .eq('proveedor_id', input.proveedorId)
    .maybeSingle();
  const saldoPendienteInicial = calcularSaldoPendienteNuevoCargo(
    cuenta ? Number(cuenta.saldo) : montoR,
    montoR,
  );
  const estadoInicial =
    saldoPendienteInicial <= 0
      ? 'pagada'
      : saldoPendienteInicial < montoR - 0.01
        ? 'parcial'
        : 'pendiente';

  const { data: ins, error: iErr } = await supabase
    .from('pago_proveedor_factura')
    .insert({
      tenant_id: ctx.tenantId,
      comprobante_id: null,
      proveedor_id: input.proveedorId,
      monto_original: montoR,
      saldo_pendiente: saldoPendienteInicial,
      vencimiento_at: vencAt,
      condicion_pago: condicion,
      estado: estadoInicial,
      origen: 'import_lista',
      referencia: ref || null,
    })
    .select('id')
    .single();
  if (iErr) {
    throw new Error(iErr.message);
  }
  if (!ins?.id) {
    throw new Error('No se pudo registrar la obligación a proveedor');
  }
  return { id: ins.id };
}
