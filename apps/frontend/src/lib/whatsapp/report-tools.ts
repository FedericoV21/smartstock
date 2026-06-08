import { buildWhatsAppCierreCajaReply } from '@/lib/caja/whatsapp-cierre-caja';
import { factorLineasVsTotalComprobante } from '@/lib/facturacion/reconciliar-items-total';
import { aplanarRepresentativosVentaPorOrden } from '@/lib/facturacion/ventas-representativas-por-orden';
import { horaArgentina, sumarDiasYmd, ymdArgentina } from '@/lib/reportes/periodos';
import { generateAndUploadWhatsAppReportPdf } from '@/lib/whatsapp/report-pdf';
import type { VentasPosResolvedFilters } from '@/lib/whatsapp/ventas-pos-report';

const WHATSAPP_VENTAS_ARTICULO_TOP_N = 10;
const WHATSAPP_VENTAS_ARTICULO_PDF_MIN_ROWS = 40;

export type WhatsAppReportPeriod = {
  desde: string;
  hasta: string;
  label: string;
};

const SALES_MONTHS = [
  { names: ['enero', 'ene'], month: 1, label: 'Enero' },
  { names: ['febrero', 'feb'], month: 2, label: 'Febrero' },
  { names: ['marzo', 'mar'], month: 3, label: 'Marzo' },
  { names: ['abril', 'abr'], month: 4, label: 'Abril' },
  { names: ['mayo', 'may'], month: 5, label: 'Mayo' },
  { names: ['junio', 'jun'], month: 6, label: 'Junio' },
  { names: ['julio', 'jul'], month: 7, label: 'Julio' },
  { names: ['agosto', 'ago'], month: 8, label: 'Agosto' },
  { names: ['septiembre', 'setiembre', 'sep', 'set'], month: 9, label: 'Septiembre' },
  { names: ['octubre', 'oct'], month: 10, label: 'Octubre' },
  { names: ['noviembre', 'nov'], month: 11, label: 'Noviembre' },
  { names: ['diciembre', 'dic'], month: 12, label: 'Diciembre' },
] as const;

const SALES_MONTH_PATTERN = SALES_MONTHS.flatMap((item) => item.names).join('|');

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
}

function formatPeriodRange(period: WhatsAppReportPeriod): string {
  if (period.desde === period.hasta) return `(${period.desde})`;
  return `(${period.desde} a ${period.hasta})`;
}

function detectNamedMonth(text: string): WhatsAppReportPeriod | null {
  const match = text.match(new RegExp(`\\b(${SALES_MONTH_PATTERN})\\b(?:\\s+(\\d{4}))?`));
  if (!match?.[1]) return null;
  const monthConfig = SALES_MONTHS.find((item) => item.names.some((name) => name === match[1]));
  if (!monthConfig) return null;
  const hoy = ymdArgentina();
  const currentYear = Number(hoy.slice(0, 4));
  const currentMonth = Number(hoy.slice(5, 7));
  const explicitYear = match[2] ? Number(match[2]) : null;
  const year = explicitYear ?? (monthConfig.month > currentMonth ? currentYear - 1 : currentYear);
  const month = String(monthConfig.month).padStart(2, '0');
  const desde = `${year}-${month}-01`;
  const lastDay = new Date(year, monthConfig.month, 0).getDate();
  const hasta = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
  return { desde, hasta, label: `${monthConfig.label} ${year}` };
}

