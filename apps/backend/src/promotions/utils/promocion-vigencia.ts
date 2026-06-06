import type { PromocionMotor } from '../types/promocion-motor.types';

const WEEKDAY_SHORT_LUN1_DOM7: Record<string, number> = {
  Sun: 7,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function diaSemanaDesdeLunesArgentina(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const inst = new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
  const short = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'short',
  })
    .format(inst)
    .replace(/\.$/, '');
  return WEEKDAY_SHORT_LUN1_DOM7[short] ?? 1;
}

export function promocionVigenteParaYmd(promo: PromocionMotor, fechaYmd: string): boolean {
  if (!promo.activa) return false;
  if (promo.vigente_desde != null && fechaYmd < promo.vigente_desde) return false;
  if (promo.vigente_hasta != null && fechaYmd > promo.vigente_hasta) return false;
  if (promo.dias_semana != null && promo.dias_semana.length > 0) {
    const dia = diaSemanaDesdeLunesArgentina(fechaYmd);
    if (!promo.dias_semana.includes(dia)) return false;
  }
  return true;
}
