-- Nuevas columnas en producto: rubro, subrubro, IVA por producto,
-- porcentaje de ganancia, ubicacion fisica y moneda.
-- IVA por defecto del tenant (sobreescribible por producto).

ALTER TABLE public.producto
  ADD COLUMN rubro TEXT,
  ADD COLUMN subrubro TEXT,
  ADD COLUMN iva_porcentaje NUMERIC(5,2),
  ADD COLUMN porcentaje_ganancia NUMERIC(5,2),
  ADD COLUMN ubicacion TEXT,
  ADD COLUMN moneda TEXT NOT NULL DEFAULT '$';

ALTER TABLE public.tenant
  ADD COLUMN iva_porcentaje_default NUMERIC(5,2) NOT NULL DEFAULT 21;
