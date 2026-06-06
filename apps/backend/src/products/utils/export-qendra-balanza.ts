import { pluEnteroParaBusqueda } from './normalizar-plu';

export type ProductoQendraBalanzaInput = {
  plu: string | null;
  nombre: string;
  precioVenta: number;
  sector: string;
  esPesable?: boolean;
  unidad?: string;
  fechaVencimiento?: string | null;
  ingredientes?: string | null;
  descuentoPct?: number | null;
};

export function productoEsExportableQendraBalanza(p: {
  plu: string | null;
  esPesable: boolean;
  unidad: string;
}): boolean {
  if (!(p.plu ?? '').trim()) return false;
  if (p.esPesable) return true;
  return p.unidad === 'unidad';
}

export function tipoVentaQendraProducto(
  esPesable: boolean | undefined,
  unidad?: string,
): 'p' | 'u' {
  if (unidad === 'unidad') return 'u';
  if (esPesable === true) return 'p';
  return 'u';
}

function escapeCampoQendra(v: string): string {
  const s = v.replace(/\r?\n/g, ' ').trim();
  if (/[;"]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatPrecioQendra(precio: number): string {
  const n = Number.isFinite(precio) ? precio : 0;
  return n.toFixed(2).replace('.', ',');
}

export function precioLista2Qendra(precioLista1: number, descuentoPct?: number | null): string {
  const pct = descuentoPct != null ? Number(descuentoPct) : NaN;
  if (Number.isFinite(pct) && pct > 0 && pct < 100) {
    return formatPrecioQendra(precioLista1 * (1 - pct / 100));
  }
  return '0,00';
}

export function pluParaExportQendra(plu: string | null): string {
  return pluEnteroParaBusqueda(plu);
}

function fechaLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function diasEntreYmdUtc(desde: string, hasta: string): number {
  const [y0, m0, d0] = desde.split('-').map(Number);
  const [y1, m1, d1] = hasta.split('-').map(Number);
  const t0 = Date.UTC(y0, m0 - 1, d0);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  return Math.round((t1 - t0) / 86_400_000);
}

export function vencimientoQendraExport(
  fechaVencimiento: string | null | undefined,
  hoyYmd?: string,
): string {
  const raw = (fechaVencimiento ?? '').trim();
  if (!raw) return '0';
  const ymd = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '0';
  const hoy = hoyYmd ?? fechaLocalYmd(new Date());
  const dias = diasEntreYmdUtc(hoy, ymd);
  if (dias <= 0) return '0';
  return String(dias);
}

export function truncarDescripcionBalanza(nombre: string, max = 40): string {
  const t = nombre.trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
}

export function productoAFilaQendraBalanza(p: ProductoQendraBalanzaInput): string[] {
  const plu = pluParaExportQendra(p.plu);
  const precioLista1 = p.precioVenta;
  return [
    p.sector.trim(),
    plu,
    truncarDescripcionBalanza(p.nombre),
    plu,
    formatPrecioQendra(precioLista1),
    precioLista2Qendra(precioLista1, p.descuentoPct),
    tipoVentaQendraProducto(p.esPesable, p.unidad),
    vencimientoQendraExport(p.fechaVencimiento),
    (p.ingredientes ?? '').trim(),
  ];
}

export function filasQendraBalanzaACsv(filas: string[][]): string {
  const lines = filas.map((row) => row.map((c) => escapeCampoQendra(c ?? '')).join(';'));
  return `\uFEFF${lines.join('\r\n')}`;
}

export function dedupeProductosPorId<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
