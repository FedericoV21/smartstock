import {
  formatearNumeroComprobante,
  formatearTipoComprobante,
} from '@/lib/facturacion/formato';

export type CobranzaFacturaWhatsAppRow = {
  id: string;
  saldo_pendiente: number;
  comprobante: {
    id: string;
    tipo: string;
    numero: number | null;
    numero_caja: number | null;
    fecha: string;
    created_at: string;
  };
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeRef(ref: string): string {
  return ref
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isUltimaRef(ref: string): boolean {
  const n = normalizeRef(ref);
  return n === 'ultima' || n === 'ultimo' || n === 'ultima factura' || n === 'ultimo ticket';
}

function parseNumeroFromRef(ref: string): { puntoVenta: number | null; numero: number | null; raw: string } {
  const clean = ref.trim();
  const dashed = clean.match(/^(\d{1,4})\s*-\s*(\d{1,8})$/);
  if (dashed) {
    return {
      puntoVenta: Number(dashed[1]),
      numero: Number(dashed[2]),
      raw: clean,
    };
  }
  const onlyNum = clean.match(/^(\d{1,8})$/);
  if (onlyNum) {
    return { puntoVenta: null, numero: Number(onlyNum[1]), raw: clean };
  }
  return { puntoVenta: null, numero: null, raw: clean };
}

function comprobanteMatchesRef(
  row: CobranzaFacturaWhatsAppRow,
  ref: string,
  tenantPuntoVenta: number,
): boolean {
  if (isUltimaRef(ref)) return false;
  const parsed = parseNumeroFromRef(ref);
  const comp = row.comprobante;
  if (parsed.numero == null) return false;

  if (comp.tipo === 'ticket' && comp.numero_caja != null) {
    return Number(comp.numero_caja) === parsed.numero;
  }

  const numero = comp.numero != null ? Number(comp.numero) : null;
  if (numero == null || Number.isNaN(numero)) return false;
  if (numero !== parsed.numero) return false;

  if (parsed.puntoVenta != null) {
    return parsed.puntoVenta === tenantPuntoVenta;
  }
  return true;
}

export function etiquetaComprobanteCobranza(
  row: CobranzaFacturaWhatsAppRow,
  puntoDeVenta: number,
): string {
  const comp = row.comprobante;
  const tipoLabel = formatearTipoComprobante(comp.tipo);
  if (comp.tipo === 'ticket' && comp.numero_caja != null) {
    return `${tipoLabel} caja #${comp.numero_caja}`;
  }
  return `${tipoLabel} ${formatearNumeroComprobante(puntoDeVenta, comp.numero)}`;
}

export async function resolveCobranzaFacturaWhatsApp(params: {
  db: any;
  tenantId: string;
  clienteId: string;
  comprobanteRef: string;
}): Promise<
  | { ok: true; row: CobranzaFacturaWhatsAppRow; label: string; puntoDeVenta: number }
  | { ok: false; error: string }
> {
  const { db, tenantId, clienteId } = params;
  const ref = params.comprobanteRef.trim();
  if (!ref) {
    return { ok: false, error: 'Indicá el número de factura/ticket o "ultima factura".' };
  }

  const { data: tenant, error: tenantErr } = await db
    .from('tenant')
    .select('punto_de_venta')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantErr) return { ok: false, error: tenantErr.message };
  const puntoDeVenta = Number(tenant?.punto_de_venta ?? 1);

  const { data, error } = await db
    .from('cobranza_factura')
    .select(
      'id, saldo_pendiente, comprobante:comprobante_id(id, tipo, numero, numero_caja, fecha, created_at, tenant_id)',
    )
    .eq('cliente_id', clienteId);
  if (error) return { ok: false, error: error.message };

  const rows = ((data ?? []) as Array<{
    id: string;
    saldo_pendiente: number | string;
    comprobante: CobranzaFacturaWhatsAppRow['comprobante'] | CobranzaFacturaWhatsAppRow['comprobante'][];
  }>)
    .map((raw) => {
      const comp = Array.isArray(raw.comprobante) ? raw.comprobante[0] : raw.comprobante;
      if (!comp || String((comp as { tenant_id?: string }).tenant_id ?? tenantId) !== tenantId) {
        return null;
      }
      const saldo = round2(Number(raw.saldo_pendiente ?? 0));
      if (saldo <= 0.005) return null;
      return {
        id: raw.id,
        saldo_pendiente: saldo,
        comprobante: comp,
      } satisfies CobranzaFacturaWhatsAppRow;
    })
    .filter((row): row is CobranzaFacturaWhatsAppRow => Boolean(row));

  if (rows.length === 0) {
    return {
      ok: false,
      error: 'El cliente no tiene facturas o tickets con saldo pendiente de cobro.',
    };
  }

  if (isUltimaRef(ref)) {
    const sorted = [...rows].sort((a, b) => {
      if (a.comprobante.fecha !== b.comprobante.fecha) {
        return b.comprobante.fecha.localeCompare(a.comprobante.fecha);
      }
      return b.comprobante.created_at.localeCompare(a.comprobante.created_at);
    });
    const pick = sorted[0];
    return {
      ok: true,
      row: pick,
      label: etiquetaComprobanteCobranza(pick, puntoDeVenta),
      puntoDeVenta,
    };
  }

  const matches = rows.filter((row) => comprobanteMatchesRef(row, ref, puntoDeVenta));
  if (matches.length === 0) {
    return {
      ok: false,
      error: `No encontré una factura/ticket con referencia "${ref}" con saldo pendiente para ese cliente.`,
    };
  }
  if (matches.length > 1) {
    const options = matches
      .slice(0, 5)
      .map((row) => `- ${etiquetaComprobanteCobranza(row, puntoDeVenta)} (saldo ${row.saldo_pendiente})`)
      .join('\n');
    return {
      ok: false,
      error: `Hay varios comprobantes que coinciden:\n${options}\nDecime el número completo (ej: 0001-00000042).`,
    };
  }

  const pick = matches[0];
  return {
    ok: true,
    row: pick,
    label: etiquetaComprobanteCobranza(pick, puntoDeVenta),
    puntoDeVenta,
  };
}
