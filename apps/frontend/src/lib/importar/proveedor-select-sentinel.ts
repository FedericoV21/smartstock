/** Valor del `<select>` cuando el usuario confirma explícitamente importar sin proveedor (API: `null`). */
export const IMPORTAR_SELECT_SIN_PROVEEDOR = '__sin_proveedor__';

/**
 * - `undefined`: aún no eligió (bloquear continuar).
 * - `null`: eligió "Sin proveedor".
 * - `string`: id de proveedor.
 */
export function proveedorIdParaImportar(value: string): string | null | undefined {
  if (value === '') return undefined;
  if (value === IMPORTAR_SELECT_SIN_PROVEEDOR) return null;
  return value;
}

/** True si hay un proveedor real (no placeholder ni "sin proveedor"). */
export function esProveedorRealEnSelect(value: string): boolean {
  return value !== '' && value !== IMPORTAR_SELECT_SIN_PROVEEDOR;
}
