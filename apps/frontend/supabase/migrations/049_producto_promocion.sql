-- v8.0 — Relación N:N producto ↔ promoción (V80-PROMO-002).

CREATE TABLE public.producto_promocion (
  promocion_id  UUID NOT NULL REFERENCES public.promocion (id) ON DELETE CASCADE,
  producto_id   UUID NOT NULL REFERENCES public.producto (id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now (),
  PRIMARY KEY (promocion_id, producto_id)
);

CREATE INDEX idx_producto_promocion_producto ON public.producto_promocion (producto_id);

CREATE INDEX idx_producto_promocion_tenant ON public.producto_promocion (tenant_id);

ALTER TABLE public.producto_promocion ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_producto_promocion
  ON public.producto_promocion FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_insert_producto_promocion
  ON public.producto_promocion FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_update_producto_promocion
  ON public.producto_promocion FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_delete_producto_promocion
  ON public.producto_promocion FOR DELETE
  USING (tenant_id = public.current_tenant_id ());
