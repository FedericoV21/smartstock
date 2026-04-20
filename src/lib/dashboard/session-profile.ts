import { cache } from 'react';

import { resolveEffectiveTenantId } from '@/lib/api/effective-tenant';
import { getCachedServerAuth } from '@/lib/supabase/cached-auth';
import type { Database } from '@/types/database';

export type SessionProfile = {
  userDisplayName: string;
  /** Tenant efectivo (nombre en UI / módulos). */
  tenantId: string;
  homeTenantId: string;
  /** Nombre del negocio casa (super admin). */
  homeTenantName: string;
  isSuperAdmin: boolean;
  tenantName: string;
  rol: Database['public']['Enums']['rol_usuario'];
  ivaDefault: number;
};

export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  const { supabase, user } = await getCachedServerAuth();
  if (!user) return null;

  const { data: usuario } = await supabase
    .from('usuario')
    .select('nombre, apellido, tenant_id, rol, es_super_admin, tenant_contexto_id')
    .eq('id', user.id)
    .maybeSingle();

  const homeTenantId = usuario?.tenant_id ?? '';
  let contextAllowed = false;
  if (
    usuario?.es_super_admin &&
    usuario.tenant_contexto_id != null &&
    usuario.tenant_contexto_id !== homeTenantId
  ) {
    const { data: acceso } = await supabase
      .from('super_admin_tenant_acceso')
      .select('tenant_id')
      .eq('usuario_id', user.id)
      .eq('tenant_id', usuario.tenant_contexto_id)
      .maybeSingle();
    contextAllowed = Boolean(acceso);
  }

  const effectiveTenantId =
    usuario != null
      ? resolveEffectiveTenantId({
          homeTenantId: usuario.tenant_id,
          tenantContextoId: usuario.tenant_contexto_id,
          esSuperAdmin: usuario.es_super_admin,
          contextAllowed,
        })
      : '';

  let homeTenantName = 'Tu negocio';
  let tenantName = 'Tu negocio';
  let ivaDefault = 21;

  if (homeTenantId) {
    const { data: homeT } = await supabase
      .from('tenant')
      .select('nombre, iva_porcentaje_default')
      .eq('id', homeTenantId)
      .maybeSingle();
    if (homeT?.nombre) {
      homeTenantName = homeT.nombre;
      tenantName = homeT.nombre;
    }
    if (homeT?.iva_porcentaje_default != null) ivaDefault = homeT.iva_porcentaje_default;
  }

  if (effectiveTenantId && effectiveTenantId !== homeTenantId) {
    const { data: actT } = await supabase
      .from('tenant')
      .select('nombre, iva_porcentaje_default')
      .eq('id', effectiveTenantId)
      .maybeSingle();
    if (actT?.nombre) tenantName = actT.nombre;
    if (actT?.iva_porcentaje_default != null) ivaDefault = actT.iva_porcentaje_default;
  }

  const userDisplayName = usuario
    ? `${usuario.nombre} ${usuario.apellido}`.trim()
    : (user.email ?? 'Usuario');

  return {
    userDisplayName,
    tenantId: effectiveTenantId,
    homeTenantId,
    homeTenantName,
    isSuperAdmin: Boolean(usuario?.es_super_admin),
    tenantName,
    rol: usuario?.rol ?? 'visor',
    ivaDefault,
  };
});
