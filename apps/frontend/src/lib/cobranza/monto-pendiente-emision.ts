/** Monto que queda a cobrar en cuenta corriente al emitir (no el contado inmediato). */
export function montoPendienteCuentaCorrienteEmitir(params: {
  metodo_pago: string | null | undefined;
  metodo_pago_detalle: Record<string, unknown> | null | undefined;
  totalComprobante: number;
}): number {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const total = round2(Number(params.totalComprobante));
  if (!Number.isFinite(total) || total <= 0) return 0;

  const mp = String(params.metodo_pago ?? '').trim().toLowerCase();
  if (mp === 'cuenta_corriente') return total;

  if (mp === 'mixto' && params.metodo_pago_detalle && typeof params.metodo_pago_detalle === 'object') {
    const raw = (params.metodo_pago_detalle as Record<string, unknown>).cuenta_corriente;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return round2(Math.min(n, total));
  }

  return 0;
}
