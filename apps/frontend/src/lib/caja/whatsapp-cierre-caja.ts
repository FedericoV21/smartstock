import { calcularSnapshot, normalizarCaja, redondear2, type SnapshotCierreZ } from '@/lib/caja/cierre-z-calculo';
import { obtenerAperturaVigente } from '@/lib/caja/sesion-caja';
import { sumarDiasYmd, ymdArgentina } from '@/lib/reportes/periodos';

export type CierreCajaPeriodKey = 'hoy' | 'ayer';

export type ArqueoEfectivoResumen = {
  fondo_apertura?: number;
  efectivo_ventas_periodo?: number;
  esperado_sistema?: number;
  gastos_monto?: number;
  esperado_ajustado?: number;
  contado?: number;
  diferencia?: number;
};

function formatAmount(value: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value);
}

function readArqueoFromPayload(payload: unknown): ArqueoEfectivoResumen | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = (payload as Record<string, unknown>).arqueo_efectivo;
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const num = (k: string) => {
    const v = Number(a[k]);
    return Number.isFinite(v) ? v : undefined;
  };
  return {
    fondo_apertura: num('fondo_apertura'),
    efectivo_ventas_periodo: num('efectivo_ventas_periodo'),
    esperado_sistema: num('esperado_sistema'),
    gastos_monto: num('gastos_monto'),
    esperado_ajustado: num('esperado_ajustado'),
    contado: num('contado'),
    diferencia: num('diferencia'),
  };
}

function formatCajaLabel(cajaId: string): string {
  if (cajaId === '__sin_caja__') return 'Caja general';
  return `Caja ${cajaId}`;
}

export function detectCierreCajaPeriodKey(message: string): CierreCajaPeriodKey {
  const text = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/\bayer\b/.test(text)) return 'ayer';
  return 'hoy';
}

export function fechaOperativaForCierrePeriod(period: CierreCajaPeriodKey, anchorYmd = ymdArgentina()): string {
  return period === 'ayer' ? sumarDiasYmd(anchorYmd, -1) : anchorYmd;
}

