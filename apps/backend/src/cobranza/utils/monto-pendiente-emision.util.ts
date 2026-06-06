/** Monto que queda a cobrar en cuenta corriente al emitir (no el contado inmediato). */
export function montoPendienteCuentaCorrienteEmitir(params: {
  metodoPago: string | null | undefined;
  metodoPagoDetalle: Record<string, unknown> | null | undefined;
  totalComprobante: number;
}): number {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const total = round2(Number(params.totalComprobante));
  if (!Number.isFinite(total) || total <= 0) return 0;

  const mp = String(params.metodoPago ?? '')
    .trim()
    .toLowerCase();
  if (mp === 'cuenta_corriente') return total;

  if (mp === 'mixto' && params.metodoPagoDetalle && typeof params.metodoPagoDetalle === 'object') {
    const raw = params.metodoPagoDetalle.cuenta_corriente;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return round2(Math.min(n, total));
  }

  return 0;
}
