import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveEffectiveTenantId } from '@/lib/api/effective-tenant';
import type { Database } from '@/types/database';

export function isTenantBusinessSetupComplete(row: {
  nombre: string;
  razon_social: string | null;
  cuit: string | null;
  condicion_iva: string | null;
}): boolean {
  return Boolean(
    String(row.nombre ?? '').trim() &&
      String(row.razon_social ?? '').trim() &&
      String(row.cuit ?? '').trim() &&
      String(row.condicion_iva ?? '').trim()
  );
}

/**
 * Estado de datos mínimos del negocio para el tenant efectivo del usuario
 * (incluye contexto de super admin).
 */
export async function resolveTenantBusinessSetupForUser(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<{ complete: boolean; rol: Database['public']['Enums']['rol_usuario'] } | null> {
  const { data: usuario } = await supabase
    .from('usuario')
    .select('tenant_id, rol, es_super_admin, tenant_contexto_id')
    .eq('id', userId)
    .maybeSingle();
  if (!usuario) return null;

  const homeTenantId = usuario.tenant_id;
  let contextAllowed = false;
  if (
    usuario.es_super_admin &&
    usuario.tenant_contexto_id != null &&
    usuario.tenant_contexto_id !== homeTenantId
  ) {
    const { data: acceso } = await supabase
      .from('super_admin_tenant_acceso')
      .select('tenant_id')
      .eq('usuario_id', userId)
      .eq('tenant_id', usuario.tenant_contexto_id)
      .maybeSingle();
    contextAllowed = Boolean(acceso);
  }

  const effectiveTenantId = resolveEffectiveTenantId({
    homeTenantId,
    tenantContextoId: usuario.tenant_contexto_id,
    esSuperAdmin: usuario.es_super_admin,
    contextAllowed,
  });

  const { data: tenant } = await supabase
    .from('tenant')
    .select('nombre, razon_social, cuit, condicion_iva')
    .eq('id', effectiveTenantId)
    .maybeSingle();

  if (!tenant) {
    return { complete: false, rol: usuario.rol };
  }

  return {
    complete: isTenantBusinessSetupComplete(tenant),
    rol: usuario.rol,
  };
}