export function resolveWhatsAppReportPeriod(text: string, defaultToMonth = false): WhatsAppReportPeriod {
  const normalized = normalizeText(text);
  const named = detectNamedMonth(normalized);
  if (named) return named;

  const hoy = ymdArgentina();
  if (/\bayer\b/.test(normalized)) {
    const ayer = sumarDiasYmd(hoy, -1);
    return { desde: ayer, hasta: ayer, label: 'Ayer' };
  }
  if (/\bhoy\b/.test(normalized)) {
    return { desde: hoy, hasta: hoy, label: 'Hoy' };
  }
  if (/\b(semana|semanal)\b/.test(normalized)) {
    const d = new Date(`${hoy}T12:00:00`);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const desde = sumarDiasYmd(hoy, -diff);
    return { desde, hasta: hoy, label: 'Esta semana' };
  }
  if (/\bmes\s+(?:anterior|pasado)\b/.test(normalized)) {
    const prev = sumarDiasYmd(`${hoy.slice(0, 7)}-01`, -1);
    const desde = `${prev.slice(0, 7)}-01`;
    return { desde, hasta: prev, label: 'Mes anterior' };
  }
  if (/\b(?:mes|mensual)\b/.test(normalized) || defaultToMonth) {
    const desde = `${hoy.slice(0, 7)}-01`;
    return { desde, hasta: hoy, label: 'Este mes' };
  }
  return { desde: hoy, hasta: hoy, label: 'Hoy' };
}

export type WhatsAppComparativoPeriods = {
  current: WhatsAppReportPeriod;
  previous: WhatsAppReportPeriod;
};

function stripComparativoPeriodNoise(text: string): string {
  return text
    .replace(/\b(?:vs|versus|contra|frente\s+a|respecto\s+a)\b.*$/gi, '')
    .replace(/\bcomparad[oa]?\s+(?:con\s+)?(?:el\s+)?/gi, '')
    .replace(/\bmes\s+(?:anterior|pasado)\b/gi, '')
    .replace(/\bperiodo\s+anterior\b/gi, '')
    .trim();
}

function periodoMesCalendarioAnterior(desdeYmd: string): WhatsAppReportPeriod {
  const prevEnd = sumarDiasYmd(desdeYmd, -1);
  const monthKey = prevEnd.slice(0, 7);
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const lastDay = new Date(year, month, 0).getDate();
  const monthCfg = SALES_MONTHS.find((item) => item.month === month);
  return {
    desde: `${monthKey}-01`,
    hasta: `${monthKey}-${String(lastDay).padStart(2, '0')}`,
    label: monthCfg ? `${monthCfg.label} ${year}` : `Mes anterior`,
  };
}

export function resolveWhatsAppComparativoPeriods(text: string): WhatsAppComparativoPeriods {
  const normalized = normalizeText(text);
  const named = detectNamedMonth(normalized);
  if (named) {
    return {
      current: named,
      previous: periodoMesCalendarioAnterior(named.desde),
    };
  }
  const current = resolveWhatsAppReportPeriod(stripComparativoPeriodNoise(text) || 'este mes', true);
  const hoy = ymdArgentina();
  const prevEnd = sumarDiasYmd(`${hoy.slice(0, 7)}-01`, -1);
  const previous: WhatsAppReportPeriod = {
    desde: `${prevEnd.slice(0, 7)}-01`,
    hasta: prevEnd,
    label: 'Mes anterior',
  };
  return { current, previous };
}

export type VentasNetasPeriodo = {
  ingresosNetos: number;
  comprobantesVenta: number;
};

export async function computeVentasNetasPeriod(
  db: any,
  tenantId: string,
  period: WhatsAppReportPeriod,
): Promise<VentasNetasPeriodo> {
  const { data, error } = await db
    .from('comprobante')
    .select('id, total, tipo, numero_orden')
    .eq('tenant_id', tenantId)
    .eq('estado', 'emitido')
    .gte('fecha', period.desde)
    .lte('fecha', period.hasta);
  if (error) throw new Error(error.message);

  const rows = aplanarRepresentativosVentaPorOrden(
    ((data ?? []) as Array<{ id: string; total: number | string | null; tipo: string | null; numero_orden?: number | null }>).map(
      (row) => ({ ...row, tipo: String(row.tipo ?? '') }),
    ),
  );

  let ingresosNetos = 0;
  let comprobantesVenta = 0;

  for (const row of rows) {
    const tipo = String(row.tipo ?? '');
    const total = Number(row.total ?? 0);
    if (!Number.isFinite(total)) continue;
    if (tipo === 'presupuesto' || tipo === 'remito' || tipo === 'devolucion_remito' || tipo === 'recibo') continue;
    if (isCreditNoteType(tipo)) {
      ingresosNetos -= total;
      continue;
    }
    if (!isSalesReceiptType(tipo)) continue;
    ingresosNetos += total;
    comprobantesVenta += 1;
  }

  return { ingresosNetos: roundMoney(ingresosNetos), comprobantesVenta };
}

