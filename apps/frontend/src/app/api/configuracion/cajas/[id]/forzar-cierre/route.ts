import { NextResponse } from 'next/server';

import { puedeGestionarEstructuraCajas } from '@/lib/api/cajas-config-permissions';
import { idsSucursalesOperables } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import {
  finDiaOperativoArgentinaIsoUtc,
  normalizarCaja,
} from '@/lib/caja/cierre-z-calculo';
import { persistCierreZDiarioSesion } from '@/lib/caja/persist-cierre-z-diario-sesion';
import { obtenerAperturaVigente } from '@/lib/caja/sesion-caja';
import { cajaUuidComoCajaIdText } from '@/lib/caja/turno-caja';
import { createServiceRoleClient } from '@/lib/supabase/server';

/** Cierre administrativo: imputa efectivo contado = esperado por el sistema (sin arqueo real del operador). */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  if (!(await puedeGestionarEstructuraCajas(session))) {
    return NextResponse.json({ error: 'Sin permisos para gestionar cajas.' }, { status: 403 });
  }

  const { id: rawId } = await ctx.params;
  const id = String(rawId ?? '').trim();
  if (!id) {
    return NextResponse.json({ error: 'id inválido' }, { status: 400 });
  }

  const db = createServiceRoleClient() as any;

  const { data: row, error: fErr } = await db
    .from('caja')
    .select('id, tenant_id, sucursal_id, numero')
    .eq('id', id)
    .maybeSingle();

  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  if (!row || row.tenant_id !== session.tenantId) {
    return NextResponse.json({ error: 'Caja no encontrada.' }, { status: 404 });
  }

  const operables = await idsSucursalesOperables(session);
  if (!operables.ok) return operables.response;
  if (!operables.ids.includes(String(row.sucursal_id))) {
    return NextResponse.json({ error: 'No podés operar sobre cajas de esa sucursal.' }, { status: 403 });
  }

  const { data: turno, error: tErr } = await db
    .from('caja_turno')
    .select('id, caja_id, tenant_id')
    .eq('tenant_id', session.tenantId)
    .eq('caja_id', id)
    .eq('estado', 'abierto')
    .maybeSingle();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  if (!turno) {
    return NextResponse.json({ error: 'Esta caja no tiene ningún turno abierto.' }, { status: 404 });
  }

  const { data: caja, error: cajaErr } = await db
    .from('caja')
    .select('id, sucursal_id, nombre, numero')
    .eq('id', id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (cajaErr) return NextResponse.json({ error: cajaErr.message }, { status: 500 });
  if (!caja) return NextResponse.json({ error: 'Caja del turno no encontrada.' }, { status: 404 });

  const cajaIdText = normalizarCaja(cajaUuidComoCajaIdText(caja.id));

  let ap: Awaited<ReturnType<typeof obtenerAperturaVigente>>;
  try {
    ap = await obtenerAperturaVigente(db, cajaIdText, caja.sucursal_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al resolver sesión';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  if (!ap) {
    return NextResponse.json(
      {
        error:
          'No hay sesión de caja abierta (apertura) vinculada a este turno. Revisá Cierre de caja o soporte antes de forzar.',
      },
      { status: 400 },
    );
  }

  const fechaOperativa = String(ap.fecha_operativa);
  const rangoDesde = ap.opened_at;
  let rangoHasta = finDiaOperativoArgentinaIsoUtc(fechaOperativa);
  const tDesdePost = new Date(rangoDesde).getTime();
  const tHastaPost = new Date(rangoHasta).getTime();
  if (Number.isFinite(tDesdePost) && Number.isFinite(tHastaPost) && tDesdePost > tHastaPost) {
    rangoHasta = new Date(tDesdePost + 1000).toISOString();
  }
  const fondoApertura = ap.fondo_efectivo;
  const sesionAperturaId = ap.id;

  const persisted = await persistCierreZDiarioSesion({
    supabase: db,
    tenantId: session.tenantId,
    userId: session.userId,
    sucursalId: caja.sucursal_id,
    cajaIdNormalizada: cajaIdText,
    sesionAperturaId,
    fechaOperativa,
    rangoDesde,
    rangoHasta,
    fondoApertura,
    modoPeriodo: 'sesion_apertura',
    body: { origen_ui: 'config_forzar_cierre_admin' },
    payloadOrigen: 'api/configuracion/cajas/forzar-cierre',
    usarEfectivoEsperadoComoContado: true,
  });

  if (!persisted.ok) {
    return NextResponse.json({ error: persisted.error }, { status: persisted.status });
  }

  const cerradoAt = new Date().toISOString();
  const { error: updErr } = await db
    .from('caja_turno')
    .update({
      estado: 'cerrado',
      cerrado_at: cerradoAt,
      cierre_z_id: persisted.cierre_id,
    })
    .eq('id', turno.id)
    .eq('estado', 'abierto');

  if (updErr) {
    return NextResponse.json(
      {
        error: `El cierre Z se registró (${persisted.cierre_id}) pero no se pudo actualizar el turno: ${updErr.message}. Revisá con soporte.`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      cierre_id: persisted.cierre_id,
      turno_id: turno.id,
      sucursal_id: caja.sucursal_id,
      snapshot: persisted.snapshot,
      arqueo_efectivo: persisted.arqueo_efectivo,
      ticket_resumen: persisted.ticket_resumen,
    },
    { status: 201 },
  );
}
