-- Tipo explícito de documento del receptor (AFIP) para clientes con CUIT/DNI en cuenta corriente y facturación.

CREATE TYPE public.cliente_documento_fiscal AS ENUM ('cuit', 'dni');

ALTER TABLE public.cliente
  ADD COLUMN IF NOT EXISTS documento_fiscal_tipo public.cliente_documento_fiscal NULL;

COMMENT ON COLUMN public.cliente.documento_fiscal_tipo IS
  'Si está definido, AFIP usa este tipo de documento del receptor (80 CUIT / 96 DNI) aunque el número no coincida con la heurística por cantidad de dígitos. NULL = inferir por dígitos (comportamiento previo).';
