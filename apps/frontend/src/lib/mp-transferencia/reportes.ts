import * as XLSX from 'xlsx';

export type MpTransferenciaMovimientoReporte = {
  mp_movimiento_id: string;
  fecha_operacion: string;
  fecha_hora: string | null;
  monto: number;
  moneda: string;
  transaction_type: string | null;
  payment_type: string | null;
  descripcion: string | null;
  contraparte: string | null;
  raw: Record<string, unknown>;
};

export class MpTransferenciaReporteError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'MpTransferenciaReporteError';
  }
}

const ID_KEYS = [
  'SOURCE_ID',
  'MOVEMENT_ID',
  'MOVEMENT_NUMBER',
  'TRANSACTION_ID',
  'OPERATION_ID',
  'PAYMENT_ID',
  'RECORD_ID',
  'REFERENCE_ID',
  'PAY_BANK_TRANSFER_ID',
  'PURCHASE_ID',
  'ORDER_MP',
  'TRANSACTION_INTENT_ID',
];

const AMOUNT_KEYS = [
  'SETTLEMENT_NET_AMOUNT',
  'NET_AMOUNT',
  'TRANSACTION_AMOUNT',
  'GROSS_AMOUNT',
  'TOTAL_PAID_AMOUNT',
  'AMOUNT',
  'VALUE',
];

const DATE_KEYS = [
  'DATE',
  'TRANSACTION_DATE',
  'SETTLEMENT_DATE',
  'APPROVAL_DATE',
  'DATE_APPROVED',
  'RELEASE_DATE',
];

const CURRENCY_KEYS = ['CURRENCY', 'CURRENCY_ID', 'MONEY_RELEASE_CURRENCY'];
const TRANSACTION_TYPE_KEYS = ['TRANSACTION_TYPE', 'TYPE', 'OPERATION_TYPE'];
const PAYMENT_TYPE_KEYS = ['PAYMENT_TYPE', 'PAYMENT_TYPE_ID', 'PAYMENT_METHOD_TYPE', 'PAYMENT_METHOD_ID'];
const STATUS_KEYS = ['STATUS', 'TRANSACTION_STATUS', 'PAYMENT_STATUS', 'STATE'];
const DESCRIPTION_KEYS = ['DESCRIPTION', 'DETAIL', 'REASON', 'TRANSACTION_DESCRIPTION'];
const COUNTERPARTY_KEYS = ['PAYER_NAME', 'SENDER_NAME', 'COUNTERPARTY', 'CLIENT_NAME', 'BUYER_NAME'];

const EXCLUDED_TRANSACTION_TYPES = new Set([
  'REFUND',
  'REFUND_SHIPPING',
  'CHARGEBACK',
  'CHARGEBACK_SHIPPING',
  'DISPUTE',
  'DISPUTE_SHIPPING',
  'WITHDRAWAL',
  'PAYOUT',
  'TRANSFER_OUT',
]);

const APPROVED_STATUSES = new Set([
  'APPROVED',
  'ACCREDITED',
  'SETTLED',
  'COMPLETED',
  'RELEASED',
  'PAID',
]);

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function pick(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return undefined;
}

export function parseMontoMp(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  }
  const raw = stringOrNull(value);
  if (!raw) return null;
  const compact = raw
    .replace(/\s/g, '')
    .replace(/\$/g, '')
    .replace(/ARS/gi, '')
    .replace(/[()]/g, (m) => (m === '(' ? '-' : ''));
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;
  if (lastComma > lastDot) {
    normalized = compact.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = compact.replace(/,/g, '');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymdFromDateParts(y: number, m: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 2000 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function ymdArgentina(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function parseFechaMp(value: unknown): { ymd: string; iso: string | null } | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const ymd = ymdFromDateParts(parsed.y, parsed.m, parsed.d);
    if (!ymd) return null;
    return { ymd, iso: `${ymd}T00:00:00.000Z` };
  }
  const raw = stringOrNull(value);
  if (!raw) return null;

  const isoYmd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoYmd) {
    const d = new Date(raw);
    const hasTime = /[T\s]\d{1,2}:\d{2}/.test(raw);
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const ymd =
      !Number.isNaN(d.getTime()) && (hasTime || hasZone)
        ? ymdArgentina(d)
        : `${isoYmd[1]}-${isoYmd[2]}-${isoYmd[3]}`;
    return { ymd, iso: Number.isNaN(d.getTime()) ? null : d.toISOString() };
  }

  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+.*)?$/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const yearRaw = Number(slash[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const ymd = ymdFromDateParts(year, month, day);
    if (!ymd) return null;
    return { ymd, iso: `${ymd}T00:00:00.000Z` };
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return { ymd: ymdArgentina(d), iso: d.toISOString() };
}

function normalizarFila(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[normalizeHeader(key)] = value;
  }
  return out;
}

function movimientoPareceIngreso(row: Record<string, unknown>, monto: number): boolean {
  if (monto <= 0) return false;
  const type = stringOrNull(pick(row, TRANSACTION_TYPE_KEYS))?.toUpperCase() ?? '';
  if (type && EXCLUDED_TRANSACTION_TYPES.has(type)) return false;
  const status = stringOrNull(pick(row, STATUS_KEYS))?.toUpperCase() ?? '';
  if (status && !APPROVED_STATUSES.has(status)) return false;
  return true;
}

export function parseMpTransferenciaCsv(csvText: string): MpTransferenciaMovimientoReporte[] {
  const workbook = XLSX.read(csvText, { type: 'string', raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });
  const normalizedRows = rawRows.map(normalizarFila);
  const hasStableId = normalizedRows.some((row) => pick(row, ID_KEYS) != null);
  if (!hasStableId && normalizedRows.length > 0) {
    throw new MpTransferenciaReporteError(
      'El reporte de Mercado Pago no trae un identificador estable del movimiento. No se puede verificar sin riesgo de duplicar pagos.',
      'missing_stable_id',
    );
  }

  const out: MpTransferenciaMovimientoReporte[] = [];
  for (const row of normalizedRows) {
    const id = stringOrNull(pick(row, ID_KEYS));
    if (!id) continue;
    const monto = parseMontoMp(pick(row, AMOUNT_KEYS));
    if (monto == null || !movimientoPareceIngreso(row, monto)) continue;
    const fecha = parseFechaMp(pick(row, DATE_KEYS));
    if (!fecha) continue;

    out.push({
      mp_movimiento_id: id,
      fecha_operacion: fecha.ymd,
      fecha_hora: fecha.iso,
      monto,
      moneda: stringOrNull(pick(row, CURRENCY_KEYS)) ?? 'ARS',
      transaction_type: stringOrNull(pick(row, TRANSACTION_TYPE_KEYS)),
      payment_type: stringOrNull(pick(row, PAYMENT_TYPE_KEYS)),
      descripcion: stringOrNull(pick(row, DESCRIPTION_KEYS)),
      contraparte: stringOrNull(pick(row, COUNTERPARTY_KEYS)),
      raw: row,
    });
  }

  return out;
}

export function filtrarCoincidenciasMpTransferencia(
  movimientos: MpTransferenciaMovimientoReporte[],
  params: { fecha: string; monto: number; usados?: Set<string> },
): MpTransferenciaMovimientoReporte[] {
  const monto = Math.round(params.monto * 100) / 100;
  return movimientos.filter((mov) => {
    if (params.usados?.has(mov.mp_movimiento_id)) return false;
    return mov.fecha_operacion === params.fecha && Math.abs(mov.monto - monto) < 0.005;
  });
}
