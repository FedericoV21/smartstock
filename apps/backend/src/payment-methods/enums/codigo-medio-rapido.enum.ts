export enum CodigoMedioRapido {
  efectivo = 'efectivo',
  debito = 'debito',
  credito = 'credito',
  transferencia = 'transferencia',
  mixto = 'mixto',
}

export const CODIGOS_MEDIO_RAPIDO = Object.values(CodigoMedioRapido);

export const DEFAULT_RAPIDOS: Record<CodigoMedioRapido, number> = {
  [CodigoMedioRapido.efectivo]: 0,
  [CodigoMedioRapido.debito]: 0,
  [CodigoMedioRapido.credito]: 0,
  [CodigoMedioRapido.transferencia]: 0,
  [CodigoMedioRapido.mixto]: 0,
};
