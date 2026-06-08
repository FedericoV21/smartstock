/**
 * Claims m├¡nimos del access token JWT (HS256) validado con `JWT_SECRET` (o `SUPABASE_JWT_SECRET` legacy).
 * El emisor puede ser cualquier IdP/BFF alineado con el frontend. Se permiten claves extra.
 */
export const APP_ROLES = ['admin', 'operador', 'visor'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export interface AccessTokenPayload {
  sub: string;
  email?: string;
  /** Rol de plataforma del token (p. ej. `authenticated`) ÔÇö no es el rol de negocio de la app */
  role?: string;
  /** Preferido para rol de negocio cuando el hook lo agregue al JWT */
  app_role?: string;
  tenant_role?: string;
  rol?: string;
  /** Tenant activo del usuario (inyectado en el JWT por el hook/BFF de auth) */
  tenant_id?: string;
  /** Tenant casa del usuario (staff super-admin) */
  tenant_home_id?: string;
  es_super_admin?: boolean;
  /** Sucursal por defecto del usuario (cuando exista perfil `usuario` en Nest) */
  sucursal_default_id?: string;
  sucursalDefaultId?: string;
  [key: string]: unknown;
}
