export function extraerPuntoDeVentaDesdeXml(xml: string | null | undefined): number | null {
  if (!xml) return null;

  const match = xml.match(/<(?:ar:)?PtoVta>(\d+)<\/(?:ar:)?PtoVta>/);
  if (!match) return null;

  const puntoDeVenta = Number.parseInt(match[1], 10);
  return Number.isFinite(puntoDeVenta) ? puntoDeVenta : null;
}
