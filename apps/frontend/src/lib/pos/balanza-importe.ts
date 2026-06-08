export function calcularCantidadDesdeImporteBalanza(
  importePesos: number | null | undefined,
  precioUnitario: number | null | undefined,
): number | null {
  const importe = Number(importePesos);
  const precio = Number(precioUnitario);
  if (!Number.isFinite(importe) || importe <= 0) return null;
  if (!Number.isFinite(precio) || precio <= 0) return null;
  return Math.round((importe / precio) * 1_000_000) / 1_000_000;
}
