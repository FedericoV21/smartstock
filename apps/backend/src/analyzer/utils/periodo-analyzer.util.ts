import { ymdArgentina } from '../../reports/utils/periodo-reporte.util';

export function currentPeriodo(): string {
  return ymdArgentina().slice(0, 7);
}

export function periodoAnterior(periodo: string, mesesAtras: number): string {
  const [y, m] = periodo.split('-').map(Number);
  const inst = new Date(Date.UTC(y, m - 1 - mesesAtras, 1, 12));
  return `${inst.getUTCFullYear()}-${String(inst.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function rangoMesPeriodo(periodo: string): { desde: string; hasta: string } {
  const [y, m] = periodo.split('-').map(Number);
  const desde = `${periodo}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const hasta = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { desde, hasta };
}
