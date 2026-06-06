export function lineaEtiquetaCajaFisica(nombre: string, numeroPuesto: number | null | undefined): string {
  const nombreCaja = String(nombre ?? '').trim() || 'Caja';
  const n = Number(numeroPuesto);
  if (Number.isFinite(n) && n > 0) {
    return `Caja ${String(n).padStart(2, '0')} ÔÇö ${nombreCaja}`;
  }
  return nombreCaja;
}
