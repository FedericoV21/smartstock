import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  buildLocalAuthEmail,
  generateLocalCashierPin,
  generateLocalCashierUsername,
  hashPin,
} from '@/lib/auth/local-credentials';
import {
  BUSINESS_PREFS_NUEVO_TENANT,
  MODULOS_PLAN_0_NUEVO_TENANT,
  PLAN_INICIAL_NUEVO_TENANT,
  POS_PREFS_NUEVO_TENANT,
} from '@/lib/auth/registro-plan-defaults';

interface RegistrarTenantParams {
  authUserId: string;
  email: string;
  negocio: string;
  nombre: string;
  apellido: string;
}

interface RegistrarTenantResult {
  bootstrapCredentials: {
    username: string;
    pin: string;
    tipo: string;
  };
}

export async function registrarTenantCompleto(
  params: RegistrarTenantParams
): Promise<RegistrarTenantResult> {
  const { authUserId, email, negocio, nombre, apellido } = params;
  const supabase = createServiceRoleClient();
  const adminDb = supabase as any;

  let cashierAuthUserId: string | null = null;
  let tenantId: string | null = null;
  let cashierUsername: string | null = null;
  let cashierPin: string | null = null;

  try {
    const { data: tenant, error: tenantError } = await supabase
      .from('tenant')
      .insert({
        nombre: negocio,
        plan: PLAN_INICIAL_NUEVO_TENANT,
        business_prefs: BUSINESS_PREFS_NUEVO_TENANT,
        pos_prefs: POS_PREFS_NUEVO_TENANT,
      })
      .select('id')
      .single();

    if (tenantError) {
      throw new Error(`No se pudo crear el negocio: ${tenantError.message}`);
    }
    tenantId = tenant.id;

    const { error: moduloError } = await supabase.from('modulo_config').insert({
      tenant_id: tenantId,
      ...MODULOS_PLAN_0_NUEVO_TENANT,
    });

    if (moduloError) {
      throw new Error(`No se pudo configurar los módulos: ${moduloError.message}`);
    }

    const { error: userError } = await supabase.from('usuario').insert({
      id: authUserId,
      tenant_id: tenantId,
      nombre,
      apellido,
      email,
      rol: 'admin',
    });

    if (userError) {
      throw new Error(`No se pudo crear el perfil: ${userError.message}`);
    }

    const { error: bootstrapError } = await supabase.rpc('bootstrap_security_for_tenant', {
      p_tenant_id: tenantId,
    });
    if (bootstrapError) {
      throw new Error(`No se pudo inicializar seguridad del negocio: ${bootstrapError.message}`);
    }

    const { data: sucursalPrincipal, error: sucursalError } = await adminDb
      .from('sucursal')
      .select('id')
      .eq('tenant_id', tenantId)
      .order('es_principal', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (sucursalError || !sucursalPrincipal?.id) {
      throw new Error(sucursalError?.message ?? 'No se encontró sucursal principal para el negocio.');
    }

    const sucursalPrincipalId = String(sucursalPrincipal.id);

    const { data: cajaGeneral, error: cajaLookupError } = await adminDb
      .from('caja')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('sucursal_id', sucursalPrincipalId)
      .order('numero', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (cajaLookupError) {
      throw new Error(`No se pudo validar caja inicial: ${cajaLookupError.message}`);
    }

    if (!cajaGeneral?.id) {
      const { error: cajaCreateError } = await adminDb.from('caja').insert({
        tenant_id: tenantId,
        sucursal_id: sucursalPrincipalId,
        numero: 1,
        nombre: 'Caja general',
        usuario_default_id: authUserId,
        activa: true,
      });
      if (cajaCreateError && cajaCreateError.code !== '23505') {
        throw new Error(`No se pudo crear caja inicial: ${cajaCreateError.message}`);
      }
    } else {
      await adminDb
        .from('caja')
        .update({ usuario_default_id: authUserId })
        .eq('id', cajaGeneral.id)
        .eq('tenant_id', tenantId)
        .is('usuario_default_id', null);
    }

    const { data: cashierRole, error: cashierRoleError } = await adminDb
      .from('rol')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('slug', 'cajero')
      .maybeSingle();
    if (cashierRoleError || !cashierRole?.id) {
      throw new Error(cashierRoleError?.message ?? 'No se pudo resolver el rol cajero.');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidateUsername = generateLocalCashierUsername('cajero');
      const candidatePin = generateLocalCashierPin(6);
      const candidateEmail = buildLocalAuthEmail(tenantId, candidateUsername);
      const candidatePinHash = await hashPin(candidatePin);

      const { data: existingCred } = await adminDb
        .from('usuario_credencial_local')
        .select('usuario_id')
        .eq('tenant_id', tenantId)
        .ilike('username_local', candidateUsername)
        .maybeSingle();
      if (existingCred) continue;

      const { data: cashierAuthData, error: cashierAuthError } = await supabase.auth.admin.createUser({
        email: candidateEmail,
        password: candidatePin,
        email_confirm: true,
        user_metadata: { local_auth: true, username_local: candidateUsername },
      });
      if (cashierAuthError || !cashierAuthData.user?.id) {
        if (cashierAuthError?.message?.toLowerCase().includes('already')) {
          continue;
        }
        throw new Error(cashierAuthError?.message ?? 'No se pudo crear el auth del cajero.');
      }

      cashierAuthUserId = cashierAuthData.user.id;

      const { error: cashierUserError } = await adminDb.from('usuario').insert({
        id: cashierAuthUserId,
        tenant_id: tenantId,
        email: candidateEmail,
        nombre: 'Cajero',
        apellido: 'Principal',
        rol: 'operador',
        activo: true,
        sucursal_default_id: sucursalPrincipalId,
      });
      if (cashierUserError) {
        throw new Error(`No se pudo crear el usuario cajero: ${cashierUserError.message}`);
      }

      const { error: cashierUserRoleError } = await adminDb.from('usuario_rol').insert({
        usuario_id: cashierAuthUserId,
        rol_id: cashierRole.id,
      });
      if (cashierUserRoleError) {
        throw new Error(`No se pudo asignar rol cajero: ${cashierUserRoleError.message}`);
      }

      const { error: cashierSucursalError } = await adminDb.from('usuario_sucursal').insert({
        usuario_id: cashierAuthUserId,
        sucursal_id: sucursalPrincipalId,
      });
      if (cashierSucursalError && cashierSucursalError.code !== '23505') {
        throw new Error(`No se pudo asignar sucursal al cajero: ${cashierSucursalError.message}`);
      }

      const { error: cashierCredError } = await adminDb.from('usuario_credencial_local').insert({
        usuario_id: cashierAuthUserId,
        tenant_id: tenantId,
        username_local: candidateUsername,
        pin_hash: candidatePinHash,
        pin_temporal: true,
        activo: true,
      });
      if (cashierCredError) {
        throw new Error(`No se pudo crear credencial local del cajero: ${cashierCredError.message}`);
      }

      cashierUsername = candidateUsername;
      cashierPin = candidatePin;
      break;
    }

    if (!cashierAuthUserId || !cashierUsername || !cashierPin) {
      throw new Error('No se pudo crear el usuario cajero por defecto.');
    }

    const { data: cajaCajeroAsignada, error: cajaCajeroAsignadaError } = await adminDb
      .from('caja')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('sucursal_id', sucursalPrincipalId)
      .eq('usuario_default_id', cashierAuthUserId)
      .order('numero', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (cajaCajeroAsignadaError) {
      throw new Error(`No se pudo validar caja del cajero: ${cajaCajeroAsignadaError.message}`);
    }

    if (!cajaCajeroAsignada?.id) {
      const { data: ultimaCaja } = await adminDb
        .from('caja')
        .select('numero')
        .eq('tenant_id', tenantId)
        .eq('sucursal_id', sucursalPrincipalId)
        .order('numero', { ascending: false })
        .limit(1)
        .maybeSingle();
      const numeroCajaNueva = Math.max(1, Number(ultimaCaja?.numero ?? 0) + 1);
      const nombreCajaCajero = `Caja ${cashierUsername}`;

      const { error: cajaNuevaErr } = await adminDb.from('caja').insert({
        tenant_id: tenantId,
        sucursal_id: sucursalPrincipalId,
        numero: numeroCajaNueva,
        nombre: nombreCajaCajero,
        usuario_default_id: cashierAuthUserId,
        activa: true,
      });
      if (cajaNuevaErr) {
        throw new Error(`No se pudo crear caja para el cajero: ${cajaNuevaErr.message}`);
      }
    }

    return {
      bootstrapCredentials: {
        username: cashierUsername,
        pin: cashierPin,
        tipo: 'cajero_default',
      },
    };
  } catch (err) {
    if (cashierAuthUserId) {
      await supabase.auth.admin.deleteUser(cashierAuthUserId);
    }
    if (tenantId) {
      await supabase.from('tenant').delete().eq('id', tenantId);
    }

    throw err;
  }
}
