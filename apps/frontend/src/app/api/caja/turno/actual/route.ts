import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { normalizeCajaPrefs } from '@/lib/caja/prefs';
import { moduloGuard } from '@/lib/modulos/guard';

export async function GET(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const { searchParams } = new URL(request.url);
  const scope = await resolveAndValidateSucursalScope(session, searchParams.get('sucursal_id'));
  if (!scope.ok) return scope.response;

  if (!scope.sucursalId) {
    return NextResponse.json({ turno: null }, { status: 200 });
  }

  const db = session.supabase as any;

  const { data: cajas, error: cajasErr } = await db
    .from('caja')
    .select('id')
    .eq('tenant_id', session.tenantId)
    .eq('sucursal_id', scope.sucursalId);

  if (cajasErr) return NextResponse.json({ error: cajasErr.message }, { status: 500 });

  const cajaIds = (cajas ?? []).map((c: { id: string }) => c.id);
  if (cajaIds.length === 0) {
    return NextResponse.json({ turno: null }, { status: 200 });
  }

  const { data: turno, error } = await db
    .from('caja_turno')
    .select('id, abierto_at, monto_inicial, estado, caja_id')
    .eq('tenant_id', session.tenantId)
    .eq('usuario_id', session.userId)
    .eq('estado', 'abierto')
    .in('caja_id', cajaIds)
    .order('abierto_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!turno) {
    return NextResponse.json({ turno: null }, { status: 200 });
  }

  const { data: caja } = await db
    .from('caja')
    .select('id, nombre, numero, sucursal_id, auto_cierre_horas, prefs')
    .eq('id', turno.caja_id)
    .maybeSingle();

  let sucursal_caja_label: string | null = null;
  const sid = caja?.sucursal_id ? String((caja as { sucursal_id?: string }).sucursal_id).trim() : '';
  if (sid) {
    const { data: sur } = await db
      .from('sucursal')
      .select('nombre, codigo')
      .eq('tenant_id', session.tenantId)
      .eq('id', sid)
      .maybeSingle();
    const srow = sur as { nombre?: string | null; codigo?: string | null } | null;
    const nom = typeof srow?.nombre === 'string' ? srow.nombre.trim() : '';
    const cod = typeof srow?.codigo === 'string' ? srow.codigo.trim() : '';
    if (nom || cod) {
      sucursal_caja_label = cod ? `${nom || 'Sucursal'} (${cod})` : nom;
    }
  }

  const achRaw = (caja as { auto_cierre_horas?: number | null }).auto_cierre_horas;
  const auto_cierre_horas_validado =
    typeof achRaw === 'number' && Number.isInteger(achRaw) && achRaw >= 1 ? achRaw : null;

  return NextResponse.json({
    turno: {
      id: turno.id,
      abierto_at: turno.abierto_at,
      monto_inicial: turno.monto_inicial,
      estado: turno.estado,
      caja: caja
        ? {
            id: caja.id,
            nombre: caja.nombre,
            numero: caja.numero,
            sucursal_id: caja.sucursal_id,
            sucursal_nombre:
              typeof sucursal_caja_label === 'string' && sucursal_caja_label.trim()
                ? sucursal_caja_label.trim()
                : null,
            auto_cierre_horas: auto_cierre_horas_validado,
            prefs: normalizeCajaPrefs((caja as { prefs?: unknown }).prefs),
          }
        : null,
    },
  });
}
