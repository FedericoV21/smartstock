import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  NEXUS_DASHBOARD_COOKIE,
  verifyNexusDashboardSession,
} from '@/lib/nexus-dashboard/auth-cookie';
import { proximoCorteMensualIso } from '@/lib/nexus-dashboard/proximo-corte-mensual';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

type PlanTipo = Database['public']['Enums']['plan_tipo'];

type UsuarioRow = {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  activo: boolean;
  created_at: string;
  tenant_id: string;
  rol: Database['public']['Enums']['rol_usuario'];
  tenant: {
    id: string;
    nombre: string;
    plan: PlanTipo;
    plan_cambiado_en?: string | null;
    ia_ilimitada_origen: string | null;
    activo: boolean;
    created_at: string;
    mensualidad_corte_dia: number | null;
    ginkgo_monto_abonado?: number | null;
    ginkgo_porcentaje?: number | null;
    ginkgo_facturacion_actualizada_en?: string | null;
  };
};

function unauthorized() {
  return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
}

async function requireNexusCookie() {
  const jar = await cookies();
  if (!verifyNexusDashboardSession(jar.get(NEXUS_DASHBOARD_COOKIE)?.value)) {
    return unauthorized();
  }
  return null;
}

function dedupeTenantCreators(rows: UsuarioRow[]): UsuarioRow[] {
  const seen = new Set<string>();
  const out: UsuarioRow[] = [];
  for (const row of rows) {
    if (seen.has(row.tenant_id)) continue;
    seen.add(row.tenant_id);
    out.push(row);
  }
  return out;
}

