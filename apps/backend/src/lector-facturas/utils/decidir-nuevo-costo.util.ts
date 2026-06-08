export function decidirNuevoCosto(
  precioCostoSoloSube: boolean,
  costoActual: number | null | undefined,
  nuevoCosto: number | null | undefined,
): number | null {
  const actual = costoActual == null ? null : Number(costoActual);
  const nuevo = nuevoCosto == null ? null : Number(nuevoCosto);

  if (!precioCostoSoloSube) {
    return nuevo == null || !Number.isFinite(nuevo) ? actual : nuevo;
  }

  if (nuevo == null || !Number.isFinite(nuevo) || nuevo <= 0) return actual;
  if (actual == null || !Number.isFinite(actual)) return nuevo;
  return nuevo > actual ? nuevo : actual;
}

export function esCodigoAutoGeneradoDesdeFactura(codigo: string): boolean {
  const c = codigo.trim();
  return /^LFA-/i.test(c) || /^CMP-/i.test(c);
}
