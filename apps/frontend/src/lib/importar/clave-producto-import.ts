import type { Database } from '@/types/database';

type UnidadMedida = Database['public']['Enums']['unidad_medida'];

/**
 * Clave estable para: mismo producto lógico en importación
 * (sucursal + proveedor vienen del contexto; aquí solo código + descripción).
 * @deprecated Para match server-side preferir {@link claveProductoMatchCodigoUnidad}.
 */
export function claveProductoImport(codigo: string, descripcion: string): string {
  return `${codigo.trim()}\0${descripcion.trim().toLowerCase()}`;
}

/** Match alineado a producto único (fase 5): mismo tenant + sucursal de import + código + unidad. */
export function claveProductoMatchCodigoUnidad(codigo: string, unidad: UnidadMedida): string {
  return `${codigo.trim().toLowerCase()}\0${unidad}`;
}
