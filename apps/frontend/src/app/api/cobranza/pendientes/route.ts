import { NextResponse } from 'next/server';

import { getTenantSession } from '@/lib/api/tenant-session';
import {
  anticipacionRecordatorioSegunCondicion,
  construirUrlWhatsAppCobranza,
  debeMostrarEnCampanaCobranza,
  telefonoArgentinoAE164,
} from '@/lib/cobranza/logic';
import { montoPendienteCuentaCorrienteEmitir } from '@/lib/cobranza/monto-pendiente-emision';
import { resolverVencimientoCobranza } from '@/lib/cobranza/dias-vencimiento-cuenta';
import { moduloGuard } from '@/lib/modulos/guard';
import { formatearNumeroComprobante, formatearTipoComprobante } from '@/lib/facturacion/formato';
import { formatDate } from '@/lib/utils/formatters';
import type { Database } from '@/types/database';

type CobranzaRow = Database['public']['Tables']['cobranza_factura']['Row'];
type ClienteMini = Pick<Database['public']['Tables']['cliente']['Row'], 'id' | 'nombre' | 'telefono'>;
type ComprobanteMini = Pick<
  Database['public']['Tables']['comprobante']['Row'],
  'numero' | 'tipo' | 'pdf_url' | 'total'
>;
type TicketLegacyMini = Pick<
  Database['public']['Tables']['comprobante']['Row'],
  | 'id'
  | 'cliente_id'
  | 'numero'
  | 'tipo'
  | 'total'
  | 'pdf_url'
  | 'fecha'
  | 'fecha_vencimiento_pago'
  | 'metodo_pago'
  | 'metodo_pago_detalle'
> & {
  cliente: ClienteMini | null;
};

type CobranzaPendienteRow = Pick<
  CobranzaRow,
  | 'id'
  | 'cliente_id'
  | 'saldo_pendiente'
  | 'vencimiento_at'
  | 'recordatorio_snooze_until'
  | 'monto_original'
  | 'comprobante_id'
> & {
  cliente: ClienteMini | null;
  comprobante: ComprobanteMini | null;
};

type CuentaCobroResolver = Parameters<typeof resolverVencimientoCobranza>[0]['cuenta'];
type CondicionCobroCuenta = {
  cobro_modalidad: string | null;
  cobro_periodicidad: string | null;
  cobro_dias_plazo: number | null;
  cobro_dia_vencimiento_mes: number | null;
};

function normalizarCuentaCobroParaResolver(input: CondicionCobroCuenta | null | undefined): CuentaCobroResolver {
  if (!input) return null;
  if (
    input.cobro_modalidad !== 'por_comprobante' &&
    input.cobro_modalidad !== 'periodico' &&
    input.cobro_modalidad !== 'dia_fijo_mes'
  ) {
    return null;
  }
  return {
    cobro_modalidad: input.cobro_modalidad,
    cobro_periodicidad:
      input.cobro_periodicidad === 'diaria' ||
      input.cobro_periodicidad === 'semanal' ||
      input.cobro_periodicidad === 'quincenal' ||
      input.cobro_periodicidad === 'mensual'
        ? input.cobro_periodicidad
        : null,
    cobro_dias_plazo:
      typeof input.cobro_dias_plazo === 'number' ? input.cobro_dias_plazo : 7,
    cobro_dia_vencimiento_mes:
      typeof input.cobro_dia_vencimiento_mes === 'number'
        ? input.cobro_dia_vencimiento_mes
        : null,
  };
}

