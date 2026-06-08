import { NextResponse } from 'next/server';

import { resolveAndValidateSucursalScope } from '@/lib/api/sucursal-scope';
import { getTenantSession } from '@/lib/api/tenant-session';
import { normalizarCaja } from '@/lib/caja/cierre-z-calculo';
import { listarAperturasPorFechaOperativa } from '@/lib/caja/listar-aperturas-dia';

type EventoHistorialCaja =
  | {
      tipo: 'apertura';
      id: string;
      at: string;
      fondo_efectivo: number;
      fecha_operativa: string;
    }
  | {
      tipo: 'cierre';
      id: string;
      at: string;
      caja_id: string;
      fecha_operativa: string;
      tipo_cierre: string;
      rango_desde: string;
      rango_hasta: string;
      total_comprobantes: number;
      ventas_netas: number;
      pagos_cta_cte_total: number;
      ventas_brutas: number;
      notas_credito_total: number;
      reciente_fuera_fecha?: boolean;
      payload_resumen: Record<string, unknown> | null;
      medios: { metodo_pago: string; monto_neto: number; cantidad_comprobantes: number }[];
    };

export async function GET(request: Request) {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const sp = new URL(request.url).searchParams;
  const sucursalScope = await resolveAndValidateSucursalScope(session, sp.get('sucursal_id'));
  if (!sucursalScope.ok) return sucursalScope.response;
  if (!sucursalScope.sucursalId) {
    return NextResponse.json({ error: 'No hay sucursal operativa seleccionada.' }, { status: 400 });
  }
  const fechaOperativa = (sp.get('fecha_operativa') || '').trim();
  if (!fechaOperativa) {
    return NextResponse.json({ error: 'fecha_operativa requerida' }, { status: 400 });
  }
  const cajaId = normalizarCaja(sp.get('caja_id'));
  const incluirUltimos = sp.get('incluir_ultimos') === '1';

  const sb = session.supabase as any;

  try {
    const aperturas = await listarAperturasPorFechaOperativa(sb, {
      fechaOperativa,
      cajaIdNormalizada: cajaId,
      sucursalId: sucursalScope.sucursalId,
    });

    let qCierres = sb
      .from('cierre_z')
      .select('*')
      .eq('fecha_operativa', fechaOperativa)
      .eq('sucursal_id', sucursalScope.sucursalId)
      .order('created_at', { ascending: false });
    if (cajaId && cajaId !== '__sin_caja__') {
      qCierres = qCierres.eq('caja_id', cajaId);
    } else {
      qCierres = qCierres.eq('caja_id', '__sin_caja__');
    }
    const { data: cierresRaw, error: cErr } = await qCierres;
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

    const cierresPorFecha = (cierresRaw ?? []) as Record<string, unknown>[];
    const cierres = [...cierresPorFecha];

    if (incluirUltimos) {
      let qUltimos = sb
        .from('cierre_z')
        .select('*')
        .eq('sucursal_id', sucursalScope.sucursalId)
        .order('created_at', { ascending: false })
        .limit(6);
      if (cajaId && cajaId !== '__sin_caja__') {
        qUltimos = qUltimos.eq('caja_id', cajaId);
      } else {
        qUltimos = qUltimos.eq('caja_id', '__sin_caja__');
      }
      const { data: ultimosRaw, error: ultErr } = await qUltimos;
      if (ultErr) return NextResponse.json({ error: ultErr.message }, { status: 500 });
      const seen = new Set(cierres.map((c) => String(c.id)));
      for (const c of (ultimosRaw ?? []) as Record<string, unknown>[]) {
        if (seen.has(String(c.id))) continue;
        cierres.push({ ...c, reciente_fuera_fecha: String(c.fecha_operativa) !== fechaOperativa });
        seen.add(String(c.id));
      }
    }

    const cierreIds = cierres.map((c) => String(c.id));
    const { data: mediosRows, error: medErr } = cierreIds.length
      ? await sb
          .from('cierre_z_medio_pago')
          .select('cierre_z_id, metodo_pago, monto_neto, cantidad_comprobantes')
          .in('cierre_z_id', cierreIds)
      : { data: [], error: null };
    if (medErr) return NextResponse.json({ error: medErr.message }, { status: 500 });
    const porCierre = new Map<string, { metodo_pago: string; monto_neto: number; cantidad_comprobantes: number }[]>();
    for (const m of (mediosRows ?? []) as Record<string, unknown>[]) {
      const cid = String(m.cierre_z_id);
      const arr = porCierre.get(cid) ?? [];
      arr.push({
        metodo_pago: String(m.metodo_pago),
        monto_neto: Number(m.monto_neto),
        cantidad_comprobantes: Number(m.cantidad_comprobantes),
      });
      porCierre.set(cid, arr);
    }

    const eventos: EventoHistorialCaja[] = [];

    for (const a of aperturas) {
      eventos.push({
        tipo: 'apertura',
        id: a.id,
        at: a.opened_at,
        fondo_efectivo: a.fondo_efectivo,
        fecha_operativa: a.fecha_operativa,
      });
    }

    for (const c of cierres) {
      const id = String(c.id);
      eventos.push({
        tipo: 'cierre',
        id,
        at: String(c.created_at ?? c.rango_hasta),
        caja_id: String(c.caja_id),
        fecha_operativa: String(c.fecha_operativa),
        tipo_cierre: String(c.tipo_cierre),
        rango_desde: String(c.rango_desde),
        rango_hasta: String(c.rango_hasta),
        total_comprobantes: Number(c.total_comprobantes),
        ventas_netas: Number(c.ventas_netas),
        pagos_cta_cte_total: Number(c.pagos_cta_cte_total),
        ventas_brutas: Number(c.ventas_brutas),
        notas_credito_total: Number(c.notas_credito_total),
        reciente_fuera_fecha: c.reciente_fuera_fecha === true,
        payload_resumen: (c.payload_resumen as Record<string, unknown>) ?? null,
        medios: porCierre.get(id) ?? [],
      });
    }

    eventos.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());

    return NextResponse.json({ eventos, sucursal_id: sucursalScope.sucursalId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al cargar historial';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
