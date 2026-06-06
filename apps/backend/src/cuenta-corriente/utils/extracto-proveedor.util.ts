import { formatearTipoComprobante } from '../../facturacion/utils/comprobante-void.rules';
import { formatCurrencyAr } from './format-currency.util';

export type ExtractoProveedorLineaTipo = 'cargo' | 'pago';

export type ExtractoProveedorLineaRaw = {
  fecha: string;
  orden: string;
  tipo: ExtractoProveedorLineaTipo;
  descripcion: string;
  debe: number;
  haber: number;
  obligacion_id: string | null;
  pago_id: string | null;
};

export type ExtractoProveedorLineaDto = ExtractoProveedorLineaRaw & {
  debe_label: string;
  haber_label: string;
  saldo_label: string;
  saldo: number;
};

export type ExtractoProveedorPayload = {
  proveedor_id: string;
  proveedor_nombre: string;
  periodo: { desde: string; hasta: string; label: string };
  saldo_inicial: number;
  saldo_inicial_label: string;
  saldo_final: number;
  saldo_final_label: string;
  total_debe: number;
  total_haber: number;
  lineas: ExtractoProveedorLineaDto[];
};

export type ObligacionExtractoRow = {
  id: string;
  monto_original: number;
  origen: 'comprobante' | 'import_lista';
  referencia: string | null;
  created_at: string;
  estado: string;
  comprobante: { tipo: string; numero: number | string | null; fecha: string } | null;
};

export type PagoProveedorExtractoRow = {
  id: string;
  fecha: string;
  created_at: string;
  monto: number;
  tipo_pago: string;
  referencia: string | null;
  notas: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const TIPO_PAGO_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

function fechaObligacion(row: ObligacionExtractoRow): string {
  if (row.comprobante?.fecha) return row.comprobante.fecha.slice(0, 10);
  return row.created_at.slice(0, 10);
}

function descripcionObligacion(row: ObligacionExtractoRow): string {
  if (row.comprobante) {
    const tipoLabel = formatearTipoComprobante(row.comprobante.tipo);
    const num = row.comprobante.numero;
    return num != null && String(num).trim() !== '' ? `${tipoLabel} ${num}` : tipoLabel;
  }
  if (row.origen === 'import_lista' && row.referencia?.trim()) return row.referencia.trim();
  if (row.origen === 'import_lista') return 'Importaci├│n de lista';
  return 'Factura de compra';
}

export function obligacionALineaExtracto(row: ObligacionExtractoRow): ExtractoProveedorLineaRaw | null {
  if (row.estado === 'anulada') return null;
  const monto = round2(Number(row.monto_original));
  if (monto <= 0) return null;
  return {
    fecha: fechaObligacion(row),
    orden: row.created_at,
    tipo: 'cargo',
    descripcion: descripcionObligacion(row),
    debe: monto,
    haber: 0,
    obligacion_id: row.id,
    pago_id: null,
  };
}

export function pagoProveedorALineaExtracto(row: PagoProveedorExtractoRow): ExtractoProveedorLineaRaw | null {
  const monto = round2(Number(row.monto));
  if (monto <= 0) return null;
  const tipoLabel = TIPO_PAGO_LABELS[row.tipo_pago] ?? row.tipo_pago;
  const extra = row.notas?.trim() || row.referencia?.trim();
  return {
    fecha: row.fecha,
    orden: row.created_at,
    tipo: 'pago',
    descripcion: extra ? `Pago (${tipoLabel}) ÔÇö ${extra}` : `Pago (${tipoLabel})`,
    debe: 0,
    haber: monto,
    obligacion_id: null,
    pago_id: row.id,
  };
}

export function armarExtractoProveedor(opts: {
  proveedorId: string;
  proveedorNombre: string;
  periodo: { desde: string; hasta: string; label: string };
  saldoActual: number;
  obligaciones: ObligacionExtractoRow[];
  pagos: PagoProveedorExtractoRow[];
}): ExtractoProveedorPayload {
  const lineasRaw: ExtractoProveedorLineaRaw[] = [];

  for (const o of opts.obligaciones) {
    const l = obligacionALineaExtracto(o);
    if (l) lineasRaw.push(l);
  }
  for (const p of opts.pagos) {
    const l = pagoProveedorALineaExtracto(p);
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
  const lineas: ExtractoProveedorLineaDto[] = lineasRaw.map((l) => {
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
    proveedor_id: opts.proveedorId,
    proveedor_nombre: opts.proveedorNombre,
    periodo: opts.periodo,
    saldo_inicial: saldoInicial,
    saldo_inicial_label: formatCurrencyAr(saldoInicial),
    saldo_final: saldoFinal,
    saldo_final_label: formatCurrencyAr(saldoFinal),
    total_debe: totalDebe,
    total_haber: totalHaber,
    lineas,
  };
}

export function extractoProveedorACsv(payload: ExtractoProveedorPayload): string {
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
    `Proveedor,${payload.proveedor_nombre.replaceAll(',', ' ')}`,
    `Per├¡odo,${payload.periodo.desde} a ${payload.periodo.hasta}`,
    `Saldo inicial,${payload.saldo_inicial}`,
    `Saldo final,${payload.saldo_final}`,
    '',
    header.join(','),
    ...rows.map((r) => r.join(',')),
  ].join('\n');
}
