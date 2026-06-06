import { PromocionTipo } from '../enums/promocion-tipo.enum';

export type RangoVolumen = {
  cantidad_desde: number;
  cantidad_hasta: number | null;
  porcentaje: number;
};

export type PromocionMotor = {
  id: string;
  nombre: string;
  tipo: PromocionTipo;
  cantidad_lleva: number | null;
  cantidad_paga: number | null;
  unidad_descuento: number | null;
  porcentaje: number | null;
  cantidad_minima: number | null;
  rangos_volumen: RangoVolumen[] | null;
  precio_combo: number | null;
  combo_items: {
    producto_id: string;
    producto_variante_id?: string | null;
    cantidad: number;
  }[] | null;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  dias_semana: number[] | null;
  activa: boolean;
};

export type ProductoPromocionTarget = {
  producto_id: string;
  producto_variante_id?: string | null;
};

export type PromocionPayload = {
  nombre: string;
  tipo: PromocionTipo;
  cantidad_lleva: number | null;
  cantidad_paga: number | null;
  unidad_descuento: number | null;
  porcentaje: number | null;
  cantidad_minima: number | null;
  rangos_volumen: RangoVolumen[] | null;
  precio_combo: number | null;
  combo_items: {
    producto_id: string;
    producto_variante_id?: string | null;
    cantidad: number;
  }[] | null;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  dias_semana: number[] | null;
  sucursal_ids: string[];
  producto_ids: string[];
  producto_targets: ProductoPromocionTarget[];
  reemplazar: boolean;
};

export type ConflictoPromoProducto = {
  producto_id: string;
  producto_variante_id?: string | null;
  sucursal_ids?: string[];
  promocion_existente: { id: string; nombre: string };
};
