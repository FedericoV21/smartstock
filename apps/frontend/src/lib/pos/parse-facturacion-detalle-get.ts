import { caeAfipFormatoValido } from '@/lib/facturacion/arca/numeracion-pre-cae';
import { tipoComprobanteRequiereCaeAfip } from '@/lib/mp-point/tipo-requiere-cae';

/**
 * GET /api/facturacion/[id] devuelve el comprobante en la raíz del JSON;
 * algunos clientes legacy esperan `{ comprobante: ... }`.
 */
export function comprobanteDesdeFacturacionDetalleGet(
  j: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!j || typeof j !== 'object') return null;
  const nested = j.comprobante;
  if (typeof nested === 'object' && nested !== null) {
    return nested as Record<string, unknown>;
  }
  if (typeof j.id === 'string') {
    return j;
  }
  return null;
}

export function numeroVisibleComprobante(c: Record<string, unknown>): number | null {
  const tipo = String(c.tipo ?? '');
  if (tipoComprobanteRequiereCaeAfip(tipo)) {
    const caeRaw = c.cae;
    const caeStr = typeof caeRaw === 'string' ? caeRaw : caeRaw != null ? String(caeRaw) : '';
    if (!caeAfipFormatoValido(caeStr)) return null;
  }
  const n = c.numero;
  if (typeof n === 'number' && Number.isFinite(n)) return n;
  const nc = c.numero_caja;
  if (typeof nc === 'number' && Number.isFinite(nc)) return nc;
  if (typeof n === 'string' && n.trim() !== '' && Number.isFinite(Number(n))) return Number(n);
  if (typeof nc === 'string' && nc.trim() !== '' && Number.isFinite(Number(nc))) return Number(nc);
  return null;
}
