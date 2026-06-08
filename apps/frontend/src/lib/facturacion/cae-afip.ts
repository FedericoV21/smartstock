import { caeAfipFormatoValido } from '@/lib/facturacion/arca/numeracion-pre-cae';
import { tipoComprobanteRequiereCaeAfip } from '@/lib/mp-point/tipo-requiere-cae';

export { caeAfipFormatoValido } from '@/lib/facturacion/arca/numeracion-pre-cae';

/**
 * Factura/NC “sin CAE válido” para UI y negocio: el tipo es fiscal pero el CAE no cumple formato AFIP.
 */
export function fiscalSinCaeValido(tipo: string | null | undefined, cae: string | null | undefined): boolean {
  return tipoComprobanteRequiereCaeAfip(tipo) && !caeAfipFormatoValido(cae);
}

const ESTADO_ANULABLE = new Set([
  'pendiente_arca',
  'error_arca',
  'emitido',
]);

/** Estados con flujo propio; no usar anulación interna aquí. */
export const ESTADO_EXCLUIDO_ANULACION_INTERNA = new Set([
  'borrador',
  'pendiente_qr',
  'pendiente_posnet',
  'anulado',
  'importado',
]);

export type PuedeAnularInternoResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Reglas: sin anulación si hay CAE AFIP válido en tipo fiscal; compras (`tipo_operacion = compra`) no incluidas en v1.
 */
export function puedeAnularComprobanteInterno(input: {
  estado: string;
  tipo: string;
  cae: string | null | undefined;
  tipoOperacion?: string | null;
}): PuedeAnularInternoResult {
  if (input.tipoOperacion === 'compra') {
    return { ok: false, status: 400, error: 'La anulación interna no aplica a comprobantes de compra.' };
  }
  if (ESTADO_EXCLUIDO_ANULACION_INTERNA.has(input.estado)) {
    return { ok: false, status: 400, error: 'Este estado no admite anulación interna con reverso de stock.' };
  }
  if (!ESTADO_ANULABLE.has(input.estado)) {
    return { ok: false, status: 400, error: 'Solo se puede anular comprobantes pendientes de ARCA, en error o emitidos sin CAE AFIP válido.' };
  }
  if (input.estado === 'emitido' && tipoComprobanteRequiereCaeAfip(input.tipo) && caeAfipFormatoValido(input.cae)) {
    return {
      ok: false,
      status: 400,
      error: 'Este comprobante tiene CAE AFIP válido. Usá una nota de crédito para revocarlo fiscalmente.',
    };
  }
  return { ok: true };
}
