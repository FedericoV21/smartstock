import type { ExtractoPayload } from '@/lib/cuenta-corriente/extracto';
import {
  descargarPdfTabla,
  nombrePdfReporte,
  type EmisorPdfInforme,
} from '@/lib/reportes/pdf-informe';
import { formatDate } from '@/lib/utils/formatters';

export function generarPdfExtractoCc(
  data: ExtractoPayload,
  emisor?: EmisorPdfInforme | null,
): void {
  descargarPdfTabla({
    nombreArchivo: nombrePdfReporte('extracto-cc'),
    titulo: `Extracto CC — ${data.cliente_nombre}`,
    emisor,
    lineasMeta: [
      `${data.periodo.label}: ${formatDate(data.periodo.desde)} – ${formatDate(data.periodo.hasta)}`,
      `Saldo inicial: ${data.saldo_inicial_label} · Saldo final: ${data.saldo_final_label}`,
    ],
    encabezados: ['Fecha', 'Descripción', 'Debe', 'Haber', 'Saldo'],
    anchosMm: [22, 78, 28, 28, 34],
    filas: data.lineas.map((l) => [
      formatDate(l.fecha),
      l.descripcion.length > 42 ? `${l.descripcion.slice(0, 40)}…` : l.descripcion,
      l.debe > 0 ? l.debe_label : '—',
      l.haber > 0 ? l.haber_label : '—',
      l.saldo_label,
    ]),
  });
}