function formatVariacionLine(current: number, previous: number): string {
  const delta = roundMoney(current - previous);
  if (previous === 0) {
    if (current === 0) {
      return '- Variacion: sin cambio (ambos periodos en $0).';
    }
    return `- Variacion: ${formatAmount(delta)} (sin ventas en el periodo anterior).`;
  }
  const pct = roundMoney((delta / Math.abs(previous)) * 100);
  const pctLabel = pct >= 0 ? `+${pct}%` : `${pct}%`;
  const deltaLabel = delta >= 0 ? `+${formatAmount(delta)}` : formatAmount(delta);
  return `- Variacion: ${deltaLabel} (${pctLabel} vs periodo anterior).`;
}

export async function runReporteComparativoVentasTool(
  db: any,
  tenantId: string,
  periods: WhatsAppComparativoPeriods,
): Promise<string> {
  const [actual, anterior] = await Promise.all([
    computeVentasNetasPeriod(db, tenantId, periods.current),
    computeVentasNetasPeriod(db, tenantId, periods.previous),
  ]);

  const rangeActual = formatPeriodRange(periods.current);
  const rangeAnterior = formatPeriodRange(periods.previous);

  if (actual.comprobantesVenta === 0 && anterior.comprobantesVenta === 0) {
    return [
      `Comparativo de ventas · ${periods.current.label} ${rangeActual} vs ${periods.previous.label} ${rangeAnterior}`,
      'No hay ventas emitidas en ninguno de los dos periodos.',
      'Alcance v1: solo ingresos netos (facturas + tickets POS, menos notas de credito).',
    ].join('\n');
  }

  return [
    `Comparativo de ventas · ${periods.current.label} ${rangeActual} vs ${periods.previous.label} ${rangeAnterior}`,
    `- Ingresos netos actual: ${formatAmount(actual.ingresosNetos)}`,
    `- Ingresos netos periodo anterior: ${formatAmount(anterior.ingresosNetos)}`,
    formatVariacionLine(actual.ingresosNetos, anterior.ingresosNetos),
    `- Comprobantes de venta: ${actual.comprobantesVenta} actual vs ${anterior.comprobantesVenta} anterior`,
    'Alcance v1: solo ingresos netos agregados (sin margen ni ranking de productos).',
  ].join('\n');
}

function isSalesReceiptType(tipo: string): boolean {
  return tipo.startsWith('factura_') || tipo === 'ticket';
}

function isCreditNoteType(tipo: string): boolean {
  return tipo.startsWith('nota_credito_');
}

