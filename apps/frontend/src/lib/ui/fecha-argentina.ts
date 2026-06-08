const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const MESES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

export const DIAS_CORTOS_ES = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do'] as const;

/** ISO `YYYY-MM-DD` → `dd/mm/aaaa` */
export function isoFechaToDisplay(iso: string): string {
  if (!ISO_DATE_ONLY.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** `dd/mm/aaaa` o variantes → ISO `YYYY-MM-DD` o null */
export function displayFechaToIso(display: string): string | null {
  const t = display.trim();
  if (!t) return null;

  const ddmmyyyy = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/;
  const m1 = t.match(ddmmyyyy);
  if (m1) {
    const d = Number(m1[1]);
    const mo = Number(m1[2]);
    const y = Number(m1[3]);
    if (!fechaCivilValida(y, mo, d)) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  if (ISO_DATE_ONLY.test(t)) return t;
  return null;
}

function fechaCivilValida(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= ultimo;
}

export function parseIsoFecha(iso: string): { y: number; m: number; d: number } | null {
  if (!ISO_DATE_ONLY.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!fechaCivilValida(y, m, d)) return null;
  return { y, m, d };
}

/** Celdas del mes (null = hueco al inicio). */
export function celdasCalendarioMes(year: number, month: number): (number | null)[] {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (number | null)[] = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  return cells;
}

export function isoDesdePartes(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
