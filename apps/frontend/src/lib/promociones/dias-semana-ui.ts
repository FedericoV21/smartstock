/** 1 = lunes … 7 = domingo (misma convención que `promocion.dias_semana` en BD). */

const DIAS_LARGO = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;
const DIAS_CORTO = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

function diasNormalizados(dias: number[] | null | undefined): number[] {
  if (!dias || dias.length === 0) return [];
  return [...new Set(dias.filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b);
}

/** Texto claro para ficha / detalle (nombres completos). */
export function textoDiasHabilesPromocion(dias: number[] | null | undefined): string {
  const sorted = diasNormalizados(dias);
  if (sorted.length === 0 || sorted.length === 7) {
    return 'Todos los días de la semana';
  }
  const set = new Set(sorted);
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) {
    return 'Lunes a viernes';
  }
  if (set.size === 2 && set.has(6) && set.has(7)) {
    return 'Sábados y domingos';
  }
  return sorted.map((n) => DIAS_LARGO[n]).join(', ');
}

/** Versión corta para listados secundarios (ej. ficha de producto). */
export function textoDiasHabilesPromocionCorto(dias: number[] | null | undefined): string {
  const sorted = diasNormalizados(dias);
  if (sorted.length === 0 || sorted.length === 7) {
    return 'Todos los días';
  }
  const set = new Set(sorted);
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) {
    return 'Lun–vie';
  }
  if (set.size === 2 && set.has(6) && set.has(7)) {
    return 'Sáb y dom';
  }
  return sorted.map((n) => DIAS_CORTO[n]).join(', ');
}

export function ordenDiasSemanaPromocion(dias: number[] | null | undefined): number[] {
  return diasNormalizados(dias);
}

export function etiquetaDiaPromocion(n: number): string {
  if (n >= 1 && n <= 7) return DIAS_LARGO[n];
  return String(n);
}
