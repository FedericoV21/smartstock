-- V50-ANAL-002: relación N:N producto ↔ proveedor (costos alternativos).
-- Requiere 017_lista_precios.sql (para public.current_tenant_id()) o equivalente en el proyecto.

CREATE TABLE public.producto_proveedor (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id       UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  proveedor_id      UUID NOT NULL REFERENCES public.proveedor (id) ON DELETE CASCADE,

  precio_costo      NUMERIC(18, 6) NOT NULL DEFAULT 0,
  codigo_proveedor  TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_producto_proveedor_tenant_producto_proveedor
    UNIQUE (tenant_id, producto_id, proveedor_id)
);

CREATE INDEX idx_producto_proveedor_tenant_producto
  ON public.producto_proveedor (tenant_id, producto_id);

CREATE INDEX idx_producto_proveedor_tenant_proveedor
  ON public.producto_proveedor (tenant_id, proveedor_id);

CREATE TRIGGER set_producto_proveedor_updated_at
  BEFORE UPDATE ON public.producto_proveedor
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE public.producto_proveedor ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_producto_proveedor
  ON public.producto_proveedor FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_producto_proveedor
  ON public.producto_proveedor FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_producto_proveedor
  ON public.producto_proveedor FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_delete_producto_proveedor
  ON public.producto_proveedor FOR DELETE
  USING (tenant_id = public.current_tenant_id());
