import { TipoComprobante } from '../../facturacion/enums/tipo-comprobante.enum';

const EXCLUIDOS_AGREGADO = new Set([
  TipoComprobante.presupuesto,
  TipoComprobante.remito,
  'devolucion_remito',
  'recibo',
]);

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export function esComprobanteVenta(tipo: string): boolean {
  return tipo.startsWith('factura_') || tipo === TipoComprobante.ticket;
}

export function esVenta(tipo: string): boolean {
  return tipo === TipoComprobante.ticket || tipo.startsWith('factura_');
}

export function esDocumentoIva(tipo: string): boolean {
  return (
    tipo === TipoComprobante.factura_a ||
    tipo === TipoComprobante.factura_b ||
    tipo === TipoComprobante.factura_c ||
    tipo === TipoComprobante.nota_credito_a ||
    tipo === TipoComprobante.nota_credito_b ||
    tipo === TipoComprobante.nota_credito_c
  );
}

export function esNotaCredito(tipo: string): boolean {
  return tipo.startsWith('nota_credito_');
}

export function excluidoDeAgregadoVentas(tipo: string): boolean {
  return EXCLUIDOS_AGREGADO.has(tipo as TipoComprobante) || EXCLUIDOS_AGREGADO.has(tipo);
}

export function incluirLineaVenta(tipo: string): boolean {
  if (excluidoDeAgregadoVentas(tipo)) return false;
  return esVenta(tipo) || esNotaCredito(tipo);
}

export function signoPorTipo(tipo: string): number {
  return esNotaCredito(tipo) ? -1 : 1;
}

export function esVentaOTipoAjuste(tipo: string): boolean {
  return esVenta(tipo) || esNotaCredito(tipo);
}

export function factorLineasVsTotalComprobante(totalComprobante: number, sumaSubtotalesLineas: number): number {
  const total = round2(totalComprobante);
  const suma = round2(sumaSubtotalesLineas);
  if (!Number.isFinite(total) || !Number.isFinite(suma) || suma <= 0) return 1;
  if (Math.abs(suma - total) < 0.005) return 1;
  return total / suma;
}
