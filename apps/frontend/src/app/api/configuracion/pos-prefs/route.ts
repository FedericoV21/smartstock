import { NextResponse } from 'next/server';

import { hasPermission } from '@/lib/api/permissions';
import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  clampPosPrefsForArca,
  effectivePosPrefsFromRows,
  finalizePosPrefsForStorage,
  normalizePosPrefs,
  posPrefsSucursalDiffForStorage,
  posPrefsSucursalParaGuardar,
  sucursalTieneOverrideBalanza,
  type PosPrefs,
} from '@/lib/pos/prefs';
import {
  resolveEmisorTicket,
  type SucursalEmisorTicket,
  type TenantEmisorTicket,
} from '@/lib/sucursal/emisor-ticket';
import type { Database } from '@/types/database';

const TENANT_EMISOR_SELECT =
  'pos_prefs, nombre, razon_social, cuit, domicilio, telefono, horarios_atencion, email, logo_url';
const SUCURSAL_TICKET_SELECT =
  'pos_prefs, nombre, direccion, hereda_datos_ticket, razon_social, cuit, telefono, horarios_atencion, email';

function mapTenantEmisorTicket(row: Record<string, unknown>): TenantEmisorTicket {
  return {
    nombre: String(row.nombre ?? ''),
    razon_social: (row.razon_social as string | null) ?? null,
    cuit: (row.cuit as string | null) ?? null,
    domicilio: (row.domicilio as string | null) ?? null,
    logo_url: (row.logo_url as string | null) ?? null,
  };
}

function mapSucursalEmisorTicket(row: Record<string, unknown>): SucursalEmisorTicket {
  return {
    nombre: String(row.nombre ?? ''),
    direccion: (row.direccion as string | null) ?? null,
    hereda_datos_ticket: row.hereda_datos_ticket !== false,
    razon_social: (row.razon_social as string | null) ?? null,
    cuit: (row.cuit as string | null) ?? null,
    telefono: (row.telefono as string | null) ?? null,
    horarios_atencion: (row.horarios_atencion as string | null) ?? null,
    email: (row.email as string | null) ?? null,
  };
}

function isPosPrefsPayload(v: unknown): v is Partial<PosPrefs> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = [
    'sonidos',
    'anchoTicket',
    'stockBloqueante',
    'aceptaTicket',
    'aceptaFactura',
    'comprobantePredeterminado',
    'posPermiteCrearProductos',
    'posCrearProductosSoloAdmin',
    'balanzaTemplate',
    'balanzaTemplates',
    'balanzaUnidadTemplate',
    'balanzaImporteTemplate',
    'pvpRedondeoCentenasArriba',
    'pvpRedondeoMenores100ADecenas',
    'posMostrarCategoria',
    'posMostrarRubro',
    'posMostrarGananciaTramos',
    'posMostrarStock',
    'posMostrarCodigoBarras',
    'balanzaConfigPorSucursal',
  ];
  return keys.some((k) => k in o);
}

async function arcaModuloActivoForTenant(db: any, tenantId: string): Promise<boolean> {
  const { data: moduloRow } = await db
    .from('modulo_config')
    .select('facturador_arca')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const arcaModuloActivo = !!(moduloRow && (moduloRow as { facturador_arca?: boolean }).facturador_arca);
  return !!tenantId && arcaModuloActivo;
}

async function arcaConfiguradoForSucursal(db: any, tenantId: string, sucursalId: string | null): Promise<boolean> {
  const moduloActivo = await arcaModuloActivoForTenant(db, tenantId);
  if (!moduloActivo) return false;
  if (!sucursalId) return false;
  const { data: arcaRow } = await db
    .from('arca_config')
    .select('certificado_pem, clave_privada_pem, cuit_emisor, punto_de_venta')
    .eq('tenant_id', tenantId)
    .eq('sucursal_id', sucursalId)
    .maybeSingle();
  return !!(
    arcaRow?.certificado_pem &&
    arcaRow?.clave_privada_pem &&
    arcaRow?.cuit_emisor &&
    arcaRow?.punto_de_venta != null
  );
}

function filaArcaCompleta(row: {
  certificado_pem?: unknown;
  clave_privada_pem?: unknown;
  cuit_emisor?: unknown;
  punto_de_venta?: unknown;
}): boolean {
  return !!(
    row.certificado_pem &&
    row.clave_privada_pem &&
    row.cuit_emisor &&
    row.punto_de_venta != null
  );
}

/** True si al menos una sucursal del tenant tiene ARCA listo (defaults del negocio en config POS). */
async function arcaConfiguradoAlgunaSucursal(db: any, tenantId: string): Promise<boolean> {
  if (!(await arcaModuloActivoForTenant(db, tenantId))) return false;
  const { data: rows } = await db
    .from('arca_config')
    .select('certificado_pem, clave_privada_pem, cuit_emisor, punto_de_venta')
    .eq('tenant_id', tenantId);
  return !!(rows && rows.some((r: Record<string, unknown>) => filaArcaCompleta(r)));
}

