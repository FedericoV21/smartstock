import { fetchExtractoCuentaCorriente } from '@/lib/cuenta-corriente/fetch-extracto-data';
import type { ExtractoLineaDto } from '@/lib/cuenta-corriente/extracto';
import { resolveWhatsAppReportPeriod } from '@/lib/whatsapp/report-tools';
import { generateAndUploadWhatsAppReportPdf } from '@/lib/whatsapp/report-pdf';

const WHATSAPP_EXTRACTO_TOP_LINES = 8;
const WHATSAPP_EXTRACTO_PDF_MIN_LINES = 40;

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function sanitizeLike(text: string): string {
  return text.replace(/[%_,]/g, ' ').replace(/\s+/g, ' ').trim();
}

function uniqueBy<T>(rows: T[], keyFn: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function resolveCliente(
  db: any,
  tenantId: string,
  targetName: string,
): Promise<
  Array<{
    id: string;
    nombre: string;
    razon_social: string | null;
  }>
> {
  const like = sanitizeLike(targetName);
  const { data, error } = await db
    .from('cliente')
    .select('id, nombre, razon_social')
    .eq('tenant_id', tenantId)
    .or(`nombre.ilike.%${like}%,razon_social.ilike.%${like}%`)
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ id: string; nombre: string; razon_social: string | null }>;
}

function formatPeriodRange(period: { desde: string; hasta: string }): string {
  if (period.desde === period.hasta) return `(${period.desde})`;
  return `(${period.desde} a ${period.hasta})`;
}

function formatLineaMovimiento(linea: ExtractoLineaDto): string {
  const cargo = linea.debe > 0 ? `+${linea.debe_label}` : '';
  const pago = linea.haber > 0 ? `-${linea.haber_label}` : '';
  const mov = [cargo, pago].filter(Boolean).join(' ');
  return `${linea.fecha} · ${linea.descripcion}${mov ? ` · ${mov}` : ''} · saldo ${linea.saldo_label}`;
}

export async function runClienteExtractoCcTool(
  db: any,
  tenantId: string,
  targetName: string,
  message: string,
): Promise<{ reply: string; memoryOptions?: string[] }> {
  const clientes = await resolveCliente(db, tenantId, targetName);
  if (clientes.length === 0) {
    return {
      reply: `No encontre un cliente con "${targetName}". Decime el nombre exacto y busco el extracto de cuenta corriente.`,
    };
  }
  if (clientes.length > 1) {
    const uniqueClientes = uniqueBy(
      clientes,
      (c) => `${normalizeText(c.razon_social || '')}|${normalizeText(c.nombre || '')}`,
    );
    const options = uniqueClientes
      .map((c, i) => `${i + 1}) ${c.razon_social || c.nombre}`)
      .slice(0, 5)
      .join('\n');
    return {
      reply: [
        'Encontre varios clientes parecidos:',
        options,
        'Respondé con el numero (ej: 1) o con el nombre exacto y te paso el extracto de cuenta corriente.',
      ].join('\n'),
    };
  }

  const cliente = clientes[0];
  const etiqueta = cliente.razon_social || cliente.nombre;
  const period = resolveWhatsAppReportPeriod(message, true);
  const periodRange = formatPeriodRange(period);

  const payload = await fetchExtractoCuentaCorriente(db, {
    tenantId,
    clienteId: cliente.id,
    desde: period.desde,
    hasta: period.hasta,
    periodoLabel: period.label,
    sucursalId: null,
  });

  if ('error' in payload) {
    return { reply: payload.error };
  }

  const lines = [
    `Extracto cuenta corriente · ${payload.cliente_nombre} · ${period.label} ${periodRange}`,
    `Saldo inicial: ${payload.saldo_inicial_label}`,
  ];

  if (payload.lineas.length === 0) {
    lines.push('Sin movimientos de cuenta corriente en ese periodo.');
  } else {
    const top = payload.lineas.slice(-WHATSAPP_EXTRACTO_TOP_LINES);
    lines.push(...top.map(formatLineaMovimiento));
    if (payload.lineas.length > WHATSAPP_EXTRACTO_TOP_LINES) {
      lines.push(`(... ${payload.lineas.length - WHATSAPP_EXTRACTO_TOP_LINES} movimientos mas en el periodo)`);
    }
  }

  lines.push(
    `Totales periodo: cargos ${payload.total_debe.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })} · pagos ${payload.total_haber.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}`,
    `Saldo final (actual): ${payload.saldo_final_label}`,
  );

  if (payload.lineas.length > WHATSAPP_EXTRACTO_PDF_MIN_LINES) {
    const pdfUrl = await generateAndUploadWhatsAppReportPdf({
      db,
      tenantId,
      reportKey: 'extracto-cc-cliente',
      title: `Extracto CC · ${payload.cliente_nombre}`,
      subtitleLines: [
        `Periodo: ${period.label} ${periodRange}`,
        `Saldo inicial: ${payload.saldo_inicial_label}`,
        `Saldo final: ${payload.saldo_final_label}`,
      ],
      columns: ['Fecha', 'Descripcion', 'Debe', 'Haber', 'Saldo'],
      rows: payload.lineas.map((l) => [
        l.fecha,
        l.descripcion,
        l.debe > 0 ? l.debe_label : '—',
        l.haber > 0 ? l.haber_label : '—',
        l.saldo_label,
      ]),
    });
    if (pdfUrl) {
      lines.push(`PDF completo: ${pdfUrl}`);
    }
  }

  return {
    reply: lines.join('\n'),
    memoryOptions: [etiqueta],
  };
}
