/** Máximo de caracteres para el nombre de producto (UI, importación, borradores). */
export const NOMBRE_PRODUCTO_MAX_LEN = 200;

export function nombreProductoExcedeMaximo(nombre: string): boolean {
  return nombre.trim().length > NOMBRE_PRODUCTO_MAX_LEN;
}

export function mensajeErrorNombreProductoMuyLargo(longitud: number): string {
  return `El nombre supera ${NOMBRE_PRODUCTO_MAX_LEN} caracteres (tiene ${longitud}). Acortalo en el archivo o en la celda antes de importar.`;
}
