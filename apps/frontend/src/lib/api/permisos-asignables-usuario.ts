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

export const PERMISO_CONTACTOS_PROVEEDORES_VER = 'contactos.proveedores.ver';
export const PERMISO_CONTACTOS_CLIENTES_VER = 'contactos.clientes.ver';
export const PERMISO_STOCK_VER = 'stock.ver';
export const PERMISO_STOCK_AJUSTAR = 'stock.ajustar';
export const PERMISO_PROMOCIONES_VER = 'promociones.ver';
export const PERMISO_PROMOCIONES_EDITAR = 'promociones.editar';
export const PERMISO_DESPIECE_VER = 'despiece.ver';
export const PERMISO_DESPIECE_EDITAR = 'despiece.editar';
export const PERMISO_DESPIECE_APLICAR_PRECIOS = 'despiece.aplicar_precios';
export const PERMISO_TESORERIA_GESTIONAR = 'tesoreria.gestionar';