/**
 * GET:
 * - Sin `for_config`: alcance operativo (`sucursal_id` opcional en query; si falta, default del usuario).
 * - `for_config=1`: pantalla de configuración; sin `sucursal_id` = solo defaults del tenant; con `sucursal_id` = merge de esa sucursal.
 */
export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const url = new URL(request.url);
  const forConfig = url.searchParams.get('for_config') === '1';
  const requestedSucursalId = url.searchParams.get('sucursal_id')?.trim() || null;

  const db = createServiceRoleClient() as any;

  const { data: tenantRow, error: tErr } = await db
    .from('tenant')
    .select(TENANT_EMISOR_SELECT)
    .eq('id', session.tenantId)
    .single();
  if (tErr || !tenantRow) {
    return NextResponse.json({ error: tErr?.message ?? 'Tenant no encontrado' }, { status: 500 });
  }

  const tenantNorm = normalizePosPrefs(
    tenantRow.pos_prefs && typeof tenantRow.pos_prefs === 'object' && !Array.isArray(tenantRow.pos_prefs)
      ? (tenantRow.pos_prefs as Partial<PosPrefs>)
      : {},
  );
  const tenantEmisor = mapTenantEmisorTicket(tenantRow as Record<string, unknown>);

  if (forConfig) {
    let sucursalPosPrefs: unknown | null = null;
    let outSucursalId: string | null = null;
    let sucursalEmisor: SucursalEmisorTicket | null = null;
    if (requestedSucursalId) {
      const { data: sRow, error: sErr } = await db
        .from('sucursal')
        .select(SUCURSAL_TICKET_SELECT)
        .eq('id', requestedSucursalId)
        .eq('tenant_id', session.tenantId)
        .maybeSingle();
      if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
      if (!sRow) {
        return NextResponse.json({ error: 'Sucursal no encontrada.' }, { status: 404 });
      }
      outSucursalId = requestedSucursalId;
      sucursalPosPrefs = sRow.pos_prefs ?? null;
      sucursalEmisor = mapSucursalEmisorTicket(sRow as Record<string, unknown>);
    }
    const arcaOk = outSucursalId
      ? await arcaConfiguradoForSucursal(db, session.tenantId, outSucursalId)
      : await arcaConfiguradoAlgunaSucursal(db, session.tenantId);
    const rawEffective = effectivePosPrefsFromRows(
      tenantRow.pos_prefs,
      outSucursalId ? sucursalPosPrefs : null,
    );
    const effective = clampPosPrefsForArca(rawEffective, arcaOk);
    const emisor_ticket = resolveEmisorTicket(tenantEmisor, sucursalEmisor);
    return NextResponse.json({
      arca_configurado: arcaOk,
      sucursal_id: outSucursalId,
      tenant_pos_prefs: tenantNorm,
      sucursal_pos_prefs: outSucursalId ? sucursalPosPrefs : null,
      effective_pos_prefs: effective,
      emisor_ticket,
    });
  }

  const scope = await resolveAndValidateSucursalScope(session, requestedSucursalId);
  if (!scope.ok) return scope.response;
  const sucursalId = scope.sucursalId;

  const arcaOk = await arcaConfiguradoForSucursal(db, session.tenantId, sucursalId);
  let sucursalPosPrefs: unknown | null = null;
  let sucursalEmisor: SucursalEmisorTicket | null = null;
  if (sucursalId) {
    const { data: sRow, error: sErr } = await db
      .from('sucursal')
      .select(SUCURSAL_TICKET_SELECT)
      .eq('id', sucursalId)
      .eq('tenant_id', session.tenantId)
      .maybeSingle();
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
    sucursalPosPrefs = sRow?.pos_prefs ?? null;
    if (sRow) sucursalEmisor = mapSucursalEmisorTicket(sRow as Record<string, unknown>);
  }

  const rawEffective = effectivePosPrefsFromRows(tenantRow.pos_prefs, sucursalPosPrefs);
  const effective = clampPosPrefsForArca(rawEffective, arcaOk);
  const emisor_ticket = resolveEmisorTicket(tenantEmisor, sucursalEmisor);

  return NextResponse.json({
    arca_configurado: arcaOk,
    sucursal_id: sucursalId,
    tenant_pos_prefs: tenantNorm,
    sucursal_pos_prefs: sucursalPosPrefs,
    effective_pos_prefs: effective,
    emisor_ticket,
  });
}

/**
 * PATCH:
 * - `{ "scope": "tenant", "pos_prefs": { ... } }` — admin; defaults del negocio.
 * - `{ "sucursal_id": "uuid", "pos_prefs": { ... } }` — admin o permiso sucursales.gestionar.
 * - `{ "sucursal_id": "uuid", "inherit_from_tenant": true }` — borra prefs de sucursal (hereda).
 */
