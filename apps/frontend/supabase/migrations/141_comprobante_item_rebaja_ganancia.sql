-- Rebaja en puntos de ganancia aplicada en POS por línea (post tramo, pre-promo).
alter table public.comprobante_item
  add column if not exists rebaja_ganancia_pct numeric not null default 0;

comment on column public.comprobante_item.rebaja_ganancia_pct is
  'Puntos % restados a la ganancia efectiva (tramo/base) en la línea; 0 = sin rebaja.';
  