-- Sucursales donde cada cliente puede operar (POS, facturación, listados).
-- Una fila cuenta_corriente por (tenant_id, cliente_id): el saldo sigue único por negocio.

CREATE TABLE IF NOT EXISTS public.cliente_sucursal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  cliente_id UUID NOT NULL REFERENCES public.cliente (id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cliente_sucursal_cliente_sucursal UNIQUE (cliente_id, sucursal_id)
);

CREATE INDEX IF NOT EXISTS idx_cliente_sucursal_lookup
  ON public.cliente_sucursal (tenant_id, sucursal_id);

CREATE INDEX IF NOT EXISTS idx_cliente_sucursal_cliente_tenant
  ON public.cliente_sucursal (tenant_id, cliente_id);

COMMENT ON TABLE public.cliente_sucursal IS
  'Membresía cliente–sucursal: donde el cliente está habilitado. cliente.sucursal_id replica una sucursal canónica (p. ej. alta) dentro del conjunto.';

INSERT INTO public.cliente_sucursal (tenant_id, cliente_id, sucursal_id)
SELECT c.tenant_id, c.id, c.sucursal_id
FROM public.cliente c
ON CONFLICT ON CONSTRAINT uq_cliente_sucursal_cliente_sucursal DO NOTHING;

CREATE OR REPLACE FUNCTION public.trg_cliente_ensure_membresia_sucursal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.cliente_sucursal (tenant_id, cliente_id, sucursal_id)
  VALUES (NEW.tenant_id, NEW.id, NEW.sucursal_id)
  ON CONFLICT ON CONSTRAINT uq_cliente_sucursal_cliente_sucursal DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_cliente_ensure_membresia_sucursal() IS
  'Crea membresía en cliente_sucursal al insertar cliente (alinea con cliente.sucursal_id).';

REVOKE ALL ON FUNCTION public.trg_cliente_ensure_membresia_sucursal() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_cliente_ensure_membresia_sucursal ON public.cliente;

CREATE TRIGGER trg_cliente_ensure_membresia_sucursal
  AFTER INSERT ON public.cliente
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_cliente_ensure_membresia_sucursal();
