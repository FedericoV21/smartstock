import { fechaYmdArgentina } from '../../caja/utils/caja-id.util';

export type CampanaCobranzaEstado = 'recordatorio_dia_5' | 'vencido' | 'saldo_cobranza_diaria';

function diasCalendarioHastaVencimiento(hoyYmd: string, vencYmd: string): number {
  const [hy, hm, hd] = hoyYmd.split('-').map(Number);
  const [vy, vm, vd] = vencYmd.split('-').map(Number);
  const t0 = Date.UTC(hy, hm - 1, hd);
  const t1 = Date.UTC(vy, vm - 1, vd);
  return Math.round((t1 - t0) / 86400000);
}

export function anticipacionRecordatorioSegunCondicion(params: {
  cobroModalidad?: string | null;
  cobroPeriodicidad?: string | null;
  cobroDiasPlazo?: number | null;
}): number {
  const modalidad = String(params.cobroModalidad ?? '').trim();
  const periodicidad = String(params.cobroPeriodicidad ?? '').trim();
  const plazo = Number(params.cobroDiasPlazo ?? 0);

  if (modalidad === 'periodico') {
    if (periodicidad === 'diaria') return 0;
    if (periodicidad === 'semanal') return 1;
    if (periodicidad === 'quincenal') return 2;
    if (periodicidad === 'mensual') return 3;
    return 2;
  }
  if (modalidad === 'dia_fijo_mes') return 3;
  if (Number.isFinite(plazo) && plazo > 0) {
    if (plazo <= 3) return 0;
    if (plazo <= 7) return 1;
    if (plazo <= 15) return 2;
    if (plazo <= 30) return 3;
    return 5;
  }
  return 2;
}

export function debeMostrarEnCampanaCobranza(params: {
  saldoPendiente: number;
  vencimientoAt: Date;
  recordatorioSnoozeUntil: Date | null;
  clientePeriodicidadDiaria?: boolean;
  anticipacionDias?: number;
  now?: Date;
}): { mostrar: boolean; estado: CampanaCobranzaEstado | null } {
  const now = params.now ?? new Date();
  if (params.saldoPendiente <= 0) {
    return { mostrar: false, estado: null };
  }
  if (params.recordatorioSnoozeUntil && now < params.recordatorioSnoozeUntil) {
    return { mostrar: false, estado: null };
  }
  const hoyYmd = fechaYmdArgentina(now);
  const vencYmd = fechaYmdArgentina(params.vencimientoAt);
  const dias = diasCalendarioHastaVencimiento(hoyYmd, vencYmd);
  if (dias < 0) {
    return { mostrar: true, estado: 'vencido' };
  }
  if (params.clientePeriodicidadDiaria) {
    return { mostrar: true, estado: 'saldo_cobranza_diaria' };
  }
  const anticipacion = Math.max(0, Math.trunc(params.anticipacionDias ?? 2));
  if (dias <= anticipacion) {
    return { mostrar: true, estado: 'recordatorio_dia_5' };
  }
  return { mostrar: false, estado: null };
}

export function telefonoArgentinoAE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (d.length < 8) return null;
  if (d.startsWith('54')) return d;
  if (d.startsWith('0')) {
    const rest = d.replace(/^0+/, '');
    if (rest.length < 8) return null;
    return `54${rest}`;
  }
  if (d.startsWith('15')) {
    const rest = d.slice(2);
    if (rest.length < 8) return null;
    return `54${rest}`;
  }
  if (d.length === 10) {
    return `54${d}`;
  }
  return `54${d}`;
}

const WA_TEXT_SAFE = 1600;

export function construirUrlWhatsAppCobranza(params: {
  telefonoE164: string;
  clienteNombre: string;
  tipoFacturaLabel: string;
  numeroComprobante: string;
  saldoPendiente: number;
  monedaLabel: string;
  vencimientoLabel: string;
  estado: CampanaCobranzaEstado;
  pdfUrl?: string | null;
}): string {
  const aviso =
    params.estado === 'vencido'
      ? 'Ten├®s un saldo vencido.'
      : params.estado === 'saldo_cobranza_diaria'
        ? 'Ten├®s cobranza diaria pactada en cuenta corriente; queda saldo pendiente en esta factura.'
        : 'Te recordamos que en breve vence el pago de tu factura.';
  const lineas = [
    `Hola ${params.clienteNombre},`,
    '',
    aviso,
    '',
    `${params.tipoFacturaLabel} ${params.numeroComprobante}.`,
    `Saldo pendiente: ${params.monedaLabel} ${params.saldoPendiente.toFixed(2)}.`,
    `Vencimiento: ${params.vencimientoLabel}.`,
  ];
  if (params.pdfUrl) {
    lineas.push('', `Factura (PDF): ${params.pdfUrl}`);
  }
  let text = lineas.join('\n');
  if (text.length > WA_TEXT_SAFE) {
    text = `${text.slice(0, WA_TEXT_SAFE - 3)}...`;
  }
  const encoded = encodeURIComponent(text);
  return `https://wa.me/${params.telefonoE164}?text=${encoded}`;
}
