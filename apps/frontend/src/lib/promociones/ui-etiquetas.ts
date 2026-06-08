import type { PromocionMotor } from '@/types/promociones';

/** Texto corto para badge en POS / listados (no reemplaza el nombre de la promo). */
export function etiquetaPromoCorta(p: PromocionMotor): string {
  switch (p.tipo) {
    case 'porcentaje_off':
      return `-${Number(p.porcentaje ?? 0)}%`;
    case 'n_x_m':
      return `${p.cantidad_lleva ?? '?'}×${p.cantidad_paga ?? '?'}`;
    case 'porcentaje_unidad_n':
      return `${p.unidad_descuento ?? '?'}º ${Number(p.porcentaje ?? 0)}%`;
    case 'descuento_volumen':
      if (p.rangos_volumen != null && p.rangos_volumen.length > 0) {
        return `Vol. ${p.rangos_volumen.length} tramos`;
      }
      return `≥${p.cantidad_minima ?? '?'}u ${Number(p.porcentaje ?? 0)}%`;
    case 'combo_precio_fijo':
      return `$${Number(p.precio_combo ?? 0)}`;
    default:
      return 'Promo';
  }
}
