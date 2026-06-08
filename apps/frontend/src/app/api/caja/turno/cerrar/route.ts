import { NextResponse } from 'next/server';

import { getTenantSession, rejectIfVisor } from '@/lib/api/tenant-session';
import { normalizarCaja } from '@/lib/caja/cierre-z-calculo';
import { persistCierreZDiarioSesion } from '@/lib/caja/persist-cierre-z-diario-sesion';
import { obtenerAperturaVigente } from '@/lib/caja/sesion-caja';
import { cajaUuidComoCajaIdText } from '@/lib/caja/turno-caja';
import { moduloGuard } from '@/lib/modulos/guard';

type CerrarBody = {
  efectivo_contado?: number | string | null;
  gastos_monto?: number | string | null;
  gastos_detalle?: string | null;
  gastos_items?: unknown;
  jornada?: string | null;
  origen_ui?: string | null;
  /** Cierra con efectivo contado = esperado sistema si ya cumplió `caja.auto_cierre_horas` desde `abierto_at`. */
  cierre_automatico_horas?: boolean;
  /**
   * Imputa efectivo contado según sistema (movimientos registrados); no exige declaración manual del operador.
   * Pensado para cierres rápidos o resolver bloqueos; el usuario asume coincidencia con la gaveta.
   */
  usar_efectivo_esperado_del_sistema?: boolean;
};

export async function POST(request: Request) {
  const guard = await moduloGuard('facturador_pos');
  if (!guard.allowed) return guard.response;

  const session = await getTenantSession();
  if ('error' in session) return session.error;
  const forbidden = rejectIfVisor(session.rol);
  if (forbidden) return forbidden;

  let body: CerrarBody;
  try {
    body = (await request.json()) as CerrarBody;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const db = session.supabase as any;

  const { data: turno, error: turnoErr } = await db
    .from('caja_turno')
    .select('id, caja_id, tenant_id, abierto_at')
    .eq('tenant_id', session.tenantId)
    .eq('usuario_id', session.userId)
    .eq('estado', 'abierto')
    .maybeSingle();

  if (turnoErr) return NextResponse.json({ error: turnoErr.message }, { status: 500 });
  if (!turno) {
    return NextResponse.json({ error: 'No hay turno de caja abierto.' }, { status: 404 });
  }

  const { data: caja, error: cajaErr } = await db
    .from('caja')
    .select('id, sucursal_id, nombre, numero, auto_cierre_horas')
    .eq('id', turno.caja_id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (cajaErr) return NextResponse.json({ error: cajaErr.message }, { status: 500 });
  if (!caja) {
    return NextResponse.json({ error: 'Caja del turno no encontrada.' }, { status: 404 });
  }

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
          'No hay sesión de caja abierta vinculada a este turno. Abrí turno desde el POS o registrá apertura en Cierre de caja.',
      },
      { status: 400 },
    );
  }

  const fechaOperativa = String(ap.fecha_operativa);
  const rangoDesde = ap.opened_at;
  let rangoHasta = new Date().toISOString();
  const tDesdePost = new Date(rangoDesde).getTime();
  const tHastaPost = new Date(rangoHasta).getTime();
  if (Number.isFinite(tDesdePost) && Number.isFinite(tHastaPost) && tHastaPost < tDesdePost) {
    rangoHasta = new Date(tDesdePost + 1000).toISOString();
  }
  const fondoApertura = ap.fondo_efectivo;
  const sesionAperturaId = ap.id;

  const cierreAutomaticoHoras = body.cierre_automatico_horas === true;
  const cerrarIgualEsperadoSistema = body.usar_efectivo_esperado_del_sistema === true;
  if (cierreAutomaticoHoras && cerrarIgualEsperadoSistema) {
    return NextResponse.json(
      { error: 'Elegí un solo modo de cierre: automático por horas o efectivo igual al sistema.' },
      { status: 400 },
    );
  }

  const usarEsperadoSistemaSinConteoManual = cierreAutomaticoHoras || cerrarIgualEsperadoSistema;

  if (cierreAutomaticoHoras) {
    const horasCfg = (caja as { auto_cierre_horas?: number | null }).auto_cierre_horas;
    if (horasCfg == null || !Number.isInteger(horasCfg) || horasCfg < 1) {
      return NextResponse.json(
        { error: 'Esta caja no tiene activado el cierre automático por horas.' },
        { status: 400 },
      );
    }
    const abiertoMs = new Date(String((turno as { abierto_at?: string }).abierto_at)).getTime();
    if (!Number.isFinite(abiertoMs)) {
      return NextResponse.json({ error: 'No se pudo leer la hora de apertura del turno.' }, { status: 400 });
    }
    const limiteMs = abiertoMs + horasCfg * 3600 * 1000;
    if (Date.now() < limiteMs) {
      const restanteMin = Math.ceil((limiteMs - Date.now()) / 60000);
      return NextResponse.json(
        {
          error: `El cierre automático está disponible en ${restanteMin} min (desde la apertura del turno).`,
        },
        { status: 400 },
      );
    }
  }

  const bodyPersist: CerrarBody = {
    ...body,
    origen_ui: cierreAutomaticoHoras
      ? 'auto_cierre_horas'
      : cerrarIgualEsperadoSistema
        ? 'efectivo_igual_sistema_operador'
        : body.origen_ui,
  };

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
    body: bodyPersist,
    payloadOrigen: 'api/caja/turno/cerrar',
    usarEfectivoEsperadoComoContado: usarEsperadoSistemaSinConteoManual,
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
      sucursal_id: caja.sucursal_id,
      snapshot: persisted.snapshot,
      arqueo_efectivo: persisted.arqueo_efectivo,
      ticket_resumen: persisted.ticket_resumen,
      turno_id: turno.id,
    },
    { status: 201 },
  );
}
