/**
 * Resolución de producto por código interno del catálogo (mismo criterio que el matching del lector).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizarCodigoMatch } from '@/lib/productos/upsert-con-proveedor';
import type { Database } from '@/types/database';

/** Códigos generados al crear desde factura sin código (`LFA-…` / `CMP-…`). No deben buscar en catálogo. */
export function esCodigoAutoGeneradoDesdeFactura(codigo: string, prefijos: readonly string[] = ['LFA', 'CMP']): boolean {
  const t = codigo.trim();
  for (const p of prefijos) {
    const re = new RegExp(`^${p}-\\d+-\\d+(-\\d+)?$`);
    if (re.test(t)) return true;
  }
  return false;
}

/**
 * Primer producto activo del tenant cuyo `codigo` coincide (trim + minúsculas) con `codigoBuscado`.
 * Si hay varios (distinto proveedor / sucursal de hogar), desempata por `id` ascendente.
 */
export async function buscarProductoIdPorCodigoInternoTenant(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  codigoBuscado: string,
): Promise<string | null> {
  const norm = normalizarCodigoMatch(codigoBuscado);
  if (!norm) return null;

  const { data, error } = await supabase
    .from('producto')
    .select('id, codigo')
    .eq('tenant_id', tenantId)
    .eq('activo', true);

  if (error || !data?.length) return null;

  const matches = data.filter((p) => normalizarCodigoMatch(p.codigo) === norm);
  if (matches.length === 0) return null;

  matches.sort((a, b) => a.id.localeCompare(b.id));
  return matches[0]!.id;
}
