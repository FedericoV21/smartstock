import { montoPendienteCuentaCorrienteEmitir } from '@/lib/cobranza/monto-pendiente-emision';
import {
  formatearNumeroComprobante,
  formatearTipoComprobante,
} from '@/lib/facturacion/formato';
import { formatCurrency } from '@/lib/utils/formatters';

export type ExtractoLineaTipo = 'cargo' | 'pago' | 'nota_credito';

export type ExtractoLineaRaw = {
  fecha: string;
  orden: string;
  tipo: ExtractoLineaTipo;
  descripcion: string;
  debe: number;
  haber: number;
  comprobante_id: string | null;
  pago_id: string | null;
};

export type ExtractoLineaDto = ExtractoLineaRaw & {
  debe_label: string;
  haber_label: string;
  saldo_label: string;
  saldo: number;
};

export type ExtractoPayload = {
  cliente_id: string;
  cliente_nombre: string;
  periodo: { desde: string; hasta: string; label: string };
  sucursal_id: string | null;
  saldo_inicial: number;
  saldo_inicial_label: string;
  saldo_final: number;
  saldo_final_label: string;
  total_debe: number;
  total_haber: number;
  lineas: ExtractoLineaDto[];
};

export type ComprobanteExtractoRow = {
  id: string;
  tipo: string;
  numero: number | null;
  numero_caja: number | null;
  fecha: string;
  created_at: string;
  total: number;
  metodo_pago: string | null;
  metodo_pago_detalle: unknown;
  sucursal_id: string;
  estado?: string;
  cae?: string | null;
};

export type PagoExtractoRow = {
  id: string;
  fecha: string;
  created_at: string;
  monto: number;
  tipo_pago: string;
  referencia: string | null;
  notas: string | null;
  comprobante_id: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function esNotaCredito(tipo: string): boolean {
  return tipo.startsWith('nota_credito');
}

function etiquetaComprobante(
  row: ComprobanteExtractoRow,
  puntoDeVenta: number,
): string {
  const tipoLabel = formatearTipoComprobante(row.tipo);
  if (row.tipo === 'ticket' && (row.numero == null || Number.isNaN(Number(row.numero))) && row.numero_caja != null) {
    return `${tipoLabel} caja #${row.numero_caja}`;
  }
  const num = formatearNumeroComprobante(puntoDeVenta, row.numero);
  return `${tipoLabel} ${num}`;
}

export function comprobanteALineaExtracto(
  row: ComprobanteExtractoRow,
  puntoDeVenta: number,
): ExtractoLineaRaw | null {
  if (row.tipo === 'recibo' || row.tipo === 'presupuesto' || row.tipo === 'remito' || row.tipo === 'devolucion_remito') return null;

  const detalle =
    row.metodo_pago_detalle && typeof row.metodo_pago_detalle === 'object' && !Array.isArray(row.metodo_pago_detalle)
      ? (row.metodo_pago_detalle as Record<string, unknown>)
      : null;

  if (esNotaCredito(row.tipo)) {
    const total = round2(Number(row.total));
    if (total <= 0) return null;
    return {
      fecha: row.fecha,
      orden: row.created_at,
      tipo: 'nota_credito',
      descripcion: etiquetaComprobante(row, puntoDeVenta),
      debe: 0,
      haber: total,
      comprobante_id: row.id,
      pago_id: null,
    };
  }

  const montoCc = montoPendienteCuentaCorrienteEmitir({
    metodo_pago: row.metodo_pago,
    metodo_pago_detalle: detalle,
    totalComprobante: Number(row.total),
  });

  if (montoCc <= 0.005) return null;

  return {
    fecha: row.fecha,
    orden: row.created_at,
    tipo: 'cargo',
    descripcion: etiquetaComprobante(row, puntoDeVenta),
    debe: montoCc,
    haber: 0,
    comprobante_id: row.id,
    pago_id: null,
  };
}

const TIPO_PAGO_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

export function pagoALineaExtracto(row: PagoExtractoRow): ExtractoLineaRaw | null {
  const monto = round2(Number(row.monto));
  if (monto <= 0) return null;
  const tipoLabel = TIPO_PAGO_LABELS[row.tipo_pago] ?? row.tipo_pago;
  const extra = row.notas?.trim() || row.referencia?.trim();
  return {
    fecha: row.fecha,
    orden: row.created_at,
    tipo: 'pago',
    descripcion: extra ? `Pago (${tipoLabel}) — ${extra}` : `Pago (${tipoLabel})`,
    debe: 0,
    haber: monto,
    comprobante_id: row.comprobante_id,
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
}): ExtractoPayload {
  const lineasRaw: ExtractoLineaRaw[] = [];

  for (const c of opts.comprobantes) {
    const l = comprobanteALineaExtracto(c, opts.puntoDeVenta);
    if (l) lineasRaw.push(l);
  }
  for (const p of opts.pagos) {
    const l = pagoALineaExtracto(p);
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
  const lineas: ExtractoLineaDto[] = lineasRaw.map((l) => {
    running = round2(running + l.debe - l.haber);
    return {
      ...l,
      debe_label: l.debe > 0 ? formatCurrency(l.debe) : '—',
      haber_label: l.haber > 0 ? formatCurrency(l.haber) : '—',
      saldo: running,
      saldo_label: formatCurrency(running),
    };
  });

  return {
    cliente_id: opts.clienteId,
    cliente_nombre: opts.clienteNombre,
    periodo: opts.periodo,
    sucursal_id: opts.sucursalId,
    saldo_inicial: saldoInicial,
    saldo_inicial_label: formatCurrency(saldoInicial),
    saldo_final: saldoFinal,
    saldo_final_label: formatCurrency(saldoFinal),
    total_debe: totalDebe,
    total_haber: totalHaber,
    lineas,
  };
}

export function extractoACsv(payload: ExtractoPayload): string {
  const header = [
    'Fecha',
    'Descripción',
    'Tipo',
    'Debe',
    'Haber',
    'Saldo',
  ];
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
    `Período,${payload.periodo.desde} a ${payload.periodo.hasta}`,
    `Saldo inicial,${payload.saldo_inicial}`,
    `Saldo final,${payload.saldo_final}`,
    '',
    header.join(','),
    ...rows.map((r) => r.join(',')),
  ].join('\n');
}
