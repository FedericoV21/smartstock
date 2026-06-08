import type { Database } from '@/types/database';

export type PromocionTipo = Database['public']['Enums']['promocion_tipo'];

export type PromocionRow = Database['public']['Tables']['promocion']['Row'];

export type ProductoPromocionRow = Database['public']['Tables']['producto_promocion']['Row'];

/** Labels para UI (badges, listados). */
export const PROMOCION_TIPO_LABELS: Record<PromocionTipo, string> = {
  porcentaje_off: '% off',
  n_x_m: 'N×M',
  porcentaje_unidad_n: '% unidad N',
  descuento_volumen: 'Por volumen',
  combo_precio_fijo: 'Combo precio fijo',
};

/** Tramo de descuento por volumen (cantidad_hasta null = sin fin). */
export type RangoVolumen = {
  cantidad_desde: number;
  cantidad_hasta: number | null;
  porcentaje: number;
};

/** Subconjunto de promoción necesario para el motor (sin I/O). */
export interface PromocionMotor {
  id: string;
  nombre: string;
  tipo: PromocionTipo;
  cantidad_lleva: number | null;
  cantidad_paga: number | null;
  unidad_descuento: number | null;
  porcentaje: number | null;
  cantidad_minima: number | null;
  /** Si hay tramos, el motor usa esto en lugar de cantidad_minima + porcentaje. */
  rangos_volumen: RangoVolumen[] | null;
  precio_combo: number | null;
  combo_items: { producto_id: string; producto_variante_id?: string | null; cantidad: number }[] | null;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  dias_semana: number[] | null;
  activa: boolean;
}

export interface ItemInputPromo {
  producto_id: string;
  producto_variante_id?: string | null;
  cantidad: number;
  /** Precio unitario del carrito (puede estar editado manualmente). */
  precio_unitario: number;
  /** Si true, no aplican promos N×M ni porcentaje_unidad_n (cantidades no enteras). */
  es_pesable?: boolean;
}

export interface ItemConPromo extends ItemInputPromo {
  precio_unitario_original: number | null;
  precio_unitario_efectivo: number;
  promocion_id: string | null;
  promocion_descripcion: string | null;
  descuento_promo_monto: number | null;
}
