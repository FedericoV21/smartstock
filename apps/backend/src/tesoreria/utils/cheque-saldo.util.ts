import { CajaTesoreriaMovimientoTipo } from '../enums/caja-tesoreria-movimiento-tipo.enum';
import { CajaTesoreriaChequeEstado } from '../enums/caja-tesoreria-cheque-estado.enum';

export const ETIQUETA_MOVIMIENTO_TESORERIA: Record<CajaTesoreriaMovimientoTipo, string> = {
  [CajaTesoreriaMovimientoTipo.ingreso_efectivo]: 'Ingreso efectivo',
  [CajaTesoreriaMovimientoTipo.egreso_efectivo]: 'Egreso efectivo',
  [CajaTesoreriaMovimientoTipo.ingreso_cheque]: 'Ingreso cheque',
  [CajaTesoreriaMovimientoTipo.egreso_cheque]: 'Pago proveedor (cheque)',
  [CajaTesoreriaMovimientoTipo.pago_proveedor]: 'Pago a proveedor',
  [CajaTesoreriaMovimientoTipo.ajuste]: 'Ajuste',
  [CajaTesoreriaMovimientoTipo.transferencia_desde_caja]: 'Transferencia desde caja POS',
};

export const ETIQUETA_ESTADO_CHEQUE: Record<CajaTesoreriaChequeEstado, string> = {
  [CajaTesoreriaChequeEstado.en_cartera]: 'En cartera',
  [CajaTesoreriaChequeEstado.depositado]: 'Depositado',
  [CajaTesoreriaChequeEstado.entregado]: 'Agotado',
  [CajaTesoreriaChequeEstado.rechazado]: 'Rechazado',
};

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
