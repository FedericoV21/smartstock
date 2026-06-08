import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { moduloGuardAny } from '@/lib/modulos/guard';
import { MODULOS_ACCESO_LECTOR_FACTURAS } from '@/lib/modulos/modulo-key';

function rejectUnlessAdmin(session: { rol: string; isSuperAdmin: boolean }) {
  if (session.isSuperAdmin || session.rol === 'admin') return null;
  return NextResponse.json({ error: 'Solo owner/admin puede gestionar reglas de sucursal.' }, { status: 403 });
}

export async function GET() {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const db = session.supabase as any;
  const [{ data: rules, error: rulesErr }, { data: sucursales, error: sucErr }] = await Promise.all([
    db
      .from('whatsapp_branch_rule')
      .select(
        'id, sucursal_id, from_wa_id, phone_number_id, prioridad, activa, created_at, sucursal(id, nombre, codigo, es_principal, activa)',
      )
      .eq('tenant_id', session.tenantId)
      .order('prioridad', { ascending: false })
      .order('created_at', { ascending: false }),
    db
      .from('sucursal')
      .select('id, nombre, codigo, es_principal, activa')
      .eq('tenant_id', session.tenantId)
      .eq('activa', true)
      .order('es_principal', { ascending: false })
      .order('nombre', { ascending: true }),
  ]);

  if (rulesErr) return NextResponse.json({ error: rulesErr.message }, { status: 500 });
  if (sucErr) return NextResponse.json({ error: sucErr.message }, { status: 500 });

  return NextResponse.json({
    rules: rules ?? [],
    sucursales: sucursales ?? [],
    can_manage: session.isSuperAdmin || session.rol === 'admin',
  });
}

export async function POST(request: Request) {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;
  const adminOnly = rejectUnlessAdmin(session);
  if (adminOnly) return adminOnly;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const sucursalId = String(b.sucursal_id ?? '').trim();
  if (!sucursalId) {
    return NextResponse.json({ error: 'sucursal_id es obligatorio' }, { status: 400 });
  }

  const fromWaIdRaw = String(b.from_wa_id ?? '').trim();
  const fromWaId = fromWaIdRaw.length > 0 ? fromWaIdRaw : null;
  const prioridad = Number(b.prioridad ?? 0);
  const activa = b.activa !== false;

  const db = session.supabase as any;
  const { data: sucursal, error: sucErr } = await db
    .from('sucursal')
    .select('id')
    .eq('tenant_id', session.tenantId)
    .eq('id', sucursalId)
    .eq('activa', true)
    .maybeSingle();
  if (sucErr) return NextResponse.json({ error: sucErr.message }, { status: 500 });
  if (!sucursal?.id) {
    return NextResponse.json({ error: 'Sucursal no encontrada o inactiva' }, { status: 400 });
  }

  const { data, error } = await db
    .from('whatsapp_branch_rule')
    .insert({
      tenant_id: session.tenantId,
      sucursal_id: sucursalId,
      from_wa_id: fromWaId,
      phone_number_id: null,
      proveedor_id: null,
      prioridad: Number.isFinite(prioridad) ? Math.trunc(prioridad) : 0,
      activa,
    })
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data?.id ?? null });
}

export async function DELETE(request: Request) {
  const guard = await moduloGuardAny([...MODULOS_ACCESO_LECTOR_FACTURAS, 'importador_excel']);
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;
  const adminOnly = rejectUnlessAdmin(session);
  if (adminOnly) return adminOnly;

  const id = new URL(request.url).searchParams.get('id')?.trim() ?? '';
  if (!id) return NextResponse.json({ error: 'id es obligatorio' }, { status: 400 });

  const db = session.supabase as any;
  const { error } = await db
    .from('whatsapp_branch_rule')
    .delete()
    .eq('id', id)
    .eq('tenant_id', session.tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