export async function GET() {
  const session = await getTenantSession();
  if ('error' in session) return session.error;

  const guard = await moduloGuard('facturador_simple');
  if (!guard.allowed) return guard.response;

  const { data: tenant } = await session.supabase
    .from('tenant')
    .select('punto_de_venta')
    .maybeSingle();

  const pv = tenant?.punto_de_venta ?? 1;

  const { data: rows, error } = await session.supabase
    .from('cobranza_factura')
    .select(
      `
      id,
      cliente_id,
      saldo_pendiente,
      vencimiento_at,
      recordatorio_snooze_until,
      monto_original,
      comprobante_id,
      cliente:cliente_id ( id, nombre, telefono ),
      comprobante:comprobante_id ( numero, tipo, pdf_url, total )
    `,
    )
    .gt('saldo_pendiente', 0);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const comprobanteIdsConCobranza = new Set(
    (rows ?? [])
      .map((raw) => (raw as CobranzaPendienteRow).comprobante_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  const clienteIds = [
    ...new Set(
      (rows ?? []).map((raw) => (raw as CobranzaPendienteRow).cliente_id),
    ),
  ].filter(Boolean);

  const periodicidadDiariaPorClienteId = new Map<string, boolean>();
  const anticipacionPorClienteId = new Map<string, number>();
  const condicionCobroPorClienteId = new Map<string, CondicionCobroCuenta>();
  if (clienteIds.length > 0) {
    const { data: cuentas, error: errCuentas } = await session.supabase
      .from('cuenta_corriente')
      .select(
        'cliente_id, cobro_modalidad, cobro_periodicidad, cobro_dias_plazo, cobro_dia_vencimiento_mes',
      )
      .in('cliente_id', clienteIds)
      .not('cliente_id', 'is', null);

    if (errCuentas) {
      return NextResponse.json({ error: errCuentas.message }, { status: 500 });
    }

    for (const c of cuentas ?? []) {
      if (c.cliente_id) {
        condicionCobroPorClienteId.set(c.cliente_id, {
          cobro_modalidad: c.cobro_modalidad,
          cobro_periodicidad: c.cobro_periodicidad,
          cobro_dias_plazo: c.cobro_dias_plazo,
          cobro_dia_vencimiento_mes: c.cobro_dia_vencimiento_mes,
        });
        anticipacionPorClienteId.set(
          c.cliente_id,
          anticipacionRecordatorioSegunCondicion({
            cobroModalidad: c.cobro_modalidad,
            cobroPeriodicidad: c.cobro_periodicidad,
            cobroDiasPlazo: c.cobro_dias_plazo,
          }),
        );
      }
      if (
        c.cliente_id &&
        c.cobro_modalidad === 'periodico' &&
        c.cobro_periodicidad === 'diaria'
      ) {
        periodicidadDiariaPorClienteId.set(c.cliente_id, true);
      }
    }
  }

  const { data: ticketsLegacy, error: ticketsLegacyError } = await session.supabase
    .from('comprobante')
    .select(
      `
      id,
      cliente_id,
      numero,
      tipo,
      total,
      pdf_url,
      fecha,
      fecha_vencimiento_pago,
      metodo_pago,
      metodo_pago_detalle,
      cliente:cliente_id ( id, nombre, telefono )
    `,
    )
    .eq('estado', 'emitido')
    .in('tipo', ['ticket', 'factura_a', 'factura_b', 'factura_c'])
    .not('cliente_id', 'is', null);
  if (ticketsLegacyError) {
    return NextResponse.json({ error: ticketsLegacyError.message }, { status: 500 });
  }
  const clienteIdsLegacy = [
    ...new Set((ticketsLegacy ?? []).map((t) => t.cliente_id).filter(Boolean)),
  ] as string[];
  const clienteIdsTodos = [...new Set([...clienteIds, ...clienteIdsLegacy])];
  const faltantesEnMapa = clienteIdsLegacy.filter((id) => !periodicidadDiariaPorClienteId.has(id));
  if (faltantesEnMapa.length > 0) {
    const { data: cuentasLegacy, error: cuentasLegacyErr } = await session.supabase
      .from('cuenta_corriente')
      .select(
        'cliente_id, cobro_modalidad, cobro_periodicidad, cobro_dias_plazo, cobro_dia_vencimiento_mes',
      )
      .in('cliente_id', faltantesEnMapa)
      .not('cliente_id', 'is', null);
    if (cuentasLegacyErr) {
      return NextResponse.json({ error: cuentasLegacyErr.message }, { status: 500 });
    }
    for (const c of cuentasLegacy ?? []) {
      if (c.cliente_id) {
        condicionCobroPorClienteId.set(c.cliente_id, {
          cobro_modalidad: c.cobro_modalidad,
          cobro_periodicidad: c.cobro_periodicidad,
          cobro_dias_plazo: c.cobro_dias_plazo,
          cobro_dia_vencimiento_mes: c.cobro_dia_vencimiento_mes,
        });
        anticipacionPorClienteId.set(
          c.cliente_id,
          anticipacionRecordatorioSegunCondicion({
            cobroModalidad: c.cobro_modalidad,
            cobroPeriodicidad: c.cobro_periodicidad,
            cobroDiasPlazo: c.cobro_dias_plazo,
          }),
        );
      }
      if (c.cliente_id && c.cobro_modalidad === 'periodico' && c.cobro_periodicidad === 'diaria') {
        periodicidadDiariaPorClienteId.set(c.cliente_id, true);
      }
    }
  }
  const cobranzaIds = (rows ?? []).map((raw) => (raw as CobranzaPendienteRow).id);
  const ultimaFechaPagoPorCobranzaId = new Map<string, string>();
  const ultimaFechaPagoPorClienteId = new Map<string, string>();
  if (cobranzaIds.length > 0) {
    const { data: pagos, error: pagosErr } = await session.supabase
      .from('cobranza_pago')
      .select('cobranza_factura_id, fecha, cobranza_factura: cobranza_factura_id ( cliente_id )')
      .in('cobranza_factura_id', cobranzaIds)
      .order('fecha', { ascending: false });
    if (pagosErr) {
      return NextResponse.json({ error: pagosErr.message }, { status: 500 });
    }
    for (const p of pagos ?? []) {
      if (!ultimaFechaPagoPorCobranzaId.has(p.cobranza_factura_id)) {
        ultimaFechaPagoPorCobranzaId.set(p.cobranza_factura_id, p.fecha);
      }
      const clienteIdPago =
        p.cobranza_factura && !Array.isArray(p.cobranza_factura)
          ? (p.cobranza_factura as { cliente_id?: string | null }).cliente_id
          : null;
      if (clienteIdPago && !ultimaFechaPagoPorClienteId.has(clienteIdPago)) {
        ultimaFechaPagoPorClienteId.set(clienteIdPago, p.fecha);
      }
    }
  }
  const saldoCuentaPorClienteId = new Map<string, number>();
  if (clienteIdsTodos.length > 0) {
    const { data: cuentasSaldo, error: cuentasSaldoErr } = await session.supabase
      .from('cuenta_corriente')
      .select('cliente_id, saldo')
      .in('cliente_id', clienteIdsTodos)
      .not('cliente_id', 'is', null);
    if (cuentasSaldoErr) {
      return NextResponse.json({ error: cuentasSaldoErr.message }, { status: 500 });
    }
    for (const c of cuentasSaldo ?? []) {
      if (c.cliente_id) {
        saldoCuentaPorClienteId.set(c.cliente_id, Number(c.saldo ?? 0));
      }
    }
  }

  const items: {
    id: string;
    clienteId: string;
    estado: 'recordatorio_dia_5' | 'vencido' | 'saldo_cobranza_diaria';
    clienteNombre: string;
    telefonoRaw: string | null;
    telefonoE164: string | null;
    puedeWhatsApp: boolean;
    mensajeUrl: string | null;
    numeroComprobanteLabel: string;
    tipoComprobanteLabel: string;
    saldoPendiente: number;
    vencimientoAt: string;
    vencimientoLabel: string;
    pdfUrl: string | null;
  }[] = [];

  for (const raw of rows ?? []) {
    const r = raw as CobranzaPendienteRow;
    if (!r.cliente || !r.comprobante) continue;

    const ultimaFechaPagoYmd = ultimaFechaPagoPorCobranzaId.get(r.id) ?? null;
    const condicionCobro = normalizarCuentaCobroParaResolver(
      condicionCobroPorClienteId.get(r.cliente.id),
    );
    let vencimientoReferencia = new Date(r.vencimiento_at);
    if (ultimaFechaPagoYmd && condicionCobro) {
      vencimientoReferencia = resolverVencimientoCobranza({
        fechaEmisionYmd: ultimaFechaPagoYmd,
        fechaExplicitaYmd: null,
        cuenta: condicionCobro,
      });
    }
    const snooze = r.recordatorio_snooze_until ? new Date(r.recordatorio_snooze_until) : null;
    const clientePeriodicidadDiaria =
      periodicidadDiariaPorClienteId.get(r.cliente.id) === true;
    const { mostrar, estado } = debeMostrarEnCampanaCobranza({
      saldoPendiente: Number(r.saldo_pendiente),
      vencimientoAt: vencimientoReferencia,
      recordatorioSnoozeUntil: snooze,
      clientePeriodicidadDiaria,
      anticipacionDias: anticipacionPorClienteId.get(r.cliente.id),
    });
    if (!mostrar || !estado) continue;

    const e164 = telefonoArgentinoAE164(r.cliente.telefono);
    const numeroLabel = formatearNumeroComprobante(pv, r.comprobante.numero);
    const tipoLabel = formatearTipoComprobante(r.comprobante.tipo);
    const saldo = Number(r.saldo_pendiente);
    const vencIso = vencimientoReferencia.toISOString();
    const vencStr = formatDate(vencIso);

    let mensajeUrl: string | null = null;
    if (e164) {
      mensajeUrl = construirUrlWhatsAppCobranza({
        telefonoE164: e164,
        clienteNombre: r.cliente.nombre,
        tipoFacturaLabel: tipoLabel,
        numeroComprobante: numeroLabel,
        saldoPendiente: saldo,
        monedaLabel: '$',
        vencimientoLabel: vencStr,
        estado,
        pdfUrl: r.comprobante.pdf_url,
      });
    }

    items.push({
      id: r.id,
      clienteId: r.cliente.id,
      estado,
      clienteNombre: r.cliente.nombre,
      telefonoRaw: r.cliente.telefono,
      telefonoE164: e164,
      puedeWhatsApp: Boolean(e164),
      mensajeUrl,
      numeroComprobanteLabel: numeroLabel,
      tipoComprobanteLabel: tipoLabel,
      saldoPendiente: saldo,
      vencimientoAt: vencIso,
      vencimientoLabel: vencStr,
      pdfUrl: r.comprobante.pdf_url,
    });
  }
  const saldoRegistradoPorClienteId = new Map<string, number>();
  for (const it of items) {
    const prev = saldoRegistradoPorClienteId.get(it.clienteId) ?? 0;
    saldoRegistradoPorClienteId.set(it.clienteId, prev + Number(it.saldoPendiente));
  }
  const saldoLegacyDisponiblePorClienteId = new Map<string, number>();
  for (const cid of clienteIdsTodos) {
    const saldoCuenta = saldoCuentaPorClienteId.get(cid) ?? 0;
    const saldoRegistrado = saldoRegistradoPorClienteId.get(cid) ?? 0;
    saldoLegacyDisponiblePorClienteId.set(cid, Math.max(0, saldoCuenta - saldoRegistrado));
  }

  const legacyCandidatos: Array<
    Omit<
      (typeof items)[number],
      'id' | 'estado' | 'saldoPendiente' | 'mensajeUrl' | 'vencimientoLabel'
    > & {
      idBase: string;
      deudaOriginal: number;
    }
  > = [];
  for (const raw of ticketsLegacy ?? []) {
    const t = raw as TicketLegacyMini;
    if (!t.cliente_id || !t.cliente) continue;
    if (comprobanteIdsConCobranza.has(t.id)) continue;
    let saldo = montoPendienteCuentaCorrienteEmitir({
      metodo_pago: t.metodo_pago,
      metodo_pago_detalle:
        t.metodo_pago_detalle && typeof t.metodo_pago_detalle === 'object'
          ? (t.metodo_pago_detalle as Record<string, unknown>)
          : null,
      totalComprobante: Number(t.total),
    });
    const mp = String(t.metodo_pago ?? '')
      .trim()
      .toLowerCase();
    const ticketLegacySinMetodo = t.tipo === 'ticket' && mp.length === 0;
    if (saldo <= 0.02 && ticketLegacySinMetodo) {
      // Compatibilidad: tickets viejos en cuenta corriente se emitieron sin metodo_pago.
      saldo = Number(t.total);
    }
    if (saldo <= 0.02) continue;
    const vencimientoAt = t.fecha_vencimiento_pago
      ? `${t.fecha_vencimiento_pago}T23:59:59.999-03:00`
      : `${t.fecha}T23:59:59.999-03:00`;
    legacyCandidatos.push({
      idBase: t.id,
      clienteId: t.cliente_id,
      clienteNombre: t.cliente.nombre,
      telefonoRaw: t.cliente.telefono,
      telefonoE164: telefonoArgentinoAE164(t.cliente.telefono),
      puedeWhatsApp: Boolean(telefonoArgentinoAE164(t.cliente.telefono)),
      numeroComprobanteLabel: formatearNumeroComprobante(pv, t.numero),
      tipoComprobanteLabel: formatearTipoComprobante(t.tipo),
      deudaOriginal: saldo,
      vencimientoAt,
      pdfUrl: t.pdf_url,
    });
  }
  const legacyPorCliente = new Map<
    string,
    {
      clienteNombre: string;
      telefonoRaw: string | null;
      telefonoE164: string | null;
      tipoComprobanteLabel: string;
      pdfUrl: string | null;
      deudaOriginalTotal: number;
      minVencimientoAt: string;
      comprobantesCount: number;
    }
  >();
  for (const c of legacyCandidatos) {
    const prev = legacyPorCliente.get(c.clienteId);
    if (!prev) {
      legacyPorCliente.set(c.clienteId, {
        clienteNombre: c.clienteNombre,
        telefonoRaw: c.telefonoRaw,
        telefonoE164: c.telefonoE164,
        tipoComprobanteLabel: c.tipoComprobanteLabel,
        pdfUrl: c.pdfUrl,
        deudaOriginalTotal: c.deudaOriginal,
        minVencimientoAt: c.vencimientoAt,
        comprobantesCount: 1,
      });
      continue;
    }
    legacyPorCliente.set(c.clienteId, {
      ...prev,
      deudaOriginalTotal: prev.deudaOriginalTotal + c.deudaOriginal,
      minVencimientoAt:
        new Date(c.vencimientoAt).getTime() < new Date(prev.minVencimientoAt).getTime()
          ? c.vencimientoAt
          : prev.minVencimientoAt,
      comprobantesCount: prev.comprobantesCount + 1,
    });
  }
  for (const [clienteId, data] of legacyPorCliente) {
    const disponible = saldoLegacyDisponiblePorClienteId.get(clienteId) ?? 0;
    if (disponible <= 0.02 || data.deudaOriginalTotal <= 0.02) continue;
    const saldoAsignado = Math.min(data.deudaOriginalTotal, disponible);
    const condicion = normalizarCuentaCobroParaResolver(
      condicionCobroPorClienteId.get(clienteId),
    );
    const ultimaPagoYmd = ultimaFechaPagoPorClienteId.get(clienteId) ?? null;
    let vencimientoReferencia = new Date(data.minVencimientoAt);
    if (ultimaPagoYmd && condicion) {
      vencimientoReferencia = resolverVencimientoCobranza({
        fechaEmisionYmd: ultimaPagoYmd,
        fechaExplicitaYmd: null,
        cuenta: condicion,
      });
    }
    const { mostrar, estado } = debeMostrarEnCampanaCobranza({
      saldoPendiente: saldoAsignado,
      vencimientoAt: vencimientoReferencia,
      recordatorioSnoozeUntil: null,
      clientePeriodicidadDiaria: periodicidadDiariaPorClienteId.get(clienteId) === true,
      anticipacionDias: anticipacionPorClienteId.get(clienteId),
    });
    if (!mostrar || !estado) continue;
    const vencIso = vencimientoReferencia.toISOString();
    const vencStr = formatDate(vencIso);
    let mensajeUrl: string | null = null;
    if (data.telefonoE164) {
      mensajeUrl = construirUrlWhatsAppCobranza({
        telefonoE164: data.telefonoE164,
        clienteNombre: data.clienteNombre,
        tipoFacturaLabel: 'Cuenta corriente',
        numeroComprobante: `${data.comprobantesCount} comprobantes`,
        saldoPendiente: saldoAsignado,
        monedaLabel: '$',
        vencimientoLabel: vencStr,
        estado,
        pdfUrl: data.pdfUrl,
      });
    }
    items.push({
      id: `legacy-cliente-${clienteId}`,
      clienteId,
      estado,
      clienteNombre: data.clienteNombre,
      telefonoRaw: data.telefonoRaw,
      telefonoE164: data.telefonoE164,
      puedeWhatsApp: Boolean(data.telefonoE164),
      mensajeUrl,
      numeroComprobanteLabel: `${data.comprobantesCount} comprobantes`,
      tipoComprobanteLabel: 'Cuenta corriente',
      saldoPendiente: saldoAsignado,
      vencimientoAt: vencIso,
      vencimientoLabel: vencStr,
      pdfUrl: data.pdfUrl,
    });
  }

  const vencMs = (v: string) => {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  items.sort((a, b) => {
    if (a.estado === 'vencido' && b.estado === 'vencido') {
      return vencMs(a.vencimientoAt) - vencMs(b.vencimientoAt);
    }
    if (a.estado === 'vencido' && b.estado !== 'vencido') return -1;
    if (a.estado !== 'vencido' && b.estado === 'vencido') return 1;
    if (a.estado === 'recordatorio_dia_5' && b.estado !== 'recordatorio_dia_5') return -1;
    if (a.estado !== 'recordatorio_dia_5' && b.estado === 'recordatorio_dia_5') return 1;
    return vencMs(a.vencimientoAt) - vencMs(b.vencimientoAt);
  });

  const vencidosCount = items.filter((it) => it.estado === 'vencido').length;

  return NextResponse.json({
    items,
    count: items.length,
    vencidosCount,
  });
}
