import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * UUID del estado de workflow cuyo slug coincide con `pedido.estado` (ej. borrador → slug borrador).
 */
export async function obtenerWorkflowEstadoIdPorSlugTenant(
  supabase: Pick<SupabaseClient, 'from'>,
  tenantId: string,
  slug: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('pedido_estado_workflow')
    .select('id')
    .eq('tenant_id', tenantId)
    .ilike('slug', slug.trim())
    .maybeSingle();

  if (error || !data) return null;
  return data.id ?? null;
}
