import { formatCurrencyAr } from './format-currency.util';
import { montoPendienteCuentaCorrienteEmitir } from './monto-pendiente-cc.util';

export type ExtractoLineaTipo = 'cargo' | 'pago' | 'nota_credito';

export type ComprobanteExtractoRow = {
  id: string;
  tipo: string;
  numero: number | null;
  fecha: string;
  createdAt: string;
  total: number;
  metodoPago: string | null;
  metodoPagoDetalle: Record<string, unknown> | null;
  sucursalId: string | null;
  estado?: string;
  cae?: string | null;
};

export type PagoExtractoRow = {
  id: string;
  fecha: string;
  createdAt: string;
  monto: number;
  tipoPago: string;
  referencia: string | null;
  notas: string | null;
  comprobanteId: string | null;
};

const TIPO_LABELS: Record<string, string> = {
  ticket: 'Ticket',
  factura_a: 'Factura A',
  factura_b: 'Factura B',
  factura_c: 'Factura C',
  nota_credito_a: 'NC A',
  nota_credito_b: 'NC B',
  nota_credito_c: 'NC C',
};

const TIPO_PAGO_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function esNotaCredito(tipo: string): boolean {
  return tipo.startsWith('nota_credito');
}

function etiquetaComprobante(row: ComprobanteExtractoRow, puntoDeVenta: number): string {
  const tipoLabel = TIPO_LABELS[row.tipo] ?? row.tipo;
  if (row.numero == null) return tipoLabel;
  const pv = String(puntoDeVenta).padStart(4, '0');
  const num = String(row.numero).padStart(8, '0');
  return `${tipoLabel} ${pv}-${num}`;
}

function comprobanteALinea(row: ComprobanteExtractoRow, puntoDeVenta: number) {
  if (['recibo', 'presupuesto', 'remito', 'devolucion_remito'].includes(row.tipo)) return null;

  if (esNotaCredito(row.tipo)) {
    const total = round2(row.total);
    if (total <= 0) return null;
    return {
      fecha: row.fecha,
      orden: row.createdAt,
      tipo: 'nota_credito' as ExtractoLineaTipo,
      descripcion: etiquetaComprobante(row, puntoDeVenta),
      debe: 0,
      haber: total,
      comprobante_id: row.id,
      pago_id: null as string | null,
    };
  }

  const montoCc = montoPendienteCuentaCorrienteEmitir({
    metodoPago: row.metodoPago,
    metodoPagoDetalle: row.metodoPagoDetalle,
    totalComprobante: row.total,
  });
  if (montoCc <= 0.005) return null;

  return {
    fecha: row.fecha,
    orden: row.createdAt,
    tipo: 'cargo' as ExtractoLineaTipo,
    descripcion: etiquetaComprobante(row, puntoDeVenta),
    debe: montoCc,
    haber: 0,
    comprobante_id: row.id,
    pago_id: null as string | null,
  };
}

function pagoALinea(row: PagoExtractoRow) {
  const monto = round2(row.monto);
  if (monto <= 0) return null;
  const tipoLabel = TIPO_PAGO_LABELS[row.tipoPago] ?? row.tipoPago;
  const extra = row.notas?.trim() || row.referencia?.trim();
  return {
    fecha: row.fecha,
    orden: row.createdAt,
    tipo: 'pago' as ExtractoLineaTipo,
    descripcion: extra ? `Pago (${tipoLabel}) ÔÇö ${extra}` : `Pago (${tipoLabel})`,
    debe: 0,
    haber: monto,
    comprobante_id: row.comprobanteId,
    pago_id: row.id,
  };
}

export function armarExtractoCuentaCorriente(opts: {
  clienteId: string;
  clienteNombre: string;
  periodo: { desde: string; hasta: string; label: string };
  sucursalId: string | null;
  saldoActual: number;
  comprobantes: ComprobanteExtractoRow[];
  pagos: PagoExtractoRow[];
  puntoDeVenta: number;
}) {
  const lineasRaw = [];
  for (const c of opts.comprobantes) {
    const l = comprobanteALinea(c, opts.puntoDeVenta);
    if (l) lineasRaw.push(l);
  }
  for (const p of opts.pagos) {
    const l = pagoALinea(p);
    if (l) lineasRaw.push(l);
  }

  lineasRaw.sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
    return a.orden.localeCompare(b.orden);
  });

  const totalDebe = round2(lineasRaw.reduce((s, l) => s + l.debe, 0));
  const totalHaber = round2(lineasRaw.reduce((s, l) => s + l.haber, 0));
  const deltaPeriodo = round2(totalDebe - totalHaber);
  const saldoFinal = round2(opts.saldoActual);
  const saldoInicial = round2(saldoFinal - deltaPeriodo);

  let running = saldoInicial;
  const lineas = lineasRaw.map((l) => {
    running = round2(running + l.debe - l.haber);
    return {
      ...l,
      debe_label: l.debe > 0 ? formatCurrencyAr(l.debe) : 'ÔÇö',
      haber_label: l.haber > 0 ? formatCurrencyAr(l.haber) : 'ÔÇö',
      saldo: running,
      saldo_label: formatCurrencyAr(running),
    };
  });

  return {
    cliente_id: opts.clienteId,
    cliente_nombre: opts.clienteNombre,
    periodo: opts.periodo,
    sucursal_id: opts.sucursalId,
    saldo_inicial: saldoInicial,
    saldo_inicial_label: formatCurrencyAr(saldoInicial),
    saldo_final: saldoFinal,
    saldo_final_label: formatCurrencyAr(saldoFinal),
    total_debe: totalDebe,
    total_haber: totalHaber,
    lineas,
  };
}

export function extractoACsv(payload: ReturnType<typeof armarExtractoCuentaCorriente>): string {
  const header = ['Fecha', 'Descripci├│n', 'Tipo', 'Debe', 'Haber', 'Saldo'];
  const rows = payload.lineas.map((l) => [
    l.fecha,
    l.descripcion.replaceAll(',', ' '),
    l.tipo,
    l.debe > 0 ? String(l.debe) : '',
    l.haber > 0 ? String(l.haber) : '',
    String(l.saldo),
  ]);
  return [
    `Cliente,${payload.cliente_nombre.replaceAll(',', ' ')}`,
    `Per├¡odo,${payload.periodo.desde} a ${payload.periodo.hasta}`,
    `Saldo inicial,${payload.saldo_inicial}`,
    `Saldo final,${payload.saldo_final}`,
    '',
    header.join(','),
    ...rows.map((r) => r.join(',')),
  ].join('\n');
}
