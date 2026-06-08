export const ESTADOS_COMPROBANTE_MOVIMIENTOS_DIA = ['emitido', 'pendiente_arca'] as const;

const TIPOS_LIQUIDABLES = new Set(['ticket', 'factura_b', 'factura_c']);

export type ValidarLiquidacionResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

export function validarComprobanteLiquidable(opts: {
  fechaHoy: string;
  comprobante: {
    fecha: string;
    metodoPago: string | null;
    estado: string;
    tipo: string;
    cae: string | null;
    sucursalId: string | null;
  };
  sucursalId: string;
}): ValidarLiquidacionResult {
  if (opts.comprobante.sucursalId !== opts.sucursalId) {
    return { ok: false, status: 403, error: 'El comprobante no pertenece a la sucursal indicada.' };
  }
  if (opts.comprobante.fecha !== opts.fechaHoy) {
    return { ok: false, status: 400, error: 'Solo se pueden liquidar comprobantes del día en curso.' };
  }
  if (opts.comprobante.metodoPago !== 'cuenta_corriente') {
    return { ok: false, status: 400, error: 'Solo aplica a ventas en cuenta corriente.' };
  }
  if (!(ESTADOS_COMPROBANTE_MOVIMIENTOS_DIA as readonly string[]).includes(opts.comprobante.estado)) {
    return { ok: false, status: 400, error: 'El comprobante no está en un estado editable.' };
  }
  if (!TIPOS_LIQUIDABLES.has(opts.comprobante.tipo)) {
    return {
      ok: false,
      status: 400,
      error: 'Solo tickets o facturas B/C sin CAE pueden liquidarse desde aquí.',
    };
  }
  if (opts.comprobante.cae?.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'No se pueden modificar importes de un comprobante con CAE emitido.',
    };
  }
  return { ok: true };
}

export function contarCargosHoyPorCliente(rows: { clienteId: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!r.clienteId) continue;
    out[r.clienteId] = (out[r.clienteId] ?? 0) + 1;
  }
  return out;
}
