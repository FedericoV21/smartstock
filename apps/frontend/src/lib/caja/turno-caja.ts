/**
 * Identificador de caja en tablas legacy TEXT (`caja_apertura`, `cierre_z`, `comprobante.caja_id`).
 * Debe coincidir con lo que use el POS al emitir (fase 3).
 */
export function cajaUuidComoCajaIdText(cajaId: string): string {
  return cajaId.trim();
}
