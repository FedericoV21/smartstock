/**
 * Política de visibilidad dashboard / analizador por rol.
 * Sin dependencias de servidor: seguro para Client Components.
 */
const ROL_SIN_VISTA_GESTION = new Set<string>(['operador', 'cajero']);

/** Admin y visor ven métricas; operador y cajero no. */
export function canAccessDashboardMetricas(rol: string): boolean {
  return !ROL_SIN_VISTA_GESTION.has(rol);
}

/** Misma política que métricas: sin acceso al analizador ni rutas /analizador. */
export function canAccessAnalizador(rol: string): boolean {
  return !ROL_SIN_VISTA_GESTION.has(rol);
}

/** Operador de POS / cajero: sin vista de gestión (slug custom `cajero` o legacy `operador`). */
export function isRestrictedOperatorRol(rol: string): boolean {
  return ROL_SIN_VISTA_GESTION.has(rol);
}
