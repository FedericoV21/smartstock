/** Claves de `permiso` que un administrador puede asignar por usuario (allowlist API/UI). */
export const PERMISOS_ASIGNABLES_USUARIO = [
  'contactos.proveedores.ver',
  'contactos.clientes.ver',
  'stock.ver',
  'stock.ajustar',
  'promociones.ver',
  'promociones.editar',
  'despiece.ver',
  'despiece.editar',
  'despiece.aplicar_precios',
] as const;

export type PermisoAsignableUsuario = (typeof PERMISOS_ASIGNABLES_USUARIO)[number];
