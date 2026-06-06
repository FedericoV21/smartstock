export const MOTIVO_ANULACION_MIN_LEN = 5;
export const MOTIVO_ANULACION_MAX_LEN = 4000;
export const MOTIVO_MOVIMIENTO_USER_MAX = 3500;

const ESTADO_ANULABLE = new Set(['pendiente_arca', 'error_arca', 'emitido']);

export const ESTADO_EXCLUIDO_ANULACION_INTERNA = new Set([
  'borrador',
  'pendiente_qr',
  'pendiente_posnet',
  'anulado',
  'importado',
]);

export type ValidarMotivoResult =
  | { ok: true; motivo: string }
  | { ok: false; status: number; error: string };

export function validarMotivoAnulacion(motivo: string | undefined | null): ValidarMotivoResult {
  const m = typeof motivo === 'string' ? motivo.trim() : '';
  if (m.length < MOTIVO_ANULACION_MIN_LEN) {
    return {
      ok: false,
      status: 400,
      error: `El motivo de anulaci├│n debe tener al menos ${MOTIVO_ANULACION_MIN_LEN} caracteres.`,
    };
  }
  if (m.length > MOTIVO_ANULACION_MAX_LEN) {
    return {
      ok: false,
      status: 400,
      error: `El motivo de anulaci├│n no puede superar ${MOTIVO_ANULACION_MAX_LEN} caracteres.`,
    };
  }
  return { ok: true, motivo: m };
}

export function caeAfipFormatoValido(cae: string | null | undefined): boolean {
  return typeof cae === 'string' && /^\d{14}$/.test(cae.trim());
}

export function tipoComprobanteRequiereCaeAfip(tipo: string | null | undefined): boolean {
  const t = String(tipo ?? '');
  return (
    t === 'factura' ||
    t === 'nota_credito' ||
    t.startsWith('factura_') ||
    t.startsWith('nota_credito_')
  );
}

export type PuedeAnularInternoResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

export function puedeAnularComprobanteInterno(input: {
  estado: string;
  tipo: string;
  cae: string | null | undefined;
  tipoOperacion?: string | null;
}): PuedeAnularInternoResult {
  if (input.tipoOperacion === 'compra') {
    return {
      ok: false,
      status: 400,
      error: 'La anulaci├│n interna no aplica a comprobantes de compra.',
    };
  }
  if (ESTADO_EXCLUIDO_ANULACION_INTERNA.has(input.estado)) {
    return {
      ok: false,
      status: 400,
      error: 'Este estado no admite anulaci├│n interna con reverso de stock.',
    };
  }
  if (!ESTADO_ANULABLE.has(input.estado)) {
    return {
      ok: false,
      status: 400,
      error:
        'Solo se puede anular comprobantes pendientes de ARCA, en error o emitidos sin CAE AFIP v├ílido.',
    };
  }
  if (
    input.estado === 'emitido' &&
    tipoComprobanteRequiereCaeAfip(input.tipo) &&
    caeAfipFormatoValido(input.cae)
  ) {
    return {
      ok: false,
      status: 400,
      error:
        'Este comprobante tiene CAE AFIP v├ílido. Us├í una nota de cr├®dito para revocarlo fiscalmente.',
    };
  }
  return { ok: true };
}

export function formatearTipoComprobante(tipo: string): string {
  return tipo.replace(/_/g, ' ');
}