export async function resolveDefaultSucursalForWhatsApp(
  db: any,
  tenantId: string,
): Promise<{ id: string; nombre: string } | null> {
  const { data, error } = await db
    .from('sucursal')
    .select('id, nombre, codigo')
    .eq('tenant_id', tenantId)
    .eq('activa', true)
    .order('codigo', { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as { id: string; nombre: string } | undefined;
  return row ? { id: row.id, nombre: row.nombre } : null;
}

function formatSnapshotLive(
  snapshot: SnapshotCierreZ,
  opts: { periodLabel: string; fechaYmd: string; sucursalNombre: string; cajaId: string },
): string {
  const lines = [
    `Arqueo de caja · ${opts.periodLabel} (${opts.fechaYmd}) · ${opts.sucursalNombre}`,
    `Turno abierto · ${formatCajaLabel(opts.cajaId)}`,
    `- Ventas netas del turno: ${formatAmount(redondear2(snapshot.ventas_netas))}`,
    `- Comprobantes: ${snapshot.total_comprobantes}`,
    `- Fondo apertura: ${formatAmount(redondear2(snapshot.fondo_apertura))}`,
    `- Efectivo sistema (gaveta esperada): ${formatAmount(redondear2(snapshot.efectivo_esperado))}`,
    'Aun no hay cierre Z registrado para este turno. Para cerrar, usá la pantalla de Cierre de caja en SmartStock.',
  ];
  return lines.join('\n');
}

function formatCierrePersistido(
  row: {
    caja_id: string;
    ventas_netas: number | string;
    total_comprobantes: number;
    payload_resumen: unknown;
  },
  opts: { periodLabel: string; fechaYmd: string; sucursalNombre: string },
): string {
  const arqueo = readArqueoFromPayload(row.payload_resumen);
  const lines = [
    `Cierre de caja · ${opts.periodLabel} (${opts.fechaYmd}) · ${opts.sucursalNombre}`,
    `${formatCajaLabel(String(row.caja_id))} · cierre Z registrado`,
    `- Ventas netas: ${formatAmount(redondear2(Number(row.ventas_netas ?? 0)))}`,
    `- Comprobantes: ${Number(row.total_comprobantes ?? 0)}`,
  ];
  if (arqueo?.esperado_sistema != null) {
    lines.push(`- Efectivo sistema: ${formatAmount(redondear2(arqueo.esperado_sistema))}`);
  }
  if (arqueo?.contado != null) {
    lines.push(`- Efectivo contado: ${formatAmount(redondear2(arqueo.contado))}`);
  }
  if (arqueo?.diferencia != null) {
    lines.push(`- Diferencia arqueo: ${formatAmount(redondear2(arqueo.diferencia))}`);
  }
  return lines.join('\n');
}

/**
 * Consulta read-only de cierre/arqueo (misma base que GET /api/caja/cierre-z).
 * Solo periodos por dia: hoy y ayer. Sin filtro de caja en v1 (agrega todas las cajas del dia).
 */
export async function buildWhatsAppCierreCajaReply(
  db: any,
  tenantId: string,
  message: string,
): Promise<string> {
  const sucursal = await resolveDefaultSucursalForWhatsApp(db, tenantId);
  if (!sucursal) {
    return 'No hay sucursal activa configurada. Configurá una sucursal en SmartStock para consultar cierre de caja.';
  }

  const period = detectCierreCajaPeriodKey(message);
  const fechaYmd = fechaOperativaForCierrePeriod(period);
  const periodLabel = period === 'ayer' ? 'Ayer' : 'Hoy';

  const { data: cierres, error } = await db
    .from('cierre_z')
    .select('id, caja_id, ventas_netas, total_comprobantes, payload_resumen, tipo_cierre')
    .eq('tenant_id', tenantId)
    .eq('sucursal_id', sucursal.id)
    .eq('fecha_operativa', fechaYmd)
    .eq('tipo_cierre', 'diario')
    .order('caja_id', { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (cierres ?? []) as Array<{
    caja_id: string;
    ventas_netas: number | string;
    total_comprobantes: number;
    payload_resumen: unknown;
  }>;

  if (rows.length > 0) {
    const blocks = rows.map((row) =>
      formatCierrePersistido(row, { periodLabel, fechaYmd, sucursalNombre: sucursal.nombre }),
    );
    if (rows.length > 1) {
      blocks.push('(Varias cajas con cierre ese dia; sin filtro por caja en WhatsApp v1.)');
    }
    return blocks.join('\n\n');
  }

  if (period === 'ayer') {
    return `No hay cierre de caja registrado para ayer (${fechaYmd}) en ${sucursal.nombre}.`;
  }

  const cajaId = normalizarCaja(null);
  const apertura = await obtenerAperturaVigente(db, cajaId, sucursal.id);
  if (!apertura) {
    const { data: turnoAbierto } = await db
      .from('caja_turno')
      .select('id, caja_id')
      .eq('tenant_id', tenantId)
      .eq('estado', 'abierto')
      .limit(1)
      .maybeSingle();
    if (turnoAbierto?.id) {
      return [
        `Cierre de caja · ${periodLabel} (${fechaYmd}) · ${sucursal.nombre}`,
        'Hay un turno de caja abierto en el sistema, pero no pude leer la apertura asociada para calcular el arqueo.',
        'Revisá el cierre desde la app (Facturacion > Cierre de caja o POS).',
      ].join('\n');
    }
    return [
      `Cierre de caja · ${periodLabel} (${fechaYmd}) · ${sucursal.nombre}`,
      'No hay turno de caja abierto ni cierre Z registrado para hoy.',
      'Abrí caja con el fondo inicial o registrá el cierre desde SmartStock.',
    ].join('\n');
  }

  const rangoHasta = new Date().toISOString();
  const snapshot = await calcularSnapshot(db, {
    fechaOperativa: String(apertura.fecha_operativa),
    cajaIdNormalizada: cajaId,
    sucursalId: sucursal.id,
    rangoDesdeIso: apertura.opened_at,
    rangoHastaIso: rangoHasta,
    fondoApertura: apertura.fondo_efectivo,
    modoPeriodo: 'sesion_apertura',
    sesionAperturaId: apertura.id,
  });

  return formatSnapshotLive(snapshot, {
    periodLabel,
    fechaYmd,
    sucursalNombre: sucursal.nombre,
    cajaId,
  });
}
