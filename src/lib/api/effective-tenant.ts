/**
 * Debe coincidir con public.custom_access_token_hook en
 * supabase/migrations/034_super_admin_contexto.sql
 */
export function resolveEffectiveTenantId(input: {
  homeTenantId: string;
  tenantContextoId: string | null;
  esSuperAdmin: boolean;
  contextAllowed: boolean;
}): string {
  const { homeTenantId, tenantContextoId, esSuperAdmin, contextAllowed } = input;
  if (!esSuperAdmin || tenantContextoId == null || tenantContextoId === homeTenantId) {
    return homeTenantId;
  }
  if (!contextAllowed) {
    return homeTenantId;
  }
  return tenantContextoId;
}
