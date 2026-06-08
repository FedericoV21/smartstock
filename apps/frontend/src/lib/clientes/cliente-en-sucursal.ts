import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

export type ClienteRow = Database['public']['Tables']['cliente']['Row'];

async function clienteTieneMembresiaEnSucursal(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
  clienteId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from('cliente_sucursal')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('sucursal_id', sucursalId)
    .eq('cliente_id', clienteId);

  if (error) return false;
  return (count ?? 0) > 0;
}

/**
 * Obtiene una fila de cliente solo si tiene membresía en la sucursal operativa.
 */
export async function fetchClienteSiEnSucursal(
  supabase: SupabaseClient<Database>,
  params: {
    tenantId: string;
    sucursalId: string;
    clienteId: string;
    columns?: string;
  },
): Promise<ClienteRow | null> {
  const okMemb = await clienteTieneMembresiaEnSucursal(
    supabase,
    params.tenantId,
    params.sucursalId,
    params.clienteId,
  );
  if (!okMemb) return null;

  const cols = params.columns ?? '*';
  const { data, error } = await supabase
    .from('cliente')
    .select(cols)
    .eq('id', params.clienteId)
    .eq('tenant_id', params.tenantId)
    .maybeSingle();

  if (error) return null;
  return data as ClienteRow | null;
}

/**
 * Cliente válido en la sucursal: membresía, o legado (`cliente.sucursal_id`), o (admin) cualquier cliente del tenant.
 */
export async function fetchClienteParaUsoEnSucursal(
  supabase: SupabaseClient<Database>,
  params: {
    tenantId: string;
    sucursalId: string;
    clienteId: string;
    columns?: string;
    /** Admin / super admin: ignora membresía en facturación/listados de maestro. */
    sinRestriccionTenant?: boolean;
  },
): Promise<ClienteRow | null> {
  if (params.sinRestriccionTenant) {
    const cols = params.columns ?? '*';
    const { data, error } = await supabase
      .from('cliente')
      .select(cols)
      .eq('id', params.clienteId)
      .eq('tenant_id', params.tenantId)
      .maybeSingle();
    if (error) return null;
    return data as ClienteRow | null;
  }

  const porMemb = await fetchClienteSiEnSucursal(supabase, {
    tenantId: params.tenantId,
    sucursalId: params.sucursalId,
    clienteId: params.clienteId,
    columns: params.columns,
  });
  if (porMemb) return porMemb;

  const cols = params.columns ?? '*';
  const { data: legacy, error } = await supabase
    .from('cliente')
    .select(cols)
    .eq('id', params.clienteId)
    .eq('tenant_id', params.tenantId)
    .eq('sucursal_id', params.sucursalId)
    .maybeSingle();

  if (error) return null;
  return legacy as ClienteRow | null;
}

export async function listClienteIdsPorSucursal(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('cliente_sucursal')
    .select('cliente_id')
    .eq('tenant_id', tenantId)
    .eq('sucursal_id', sucursalId);

  if (error || !data?.length) return [];
  return data.map((r) => r.cliente_id);
}

/** Operador/visor: union membresía + clientes cuya sucursal canónica es la activa (compatibilidad previa a cliente_sucursal). */
export async function listIdsClientesVisiblesOperadorEnSucursal(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  sucursalId: string,
): Promise<string[]> {
  const desdeMemb = await listClienteIdsPorSucursal(supabase, tenantId, sucursalId);
  const { data: desdeLegacy, error } = await supabase
    .from('cliente')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('sucursal_id', sucursalId);

  if (error) {
    return desdeMemb;
  }
  const idsLegacy = (desdeLegacy ?? []).map((r) => r.id);
  return [...new Set([...desdeMemb, ...idsLegacy])];
}

export async function getSucursalIdsCliente(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  clienteId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('cliente_sucursal')
    .select('sucursal_id')
    .eq('tenant_id', tenantId)
    .eq('cliente_id', clienteId);

  if (!error && data?.length) {
    return data.map((r) => r.sucursal_id);
  }

  const { data: c } = await supabase
    .from('cliente')
    .select('sucursal_id')
    .eq('id', clienteId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (c?.sucursal_id) return [c.sucursal_id];
  return [];
}

export async function validarYSincronizarMembresiasCliente(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string;
    clienteId: string;
    /** Incluye al menos uno */
    sucursalIdsNuevos: string[];
    /** Valor actual de cliente.sucursal_id (preferido si sigue en el nuevo conjunto). */
    sucursalIdPrimariaActual: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const uniq = [...new Set(args.sucursalIdsNuevos.filter(Boolean))];
  if (uniq.length === 0) {
    return { ok: false, error: 'Debés seleccionar al menos una sucursal.' };
  }

  const { data: hijos, error: e1 } = await supabase
    .from('sucursal')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .in('id', uniq);

  if (e1) {
    return { ok: false, error: e1.message };
  }
  if (!hijos || hijos.length !== uniq.length) {
    return { ok: false, error: 'Una o más sucursales no pertenecen al negocio.' };
  }

  const inserts = uniq.map((sucursal_id) => ({
    tenant_id: args.tenantId,
    cliente_id: args.clienteId,
    sucursal_id,
  }));

  const { error: upsertErr } = await supabase.from('cliente_sucursal').upsert(inserts, {
    onConflict: 'cliente_id,sucursal_id',
    ignoreDuplicates: false,
  });
  if (upsertErr) {
    return { ok: false, error: upsertErr.message };
  }

  const { data: todas, error: listErr } = await supabase
    .from('cliente_sucursal')
    .select('sucursal_id')
    .eq('tenant_id', args.tenantId)
    .eq('cliente_id', args.clienteId);

  if (listErr) {
    return { ok: false, error: listErr.message };
  }

  const existentes = (todas ?? []).map((r) => r.sucursal_id);
  const borrar = existentes.filter((s) => !uniq.includes(s));
  for (const sid of borrar) {
    const { error: delErr } = await supabase
      .from('cliente_sucursal')
      .delete()
      .eq('tenant_id', args.tenantId)
      .eq('cliente_id', args.clienteId)
      .eq('sucursal_id', sid);
    if (delErr) {
      return { ok: false, error: delErr.message };
    }
  }

  const primaria = uniq.includes(args.sucursalIdPrimariaActual)
    ? args.sucursalIdPrimariaActual
    : uniq[0]!;

  const { error: updErr } = await supabase
    .from('cliente')
    .update({ sucursal_id: primaria })
    .eq('id', args.clienteId)
    .eq('tenant_id', args.tenantId);

  if (updErr) {
    return { ok: false, error: updErr.message };
  }

  return { ok: true };
}
