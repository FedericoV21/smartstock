import { NextResponse } from 'next/server';

import { resolveEffectiveTenantId } from '@/lib/api/effective-tenant';
import { createServerClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

export type RolUsuario = Database['public']['Enums']['rol_usuario'];

export type TenantSession =
  | {
      supabase: Awaited<ReturnType<typeof createServerClient>>;
      userId: string;
      /** Tenant efectivo (JWT / RLS); puede ser un cliente si super admin cambió contexto. */
      tenantId: string;
      homeTenantId: string;
      isSuperAdmin: boolean;
      rol: RolUsuario;
    }
  | { error: NextResponse };

export async function getTenantSession(): Promise<TenantSession> {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
    }

    const { data: usuario, error } = await supabase
      .from('usuario')
      .select('tenant_id, rol, es_super_admin, tenant_contexto_id')
      .eq('id', user.id)
      .maybeSingle();

    if (error || !usuario) {
      if (error) {
        console.error('[getTenantSession] usuario:', error.message, error.code);
      } else {
        console.warn('[getTenantSession] sin fila en public.usuario para', user.id);
      }
      const payload: {
        error: string;
        hint?: string;
        debug?: { userId: string; supabaseCode?: string; supabaseMessage?: string; noRow?: boolean };
      } = {
        error: 'Perfil no encontrado',
        hint:
          'No hay perfil de app para este usuario. Verificá public.usuario en Supabase o completá el registro.',
      };
      if (process.env.NODE_ENV === 'development') {
        payload.debug = {
          userId: user.id,
          ...(error
            ? { supabaseCode: error.code, supabaseMessage: error.message }
            : { noRow: true }),
        };
      }
      return { error: NextResponse.json(payload, { status: 403 }) };
    }

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
        .eq('usuario_id', user.id)
        .eq('tenant_id', usuario.tenant_contexto_id)
        .maybeSingle();
      contextAllowed = Boolean(acceso);
    }

    const tenantId = resolveEffectiveTenantId({
      homeTenantId,
      tenantContextoId: usuario.tenant_contexto_id,
      esSuperAdmin: usuario.es_super_admin,
      contextAllowed,
    });

    return {
      supabase,
      userId: user.id,
      tenantId,
      homeTenantId,
      isSuperAdmin: usuario.es_super_admin,
      rol: usuario.rol,
    };
  } catch (e) {
    console.error('[getTenantSession] error inesperado:', e);
    return { error: NextResponse.json({ error: 'Error interno' }, { status: 503 }) };
  }
}

export function rejectIfVisor(rol: RolUsuario) {
  if (rol === 'visor') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }
  return null;
}