export async function runReporteResumenTool(
  db: any,
  tenantId: string,
  period: WhatsAppReportPeriod,
): Promise<string> {
  const { data, error } = await db
    .from('comprobante')
    .select('id, total, tipo, numero_orden')
    .eq('tenant_id', tenantId)
    .eq('estado', 'emitido')
    .gte('fecha', period.desde)
    .lte('fecha', period.hasta);
  if (error) throw new Error(error.message);

  const rows = aplanarRepresentativosVentaPorOrden(
    ((data ?? []) as Array<{ id: string; total: number | string | null; tipo: string | null; numero_orden?: number | null }>).map(
      (row) => ({ ...row, tipo: String(row.tipo ?? '') }),
    ),
  );

  let facturado = 0;
  let montoFacturas = 0;
  let montoTickets = 0;
  let montoNotasCredito = 0;
  let comprobantesFactura = 0;
  let comprobantesTicket = 0;
  let comprobantesVenta = 0;

  for (const row of rows) {
    const tipo = String(row.tipo ?? '');
    const total = Number(row.total ?? 0);
    if (!Number.isFinite(total)) continue;
    if (tipo === 'presupuesto' || tipo === 'remito' || tipo === 'devolucion_remito' || tipo === 'recibo') continue;
    if (isCreditNoteType(tipo)) {
      facturado -= total;
      montoNotasCredito += total;
      continue;
    }
    if (!isSalesReceiptType(tipo)) continue;
    facturado += total;
    comprobantesVenta += 1;
    if (tipo.startsWith('factura_')) {
      montoFacturas += total;
      comprobantesFactura += 1;
    } else if (tipo === 'ticket') {
      montoTickets += total;
      comprobantesTicket += 1;
    }
  }

  const { data: cuentas, error: cuentaErr } = await db.from('cuenta_corriente').select('saldo').gt('saldo', 0);
  if (cuentaErr) throw new Error(cuentaErr.message);
  let deudaCtaCte = 0;
  for (const r of cuentas ?? []) {
    deudaCtaCte += Number((r as { saldo: number }).saldo ?? 0);
  }

  const range = formatPeriodRange(period);
  if (comprobantesVenta === 0 && montoNotasCredito === 0) {
    return `Resumen ${period.label} ${range}: sin ventas emitidas en el periodo. Deuda cuenta corriente activa: ${formatAmount(roundMoney(deudaCtaCte))}.`;
  }

  return [
    `Resumen ${period.label} ${range}`,
    `- Ingresos netos: ${formatAmount(roundMoney(facturado))}`,
    `- Facturas fiscales: ${formatAmount(roundMoney(montoFacturas))} (${comprobantesFactura})`,
    `- Tickets POS: ${formatAmount(roundMoney(montoTickets))} (${comprobantesTicket})`,
    montoNotasCredito > 0
      ? `- Notas de credito: -${formatAmount(roundMoney(montoNotasCredito))}`
      : null,
    `- Comprobantes de venta: ${comprobantesVenta}`,
    `- Deuda cuenta corriente (hoy): ${formatAmount(roundMoney(deudaCtaCte))}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function runReporteVencimientosTool(db: any, tenantId: string): Promise<string> {
  const en30dias = sumarDiasYmd(ymdArgentina(), 30);
  const { data, error } = await db
    .from('producto')
    .select('id, codigo, nombre, fecha_vencimiento, stock_actual')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .not('fecha_vencimiento', 'is', null)
    .lte('fecha_vencimiento', en30dias)
    .order('fecha_vencimiento', { ascending: true })
    .limit(15);
  if (error) throw new Error(error.message);

  const productos = (data ?? []) as Array<{
    codigo: string;
    nombre: string;
    fecha_vencimiento: string;
    stock_actual: number | string | null;
  }>;

  let vencidos = 0;
  let criticos = 0;
  let proximos = 0;
  const lines: string[] = [];

  for (const p of productos) {
    const dias = Math.ceil(
      (new Date(`${p.fecha_vencimiento}T12:00:00`).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    const estado = dias < 0 ? 'vencido' : dias <= 7 ? 'critico' : 'proximo';
    if (estado === 'vencido') vencidos += 1;
    else if (estado === 'critico') criticos += 1;
    else proximos += 1;
    if (lines.length < 8) {
      lines.push(
        `- ${p.nombre} (${p.codigo}): vence ${p.fecha_vencimiento}, stock ${p.stock_actual ?? 0}${dias < 0 ? ' [VENCIDO]' : dias <= 7 ? ' [CRITICO]' : ''}`,
      );
    }
  }

  if (productos.length === 0) {
    return 'No hay productos con vencimiento en los proximos 30 dias.';
  }

  return [
    `Vencimientos (proximos 30 dias): ${vencidos} vencidos, ${criticos} criticos (7 dias), ${proximos} proximos.`,
    ...lines,
    productos.length > 8 ? 'Hay mas productos en la app (Reportes / alertas).' : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function ventasPosFilterSuffix(filters: VentasPosResolvedFilters): string {
  const parts: string[] = [];
  if (filters.cajaLabel) parts.push(`caja ${filters.cajaLabel}`);
  if (filters.operadorLabel) parts.push(`operador ${filters.operadorLabel}`);
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

export async function runReporteVentasPosTool(
  db: any,
  tenantId: string,
  period: WhatsAppReportPeriod,
  filters: VentasPosResolvedFilters = {},
): Promise<string> {
  let query = db
    .from('comprobante')
    .select('id, total, created_at, metodo_pago')
    .eq('tenant_id', tenantId)
    .eq('estado', 'emitido')
    .eq('tipo', 'ticket')
    .gte('fecha', period.desde)
    .lte('fecha', period.hasta);
  if (filters.cajaId) query = query.eq('caja_id', filters.cajaId);
  if (filters.usuarioId) query = query.eq('usuario_id', filters.usuarioId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const filterSuffix = ventasPosFilterSuffix(filters);

  const tickets = (data ?? []) as Array<{ total: number | string | null }>;
  const totalTickets = tickets.length;
  const totalVendido = roundMoney(tickets.reduce((acc, t) => acc + Number(t.total ?? 0), 0));
  const ticketPromedio = totalTickets > 0 ? roundMoney(totalVendido / totalTickets) : 0;

  const byHour = new Map<number, number>();
  for (const t of data ?? []) {
    const row = t as { created_at?: string | null; total?: number | string | null };
    if (!row.created_at) continue;
    const h = horaArgentina(new Date(row.created_at));
    if (h == null) continue;
    byHour.set(h, (byHour.get(h) ?? 0) + Number(row.total ?? 0));
  }
  let peakHour = -1;
  let peakAmount = 0;
  for (const [h, amount] of byHour) {
    if (amount > peakAmount) {
      peakAmount = amount;
      peakHour = h;
    }
  }

  const range = formatPeriodRange(period);
  if (totalTickets === 0) {
    return `Ventas POS ${period.label} ${range}${filterSuffix}: no hay tickets emitidos con ese filtro.`;
  }

  const lines = [
    `Ventas POS (tickets) ${period.label} ${range}${filterSuffix}`,
    `- Tickets: ${totalTickets}`,
    `- Total vendido: ${formatAmount(totalVendido)}`,
    `- Ticket promedio: ${formatAmount(ticketPromedio)}`,
  ];
  if (peakHour >= 0) {
    lines.push(`- Franja con mas ventas: ${String(peakHour).padStart(2, '0')}:00 (${formatAmount(roundMoney(peakAmount))})`);
  }
  return lines.join('\n');
}

export async function runReporteRecibosTool(
  db: any,
  tenantId: string,
  period: WhatsAppReportPeriod,
): Promise<string> {
  const { data: recibos, error: recErr } = await db
    .from('comprobante')
    .select('id, fecha, total, metodo_pago, cliente:cliente_id(nombre)')
    .eq('tenant_id', tenantId)
    .eq('tipo', 'recibo')
    .eq('estado', 'emitido')
    .gte('fecha', period.desde)
    .lte('fecha', period.hasta)
    .order('fecha', { ascending: false })
    .limit(20);
  if (recErr) throw new Error(recErr.message);

  const items = (recibos ?? []) as Array<{
    fecha: string;
    total: number | string | null;
    metodo_pago?: string | null;
    cliente?: { nombre: string } | Array<{ nombre: string }> | null;
  }>;

  let total = 0;
  const lines: string[] = [];
  for (const r of items.slice(0, 8)) {
    const cli = Array.isArray(r.cliente) ? r.cliente[0] : r.cliente;
    const monto = Number(r.total ?? 0);
    total += monto;
    lines.push(
      `- ${r.fecha} ${cli?.nombre ?? 'Sin cliente'}: ${formatAmount(roundMoney(monto))} (${r.metodo_pago ?? '—'})`,
    );
  }

  const range = formatPeriodRange(period);
  if (items.length === 0) {
    return `Recibos ${period.label} ${range}: no hay recibos emitidos en el periodo.`;
  }

  const fullTotal = items.reduce((acc, r) => acc + Number(r.total ?? 0), 0);
  return [
    `Recibos ${period.label} ${range}: ${items.length} comprobante(s), total ${formatAmount(roundMoney(fullTotal))}.`,
    ...lines,
    items.length > 8 ? 'Hay mas recibos en la app.' : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function runReporteLibroIvaTool(
  db: any,
  tenantId: string,
  period: WhatsAppReportPeriod,
): Promise<string> {
  const { data, error } = await db
    .from('comprobante')
    .select('tipo, subtotal, iva_monto, total')
    .eq('tenant_id', tenantId)
    .eq('estado', 'emitido')
    .gte('fecha', period.desde)
    .lte('fecha', period.hasta);
  if (error) throw new Error(error.message);

  let neto = 0;
  let iva = 0;
  let total = 0;
  let docs = 0;

  for (const row of data ?? []) {
    const tipo = String((row as { tipo: string }).tipo ?? '');
    if (
      !tipo.startsWith('factura_') &&
      !tipo.startsWith('nota_credito_')
    ) {
      continue;
    }
    const sign = tipo.startsWith('nota_credito_') ? -1 : 1;
    neto += Number((row as { subtotal: number }).subtotal ?? 0) * sign;
    iva += Number((row as { iva_monto: number }).iva_monto ?? 0) * sign;
    total += Number((row as { total: number }).total ?? 0) * sign;
    docs += 1;
  }

  const range = formatPeriodRange(period);
  if (docs === 0) {
    return `Libro IVA ${period.label} ${range}: sin comprobantes fiscales en el periodo.`;
  }

  return [
    `Libro IVA ${period.label} ${range}`,
    `- Comprobantes: ${docs}`,
    `- Neto gravado: ${formatAmount(roundMoney(neto))}`,
    `- IVA: ${formatAmount(roundMoney(iva))}`,
    `- Total: ${formatAmount(roundMoney(total))}`,
  ].join('\n');
}

export async function runReporteGastoProveedoresTool(
  db: any,
  tenantId: string,
  period: WhatsAppReportPeriod,
): Promise<string> {
  const { data, error } = await db
    .from('comprobante_item')
    .select(
      `
      cantidad,
      precio_costo,
      comprobante:comprobante_id!inner (fecha, estado, tipo, tenant_id),
      producto:producto_id!inner (proveedor_id)
    `,
    )
    .eq('comprobante.tenant_id', tenantId)
    .eq('comprobante.estado', 'emitido')
    .gte('comprobante.fecha', period.desde)
    .lte('comprobante.fecha', period.hasta);
  if (error) throw new Error(error.message);

  const gastoPorProveedor = new Map<string, number>();
  for (const raw of data ?? []) {
    const comp = Array.isArray((raw as any).comprobante) ? (raw as any).comprobante[0] : (raw as any).comprobante;
    const prod = Array.isArray((raw as any).producto) ? (raw as any).producto[0] : (raw as any).producto;
    if (!comp || !prod?.proveedor_id) continue;
    const tipo = String(comp.tipo ?? '');
    if (!isSalesReceiptType(tipo) && !isCreditNoteType(tipo)) continue;
    const sign = isCreditNoteType(tipo) ? -1 : 1;
    const costo = Number((raw as any).precio_costo ?? 0) * Number((raw as any).cantidad ?? 0) * sign;
    const prev = gastoPorProveedor.get(prod.proveedor_id) ?? 0;
    gastoPorProveedor.set(prod.proveedor_id, prev + costo);
  }

  const ids = Array.from(gastoPorProveedor.keys());
  if (ids.length === 0) {
    return `Gasto por proveedor ${period.label} ${formatPeriodRange(period)}: sin costo asociado a ventas en el periodo.`;
  }

  const { data: provs, error: provErr } = await db.from('proveedor').select('id, nombre').in('id', ids);
  if (provErr) throw new Error(provErr.message);
  const nombres = new Map((provs ?? []).map((p: { id: string; nombre: string }) => [p.id, p.nombre]));

  const ranking = ids
    .map((id) => ({
      nombre: nombres.get(id) ?? 'Proveedor',
      gasto: roundMoney(gastoPorProveedor.get(id) ?? 0),
    }))
    .filter((r) => r.gasto !== 0)
    .sort((a, b) => b.gasto - a.gasto)
    .slice(0, 8);

  const total = roundMoney(ranking.reduce((acc, r) => acc + r.gasto, 0));
  const lines = ranking.map((r, i) => `${i + 1}. ${r.nombre}: ${formatAmount(r.gasto)}`);

  return [
    `Gasto por proveedor (costo vendido) ${period.label} ${formatPeriodRange(period)}`,
    `- Total top: ${formatAmount(total)}`,
    ...lines,
  ].join('\n');
}

function formatUnits(value: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(value);
}

function isReportableSalesLineType(tipo: string): boolean {
  if (tipo === 'presupuesto' || tipo === 'remito' || tipo === 'devolucion_remito' || tipo === 'recibo') return false;
  return isSalesReceiptType(tipo) || isCreditNoteType(tipo);
}

/** Ranking por SKU con margen (alineado a GET /api/reportes/ventas-articulo, sin filtros avanzados). */
export async function runReporteVentasArticuloTool(
  db: any,
  tenantId: string,
  message: string,
): Promise<{ reply: string; memoryOptions?: string[] }> {
  const period = resolveWhatsAppReportPeriod(message, true);
  const { data, error } = await db
    .from('comprobante_item')
    .select(
      `
      cantidad,
      precio_costo,
      subtotal,
      producto_id,
      comprobante:comprobante_id!inner (id, tenant_id, fecha, tipo, estado, fiscalizado_por_id, total),
      producto:producto_id (id, codigo, nombre)
    `,
    )
    .eq('comprobante.tenant_id', tenantId)
    .eq('comprobante.estado', 'emitido')
    .gte('comprobante.fecha', period.desde)
    .lte('comprobante.fecha', period.hasta);
  if (error) throw new Error(error.message);

  type ItemRow = {
    cantidad: number | string | null;
    precio_costo?: number | string | null;
    subtotal: number | string | null;
    producto_id: string | null;
    comprobante: any;
    producto: any;
  };

  const rows = ((data ?? []) as ItemRow[])
    .map((raw) => {
      const comp = Array.isArray(raw.comprobante) ? raw.comprobante[0] : raw.comprobante;
      const prod = Array.isArray(raw.producto) ? raw.producto[0] : raw.producto;
      return { raw, comp, prod };
    })
    .filter(({ raw, comp, prod }) => {
      if (!comp || !prod) return false;
      if (String(comp.tenant_id ?? tenantId) !== tenantId) return false;
      if (String(comp.estado ?? '') !== 'emitido') return false;
      const tipo = String(comp.tipo ?? '');
      if (!isReportableSalesLineType(tipo)) return false;
      if (tipo === 'ticket' && comp.fiscalizado_por_id) return false;
      return Boolean(raw.producto_id || prod.id);
    });

  const sumaLineasPorComp = new Map<string, number>();
  const totalPorComp = new Map<string, number>();
  for (const { raw, comp } of rows) {
    const compId = String(comp.id ?? '');
    const subtotal = Number(raw.subtotal ?? 0);
    if (!compId || !Number.isFinite(subtotal)) continue;
    sumaLineasPorComp.set(compId, (sumaLineasPorComp.get(compId) ?? 0) + subtotal);
    totalPorComp.set(compId, Number(comp.total ?? subtotal));
  }

  const factorPorComp = new Map<string, number>();
  for (const [compId, sumaLineas] of sumaLineasPorComp) {
    const totalComp = totalPorComp.get(compId) ?? sumaLineas;
    factorPorComp.set(compId, factorLineasVsTotalComprobante(totalComp, sumaLineas));
  }

  const agg = new Map<
    string,
    {
      nombre: string;
      codigo: string;
      unidades: number;
      importe: number;
      costo: number;
    }
  >();

  for (const { raw, comp, prod } of rows) {
    const tipo = String(comp.tipo ?? '');
    const sign = isCreditNoteType(tipo) ? -1 : 1;
    const compId = String(comp.id ?? '');
    const productId = String(raw.producto_id ?? prod.id ?? '');
    if (!productId || !compId) continue;

    const factor = factorPorComp.get(compId) ?? 1;
    const unidades = Number(raw.cantidad ?? 0) * sign;
    const importe = roundMoney(Number(raw.subtotal ?? 0) * factor) * sign;
    const costo = Number(raw.precio_costo ?? 0) * Number(raw.cantidad ?? 0) * sign;
    if (!Number.isFinite(unidades) && !Number.isFinite(importe)) continue;

    const prev = agg.get(productId) ?? {
      nombre: String(prod.nombre ?? 'Producto'),
      codigo: String(prod.codigo ?? '-'),
      unidades: 0,
      importe: 0,
      costo: 0,
    };
    prev.unidades += unidades;
    prev.importe += importe;
    prev.costo += costo;
    agg.set(productId, prev);
  }

  const items = Array.from(agg.values())
    .map((row) => ({
      ...row,
      importe: roundMoney(row.importe),
      costo: roundMoney(row.costo),
      margen: roundMoney(row.importe - row.costo),
      margenPct: row.importe === 0 ? null : roundMoney(((row.importe - row.costo) / row.importe) * 100),
    }))
    .filter((row) => row.unidades !== 0 || row.importe !== 0)
    .sort((a, b) => b.importe - a.importe);

  const periodRange = formatPeriodRange(period);
  if (items.length === 0) {
    return {
      reply: `No encontre ventas por articulo para ${period.label.toLowerCase()} ${periodRange}.`,
    };
  }

  const totalUnidades = roundMoney(items.reduce((acc, row) => acc + row.unidades, 0));
  const totalImporte = roundMoney(items.reduce((acc, row) => acc + row.importe, 0));
  const totalMargen = roundMoney(items.reduce((acc, row) => acc + row.margen, 0));
  const top = items.slice(0, WHATSAPP_VENTAS_ARTICULO_TOP_N);
  const lines = [
    `Ventas por articulo · ${period.label} ${periodRange}`,
    ...top.map((row, idx) => {
      const margenPct =
        row.margenPct == null ? '' : ` · margen ${row.margenPct.toLocaleString('es-AR')}%`;
      return `${idx + 1}) ${row.nombre} (${row.codigo}): ${formatUnits(row.unidades)} u · ${formatAmount(
        row.importe,
      )} · margen ${formatAmount(row.margen)}${margenPct}`;
    }),
    `Total periodo: ${formatUnits(totalUnidades)} u · ventas ${formatAmount(totalImporte)} · margen ${formatAmount(totalMargen)}`,
  ];

  if (items.length > WHATSAPP_VENTAS_ARTICULO_PDF_MIN_ROWS) {
    const pdfUrl = await generateAndUploadWhatsAppReportPdf({
      db,
      tenantId,
      reportKey: 'ventas-articulo',
      title: 'Ventas por articulo (SKU)',
      subtitleLines: [
        `Periodo: ${period.label} ${periodRange}`,
        `Articulos con venta: ${items.length}`,
        `Total ventas: ${formatAmount(totalImporte)}`,
        `Margen bruto estimado: ${formatAmount(totalMargen)}`,
      ],
      columns: ['Producto', 'Codigo', 'Unidades', 'Importe', 'Margen', 'Margen %'],
      rows: items.map((row) => [
        row.nombre,
        row.codigo,
        formatUnits(row.unidades),
        formatAmount(row.importe),
        formatAmount(row.margen),
        row.margenPct == null ? '-' : `${row.margenPct}%`,
      ]),
    });
    if (pdfUrl) {
      lines.push(`PDF completo: ${pdfUrl}`);
    }
  }

  return {
    reply: lines.join('\n'),
    memoryOptions: top.map((row) => row.nombre),
  };
}

export async function runReporteCierreCajaTool(
  db: any,
  tenantId: string,
  message: string,
): Promise<string> {
  return buildWhatsAppCierreCajaReply(db, tenantId, message);
}
