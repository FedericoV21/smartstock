-- Descuentos y recargos manuales por ítem y ajustes globales sobre el total de mercadería.

alter table public.comprobante_item
  add column if not exists descuento_manual_pct numeric not null default 0,
  add column if not exists recargo_manual_pct numeric not null default 0;

alter table public.comprobante
  add column if not exists descuento_global_pct numeric not null default 0,
  add column if not exists recargo_global_pct numeric not null default 0,
  add column if not exists descuento_global_monto numeric not null default 0,
  add column if not exists recargo_global_monto numeric not null default 0,
  add column if not exists imp_trib_comercial numeric not null default 0;

comment on column public.comprobante_item.descuento_manual_pct is 'Descuento manual sobre precio unitario (post-promo), 0–100.';
comment on column public.comprobante_item.recargo_manual_pct is 'Recargo manual sobre precio unitario (post-promo), 0–100.';
comment on column public.comprobante.descuento_global_pct is 'Descuento % sobre total de mercadería (post ítems), antes de financiación por medio de pago.';
comment on column public.comprobante.recargo_global_pct is 'Recargo % sobre total de mercadería (post ítems).';
comment on column public.comprobante.descuento_global_monto is 'Descuento fijo en $ sobre total de mercadería (post %).';
comment on column public.comprobante.recargo_global_monto is 'Recargo fijo en $ sobre total de mercadería (post %).';
comment on column public.comprobante.imp_trib_comercial is 'Importe informado como ImpTrib (tributo 99) por recargos comerciales globales.';

alter table public.comprobante_item drop constraint if exists comprobante_item_desc_rec_pct_check;
alter table public.comprobante_item
  add constraint comprobante_item_desc_rec_pct_check
  check (
    descuento_manual_pct >= 0
    and descuento_manual_pct <= 100
    and recargo_manual_pct >= 0
    and recargo_manual_pct <= 100
  );

alter table public.comprobante drop constraint if exists comprobante_global_desc_rec_check;
alter table public.comprobante
  add constraint comprobante_global_desc_rec_check
  check (
    descuento_global_pct >= 0
    and descuento_global_pct <= 100
    and recargo_global_pct >= 0
    and recargo_global_pct <= 100
    and descuento_global_monto >= 0
    and recargo_global_monto >= 0
    and imp_trib_comercial >= 0
  );
