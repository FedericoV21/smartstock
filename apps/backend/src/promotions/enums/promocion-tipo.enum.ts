export enum PromocionTipo {
  porcentaje_off = 'porcentaje_off',
  n_x_m = 'n_x_m',
  porcentaje_unidad_n = 'porcentaje_unidad_n',
  descuento_volumen = 'descuento_volumen',
  combo_precio_fijo = 'combo_precio_fijo',
}

export const PROMOCION_TIPOS: PromocionTipo[] = [
  PromocionTipo.porcentaje_off,
  PromocionTipo.n_x_m,
  PromocionTipo.porcentaje_unidad_n,
  PromocionTipo.descuento_volumen,
  PromocionTipo.combo_precio_fijo,
];