export async function GET(request: Request) {
  const gate = await requireNexusCookie();
  if (gate) return gate;

  const { searchParams } = new URL(request.url);
  const soloActivos = searchParams.get('soloActivos') === '1';
  const soloCicloMensualActivo = searchParams.get('cicloActivo') === '1';
  const planParam = searchParams.get('plan');
  const filtroPlan =
    planParam === 'plan0' ||
    planParam === 'base' ||
    planParam === 'intermedio' ||
    planParam === 'completo'
      ? (planParam as PlanTipo)
      : null;

  const admin = createServiceRoleClient();
  const usuariosSelect = (includePlanCambiado: boolean, includeGinkgoFacturacion: boolean) => `
      id,
      email,
      nombre,
      apellido,
      activo,
      created_at,
      tenant_id,
      rol,
      tenant:tenant_id (
        id,
        nombre,
        plan,
        ${includePlanCambiado ? 'plan_cambiado_en,' : ''}
        ia_ilimitada_origen,
        activo,
        created_at,
        mensualidad_corte_dia
        ${
          includeGinkgoFacturacion
            ? `,
        ginkgo_monto_abonado,
        ginkgo_porcentaje,
        ginkgo_facturacion_actualizada_en`
            : ''
        }
      )
    `;
  const fetchCreators = (includePlanCambiado: boolean, includeGinkgoFacturacion: boolean) =>
    admin
      .from('usuario')
      .select(usuariosSelect(includePlanCambiado, includeGinkgoFacturacion))
      .eq('rol', 'admin')
      .eq('es_prueba', false)
      .order('created_at', { ascending: true });

  let { data, error } = await fetchCreators(true, true);
  if (error && error.message.includes('plan_cambiado_en')) {
    ({ data, error } = await fetchCreators(false, true));
  }
  if (
    error &&
    (error.message.includes('ginkgo_monto_abonado') ||
      error.message.includes('ginkgo_porcentaje') ||
      error.message.includes('ginkgo_facturacion_actualizada_en'))
  ) {
    ({ data, error } = await fetchCreators(true, false));
    if (error && error.message.includes('plan_cambiado_en')) {
      ({ data, error } = await fetchCreators(false, false));
    }
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = (data ?? []) as unknown as UsuarioRow[];
  let creators = dedupeTenantCreators(raw);

  if (soloActivos) {
    creators = creators.filter((r) => r.activo && r.tenant?.activo);
  }

  if (soloCicloMensualActivo) {
    creators = creators.filter((r) => {
      const dia = r.tenant?.mensualidad_corte_dia;
      return dia != null && dia >= 1 && dia <= 28;
    });
  }

  if (filtroPlan) {
    creators = creators.filter((r) => r.tenant?.plan === filtroPlan);
  }

  creators.sort(
    (a, b) => new Date(b.tenant.created_at).getTime() - new Date(a.tenant.created_at).getTime()
  );

  const tenantIds = creators.map((r) => r.tenant_id);
  const sucursalesPorTenant = new Map<string, number>();
  if (tenantIds.length > 0) {
    const { data: sucursales, error: sucErr } = await admin
      .from('sucursal')
      .select('tenant_id')
      .in('tenant_id', tenantIds);
    if (sucErr) {
      return NextResponse.json({ error: sucErr.message }, { status: 500 });
    }
    for (const s of (sucursales ?? []) as { tenant_id: string }[]) {
      sucursalesPorTenant.set(s.tenant_id, (sucursalesPorTenant.get(s.tenant_id) ?? 0) + 1);
    }
  }

  const payload = creators.map((r) => {
    const dia = r.tenant.mensualidad_corte_dia;
    const mensualidadProximoCorte =
      dia != null && dia >= 1 && dia <= 28 ? proximoCorteMensualIso(dia) : null;
    return {
      usuarioId: r.id,
      tenantId: r.tenant_id,
      email: r.email,
      nombreCompleto: `${r.nombre} ${r.apellido}`.trim(),
      negocioNombre: r.tenant.nombre,
      plan: r.tenant.plan,
      planCambiadoEn: r.tenant.plan_cambiado_en ?? null,
      iaIlimitadaOrigen: r.tenant.ia_ilimitada_origen,
      sucursales: sucursalesPorTenant.get(r.tenant_id) ?? 0,
      fechaUnion: r.created_at,
      tenantCreadoEn: r.tenant.created_at,
      usuarioActivo: r.activo,
      tenantActivo: r.tenant.activo,
      mensualidadCorteDia: dia,
      mensualidadProximoCorte,
      ginkgoMontoAbonado: r.tenant.ginkgo_monto_abonado ?? null,
      ginkgoPorcentaje: r.tenant.ginkgo_porcentaje ?? null,
      ginkgoFacturacionActualizadaEn: r.tenant.ginkgo_facturacion_actualizada_en ?? null,
    };
  });

  return NextResponse.json({ rows: payload });
}

export async function PATCH(request: Request) {
  const gate = await requireNexusCookie();
  if (gate) return gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido.' }, { status: 400 });
  }

  const b = body as {
    tenantId?: unknown;
    usuarioId?: unknown;
    plan?: unknown;
    iaIlimitadaOrigen?: unknown;
    usuarioActivo?: unknown;
    mensualidadCorteDia?: unknown;
    ginkgoMontoAbonado?: unknown;
    ginkgoPorcentaje?: unknown;
  };

  const tenantId = typeof b.tenantId === 'string' ? b.tenantId : null;
  const usuarioId = typeof b.usuarioId === 'string' ? b.usuarioId : null;

  if (!tenantId || !usuarioId) {
    return NextResponse.json({ error: 'tenantId y usuarioId son obligatorios.' }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  const { data: usuario, error: uErr } = await admin
    .from('usuario')
    .select('id, tenant_id, rol')
    .eq('id', usuarioId)
    .maybeSingle();

  if (uErr || !usuario) {
    return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });
  }
  if (usuario.tenant_id !== tenantId) {
    return NextResponse.json({ error: 'El usuario no pertenece a ese negocio.' }, { status: 400 });
  }
  if (usuario.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo se puede operar sobre administradores.' }, { status: 400 });
  }

  if (b.plan !== undefined) {
    if (
      b.plan !== 'plan0' &&
      b.plan !== 'base' &&
      b.plan !== 'intermedio' &&
      b.plan !== 'completo'
    ) {
      return NextResponse.json({ error: 'plan inválido.' }, { status: 400 });
    }
    const { error: rpcErr } = await admin.rpc('activar_plan', {
      p_tenant_id: tenantId,
      p_plan: b.plan,
    });
    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }
  }

  if (b.iaIlimitadaOrigen !== undefined) {
    if (b.iaIlimitadaOrigen !== 'lector_factura' && b.iaIlimitadaOrigen !== 'ia_pdf') {
      return NextResponse.json({ error: 'iaIlimitadaOrigen inválido.' }, { status: 400 });
    }
    const { data: t, error: tErr2 } = await admin
      .from('tenant')
      .select('plan')
      .eq('id', tenantId)
      .maybeSingle();
    if (tErr2) return NextResponse.json({ error: tErr2.message }, { status: 500 });
    if ((t?.plan ?? 'base') !== 'intermedio') {
      return NextResponse.json(
        { error: 'Solo se puede configurar la IA ilimitada en plan intermedio.' },
        { status: 400 },
      );
    }
    const { error: upErr2 } = await admin
      .from('tenant')
      .update({ ia_ilimitada_origen: b.iaIlimitadaOrigen })
      .eq('id', tenantId);
    if (upErr2) {
      return NextResponse.json({ error: upErr2.message }, { status: 500 });
    }
  }

  if (b.usuarioActivo !== undefined) {
    if (typeof b.usuarioActivo !== 'boolean') {
      return NextResponse.json({ error: 'usuarioActivo debe ser booleano.' }, { status: 400 });
    }
    const { error: upErr } = await admin
      .from('usuario')
      .update({ activo: b.usuarioActivo })
      .eq('id', usuarioId)
      .eq('tenant_id', tenantId);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  if (b.mensualidadCorteDia !== undefined) {
    if (b.mensualidadCorteDia !== null) {
      if (
        typeof b.mensualidadCorteDia !== 'number' ||
        !Number.isInteger(b.mensualidadCorteDia) ||
        b.mensualidadCorteDia < 1 ||
        b.mensualidadCorteDia > 28
      ) {
        return NextResponse.json(
          { error: 'mensualidadCorteDia debe ser null o un entero entre 1 y 28.' },
          { status: 400 }
        );
      }
    }
    const { error: tErr } = await admin
      .from('tenant')
      .update({ mensualidad_corte_dia: b.mensualidadCorteDia })
      .eq('id', tenantId);
    if (tErr) {
      return NextResponse.json({ error: tErr.message }, { status: 500 });
    }
  }

  if (b.ginkgoMontoAbonado !== undefined || b.ginkgoPorcentaje !== undefined) {
    const ginkgoMontoAbonado = b.ginkgoMontoAbonado;
    const ginkgoPorcentaje = b.ginkgoPorcentaje;

    if (ginkgoMontoAbonado !== undefined && ginkgoMontoAbonado !== null) {
      if (
        typeof ginkgoMontoAbonado !== 'number' ||
        !Number.isFinite(ginkgoMontoAbonado) ||
        ginkgoMontoAbonado < 0
      ) {
        return NextResponse.json(
          { error: 'ginkgoMontoAbonado debe ser null o un numero mayor o igual a 0.' },
          { status: 400 }
        );
      }
    }

    if (ginkgoPorcentaje !== undefined && ginkgoPorcentaje !== null) {
      if (
        typeof ginkgoPorcentaje !== 'number' ||
        !Number.isFinite(ginkgoPorcentaje) ||
        ginkgoPorcentaje < 0 ||
        ginkgoPorcentaje > 100
      ) {
        return NextResponse.json(
          { error: 'ginkgoPorcentaje debe ser null o un numero entre 0 y 100.' },
          { status: 400 }
        );
      }
    }

    const update: Database['public']['Tables']['tenant']['Update'] = {
      ginkgo_facturacion_actualizada_en: new Date().toISOString(),
    };
    if (ginkgoMontoAbonado !== undefined) update.ginkgo_monto_abonado = ginkgoMontoAbonado;
    if (ginkgoPorcentaje !== undefined) update.ginkgo_porcentaje = ginkgoPorcentaje;

    const { error: upErr } = await admin.from('tenant').update(update).eq('id', tenantId);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  if (
    b.plan === undefined &&
    b.iaIlimitadaOrigen === undefined &&
    b.usuarioActivo === undefined &&
    b.mensualidadCorteDia === undefined &&
    b.ginkgoMontoAbonado === undefined &&
    b.ginkgoPorcentaje === undefined
  ) {
    return NextResponse.json({ error: 'Nada que actualizar.' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
