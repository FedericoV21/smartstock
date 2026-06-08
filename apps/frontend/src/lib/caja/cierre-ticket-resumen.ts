import type { SnapshotCierreZ } from '@/lib/caja/cierre-z-calculo';

export type GastoCierreGuardado = {
  concepto: string;
  monto: number;
};

export type ArqueoEfectivoCierre = {
  fondo_apertura: number;
  efectivo_ventas_periodo: number;
  esperado_sistema: number;
  gastos_monto: number;
  gastos_detalle: string | null;
  esperado_ajustado: number;
  contado: number;
  diferencia: number;
  esperado: number;
};

export type CierreCajaTicketResumen = {
  cierre_id: string;
  fecha_operativa: string;
  caja_id: string;
  rango_desde: string;
  rango_hasta: string;
  created_at: string;
  snapshot: SnapshotCierreZ;
  arqueo_efectivo: ArqueoEfectivoCierre | null;
  gastos_items: GastoCierreGuardado[] | null;
};

export function crearTicketResumenCierreCaja(input: {
  cierreId: string;
  fechaOperativa: string;
  cajaIdNormalizada: string;
  rangoDesde: string;
  rangoHasta: string;
  createdAt: string;
  snapshot: SnapshotCierreZ;
  arqueo: ArqueoEfectivoCierre | null;
  gastosItems: GastoCierreGuardado[] | null;
}): CierreCajaTicketResumen {
  return {
    cierre_id: input.cierreId,
    fecha_operativa: input.fechaOperativa,
    caja_id: input.cajaIdNormalizada,
    rango_desde: input.rangoDesde,
    rango_hasta: input.rangoHasta,
    created_at: input.createdAt,
    snapshot: input.snapshot,
    arqueo_efectivo: input.arqueo,
    gastos_items: input.gastosItems,
  };
}