export async function PATCH(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const db = createServiceRoleClient() as any;

  if (b.scope === 'tenant') {
    if (session.rol !== 'admin' && !session.isSuperAdmin) {
      return NextResponse.json({ error: 'Solo el administrador puede editar los defaults del negocio.' }, { status: 403 });
    }
    if (!isPosPrefsPayload(b.pos_prefs)) {
      return NextResponse.json({ error: 'pos_prefs inválido.' }, { status: 400 });
    }
    const arcaOkTenant = await arcaConfiguradoAlgunaSucursal(db, session.tenantId);
    const normalized = finalizePosPrefsForStorage(
      clampPosPrefsForArca(normalizePosPrefs(b.pos_prefs as Partial<PosPrefs>), arcaOkTenant),
    );
    const { error } = await db
      .from('tenant')
      .update({ pos_prefs: normalized as Database['public']['Tables']['tenant']['Update']['pos_prefs'] })
      .eq('id', session.tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, pos_prefs: normalized });
  }

  const sucursalId = typeof b.sucursal_id === 'string' ? b.sucursal_id.trim() : '';
  if (!sucursalId) {
    return NextResponse.json(
      { error: 'Usá scope "tenant" + pos_prefs, o sucursal_id + pos_prefs / inherit_from_tenant.' },
      { status: 400 },
    );
  }

  const hasBranchPermission = await hasPermission(session.supabase, 'sucursales.gestionar', {
    rol: session.rol,
    isSuperAdmin: session.isSuperAdmin,
  });
  const canManageBranches = session.isSuperAdmin || session.rol === 'admin' || hasBranchPermission;
  if (!canManageBranches) {
    return NextResponse.json({ error: 'Sin permisos para editar sucursales.' }, { status: 403 });
  }

  const { data: sucursal, error: findErr } = await db
    .from('sucursal')
    .select('id, tenant_id')
    .eq('id', sucursalId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (findErr || !sucursal) {
    return NextResponse.json({ error: 'Sucursal no encontrada.' }, { status: 404 });
  }

  if (b.inherit_from_tenant === true) {
    const { error } = await db.from('sucursal').update({ pos_prefs: null }).eq('id', sucursalId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, pos_prefs: null });
  }

  if (!isPosPrefsPayload(b.pos_prefs)) {
    return NextResponse.json({ error: 'pos_prefs inválido.' }, { status: 400 });
  }

  const { data: tenantRow } = await db.from('tenant').select('pos_prefs').eq('id', session.tenantId).single();
  const tenantNorm = finalizePosPrefsForStorage(
    normalizePosPrefs(
      tenantRow?.pos_prefs &&
        typeof tenantRow.pos_prefs === 'object' &&
        !Array.isArray(tenantRow.pos_prefs)
        ? (tenantRow.pos_prefs as Partial<PosPrefs>)
        : {},
    ),
  );
  let tenantNormLive = tenantNorm;
  const merged = posPrefsSucursalParaGuardar(tenantNormLive, b.pos_prefs as Partial<PosPrefs>);
  const arcaOkSucursal = await arcaConfiguradoForSucursal(db, session.tenantId, sucursalId);
  const normalized = finalizePosPrefsForStorage(clampPosPrefsForArca(merged, arcaOkSucursal));
  const balanzaOverride = sucursalTieneOverrideBalanza(tenantNormLive, normalized);

  if (balanzaOverride && !tenantNormLive.balanzaConfigPorSucursal) {
    tenantNormLive = finalizePosPrefsForStorage({
      ...tenantNormLive,
      balanzaConfigPorSucursal: true,
    });
    const { error: tenantFlagErr } = await db
      .from('tenant')
      .update({
        pos_prefs: tenantNormLive as Database['public']['Tables']['tenant']['Update']['pos_prefs'],
      })
      .eq('id', session.tenantId);
    if (tenantFlagErr) {
      return NextResponse.json({ error: tenantFlagErr.message }, { status: 400 });
    }
  }

  const valueToStore = posPrefsSucursalDiffForStorage(tenantNormLive, normalized);

  if (valueToStore === null && balanzaOverride) {
    return NextResponse.json(
      {
        error:
          'La plantilla de balanza no se pudo guardar (quedó igual al negocio tras validar). Revisá el formato (8-14 caracteres; peso con X y A).',
        inherited: true,
        balanza_override: true,
      },
      { status: 400 },
    );
  }

  const { error } = await db
    .from('sucursal')
    .update({ pos_prefs: valueToStore as Database['public']['Tables']['sucursal']['Update']['pos_prefs'] })
    .eq('id', sucursalId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const effectiveAfter = effectivePosPrefsFromRows(tenantNormLive, valueToStore);
  return NextResponse.json({
    ok: true,
    pos_prefs: valueToStore,
    inherited: valueToStore === null,
    balanza_override: balanzaOverride,
    balanza_config_por_sucursal: tenantNormLive.balanzaConfigPorSucursal === true,
    effective_balanza_templates: effectiveAfter.balanzaTemplates,
  });
}
