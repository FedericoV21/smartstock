import { TipoPago } from '../../cuenta-corriente/enums/tipo-pago.enum';
import { csvEscape, round2 } from './report-comprobante-rules.util';

export type ReciboReportOrigen = 'recibo' | 'cobranza_sin_recibo' | 'cuenta_corriente';

export type ReciboReportItem = {
  id: string;
  fecha: string;
  numero: number | null;
  total: number;
  metodo_pago: string;
  cliente_nombre: string;
  sin_comprobante_recibo?: boolean;
  origen: ReciboReportOrigen;
};

export function etiquetaTipoPago(t: string): string {
  switch (t) {
    case TipoPago.efectivo:
      return 'Efectivo';
    case TipoPago.transferencia:
      return 'Transferencia';
    case TipoPago.cheque:
      return 'Cheque';
    case TipoPago.tarjeta:
      return 'Tarjeta';
    case TipoPago.otro:
      return 'Otro';
    default:
      return t || 'Otro';
  }
}

export function armarResumenRecibos(items: ReciboReportItem[]) {
  const totalMonto = round2(items.reduce((acc, it) => acc + it.total, 0));
  const promedio = items.length > 0 ? round2(totalMonto / items.length) : 0;
  const sinCliente = items.filter((it) => it.cliente_nombre === 'Sin cliente').length;
  const cobranzaSinRecibo = items.filter((it) => it.origen === 'cobranza_sin_recibo').length;
  const pagosCcLibres = items.filter((it) => it.origen === 'cuenta_corriente').length;
  return {
    cantidad: items.length,
    total_monto: totalMonto,
    promedio_monto: promedio,
    sin_cliente: sinCliente,
    cobros_sin_comprobante_recibo: cobranzaSinRecibo + pagosCcLibres,
    cobranza_sin_recibo_emitido: cobranzaSinRecibo,
    pagos_cuenta_corriente_libres: pagosCcLibres,
  };
}

export function recibosACsv(items: ReciboReportItem[]): string {
  const lines = [
    'fecha,numero,cliente,metodo_pago,total,sin_comprobante_recibo,origen',
    ...items.map((it) =>
      [
        csvEscape(it.fecha),
        csvEscape(it.numero ?? ''),
        csvEscape(it.cliente_nombre),
        csvEscape(it.metodo_pago),
        csvEscape(it.total),
        csvEscape(it.sin_comprobante_recibo ? 'si' : 'no'),
        csvEscape(it.origen),
      ].join(','),
    ),
  ];
  return lines.join('\n');
}
