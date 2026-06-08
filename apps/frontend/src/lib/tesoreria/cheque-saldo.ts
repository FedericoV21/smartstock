type MovimientoCheque = {
  cheque_id: string | null;
  tipo: string;
  monto: number;
  es_ingreso: boolean;
};

export function calcularSaldoDisponibleCheque(
  montoNominal: number,
  chequeId: string,
  movimientos: MovimientoCheque[],
): number {
  const consumido = movimientos
    .filter((m) => m.cheque_id === chequeId && (m.tipo === 'egreso_cheque' || m.tipo === 'ajuste'))
    .reduce((acc, m) => acc + (m.es_ingreso ? -Number(m.monto) : Number(m.monto)), 0);

  return Math.max(Number(montoNominal) - consumido, 0);
}

export function calcularMontoUsadoCheque(montoNominal: number, saldoDisponible: number): number {
  return Math.max(Number(montoNominal) - saldoDisponible, 0);
}
