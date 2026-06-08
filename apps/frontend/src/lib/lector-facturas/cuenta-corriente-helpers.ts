import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export type IncrementarSaldoCuentaResult = {
  cuentaId: string;
  saldoAnterior: number;
  saldoNuevo: number;
  creada: boolean;
};

export async function incrementarSaldoCuentaCliente(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  clienteId: string,
  delta: number,
): Promise<IncrementarSaldoCuentaResult> {
  const { data: row } = await supabase
    .from('cuenta_corriente')
    .select('id, saldo')
    .eq('tenant_id', tenantId)
    .eq('cliente_id', clienteId)
    .maybeSingle();

  if (!row) {
    const { data, error } = await supabase
      .from('cuenta_corriente')
      .insert({
        tenant_id: tenantId,
        cliente_id: clienteId,
        proveedor_id: null,
        saldo: delta,
      })
      .select('id, saldo')
      .single();
    if (error) throw new Error(error.message);
    return {
      cuentaId: data.id,
      saldoAnterior: 0,
      saldoNuevo: Number(data.saldo),
      creada: true,
    };
  }

  const saldoAnterior = Number(row.saldo);
  const saldoNuevo = saldoAnterior + delta;
  const { error: uerr } = await supabase
    .from('cuenta_corriente')
    .update({ saldo: saldoNuevo })
    .eq('id', row.id);
  if (uerr) throw new Error(uerr.message);
  return {
    cuentaId: row.id,
    saldoAnterior,
    saldoNuevo,
    creada: false,
  };
}

export async function incrementarSaldoCuentaProveedor(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  proveedorId: string,
  delta: number,
): Promise<IncrementarSaldoCuentaResult> {
  const { data: row } = await supabase
    .from('cuenta_corriente')
    .select('id, saldo')
    .eq('tenant_id', tenantId)
    .eq('proveedor_id', proveedorId)
    .maybeSingle();

  if (!row) {
    const { data, error } = await supabase
      .from('cuenta_corriente')
      .insert({
        tenant_id: tenantId,
        cliente_id: null,
        proveedor_id: proveedorId,
        tipo_cuenta: 'proveedor',
        saldo: delta,
      })
      .select('id, saldo')
      .single();
    if (error) throw new Error(error.message);
    return {
      cuentaId: data.id,
      saldoAnterior: 0,
      saldoNuevo: Number(data.saldo),
      creada: true,
    };
  }

  const saldoAnterior = Number(row.saldo);
  const saldoNuevo = saldoAnterior + delta;
  const { error: uerr } = await supabase
    .from('cuenta_corriente')
    .update({ saldo: saldoNuevo })
    .eq('id', row.id);
  if (uerr) throw new Error(uerr.message);
  return {
    cuentaId: row.id,
    saldoAnterior,
    saldoNuevo,
    creada: false,
  };
}
