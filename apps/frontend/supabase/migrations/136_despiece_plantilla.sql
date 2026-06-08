-- v14.0 Despiece de carnicerías: plantillas y cortes.

CREATE TABLE IF NOT EXISTS public.despiece_plantilla (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  producto_padre_id UUID NOT NULL REFERENCES public.producto(id) ON DELETE RESTRICT,
  peso_total_kg NUMERIC(10,3) NOT NULL CHECK (peso_total_kg > 0),
  rentabilidad_objetivo_pct NUMERIC(6,2),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_despiece_plantilla_padre
  ON public.despiece_plantilla(tenant_id, producto_padre_id, nombre);
CREATE INDEX IF NOT EXISTS idx_despiece_plantilla_tenant
  ON public.despiece_plantilla(tenant_id);

CREATE TABLE IF NOT EXISTS public.despiece_corte (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
  plantilla_id UUID NOT NULL REFERENCES public.despiece_plantilla(id) ON DELETE CASCADE,
  producto_hijo_id UUID NOT NULL REFERENCES public.producto(id) ON DELETE RESTRICT,
  kg_rendimiento NUMERIC(10,3) NOT NULL CHECK (kg_rendimiento >= 0),
  factor_ajuste_pct NUMERIC(12,10) NOT NULL DEFAULT 0,
  precio_anclado NUMERIC(12,2),
  peso_promedio_unidad_kg NUMERIC(10,3),
  orden INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_despiece_corte_peso_unidad
    CHECK (peso_promedio_unidad_kg IS NULL OR peso_promedio_unidad_kg > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_despiece_corte_unico
  ON public.despiece_corte(plantilla_id, producto_hijo_id);
CREATE INDEX IF NOT EXISTS idx_despiece_corte_tenant
  ON public.despiece_corte(tenant_id);
CREATE INDEX IF NOT EXISTS idx_despiece_corte_plantilla
  ON public.despiece_corte(plantilla_id, orden);

ALTER TABLE public.despiece_plantilla ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.despiece_corte ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_despiece_plantilla ON public.despiece_plantilla;
CREATE POLICY tenant_select_despiece_plantilla ON public.despiece_plantilla
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_despiece_plantilla ON public.despiece_plantilla;
CREATE POLICY tenant_insert_despiece_plantilla ON public.despiece_plantilla
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_update_despiece_plantilla ON public.despiece_plantilla;
CREATE POLICY tenant_update_despiece_plantilla ON public.despiece_plantilla
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_despiece_plantilla ON public.despiece_plantilla;
CREATE POLICY tenant_delete_despiece_plantilla ON public.despiece_plantilla
  FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_select_despiece_corte ON public.despiece_corte;
CREATE POLICY tenant_select_despiece_corte ON public.despiece_corte
  FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_despiece_corte ON public.despiece_corte;
CREATE POLICY tenant_insert_despiece_corte ON public.despiece_corte
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_update_despiece_corte ON public.despiece_corte;
CREATE POLICY tenant_update_despiece_corte ON public.despiece_corte
  FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_despiece_corte ON public.despiece_corte;
CREATE POLICY tenant_delete_despiece_corte ON public.despiece_corte
  FOR DELETE TO authenticated USING (tenant_id = public.current_tenant_id());

DROP TRIGGER IF EXISTS set_despiece_plantilla_updated_at ON public.despiece_plantilla;
CREATE TRIGGER set_despiece_plantilla_updated_at
  BEFORE UPDATE ON public.despiece_plantilla
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime(updated_at);

DROP TRIGGER IF EXISTS set_despiece_corte_updated_at ON public.despiece_corte;
CREATE TRIGGER set_despiece_corte_updated_at
  BEFORE UPDATE ON public.despiece_corte
  FOR EACH ROW EXECUTE FUNCTION public.moddatetime(updated_at);

GRANT ALL ON TABLE public.despiece_plantilla TO anon;
GRANT ALL ON TABLE public.despiece_plantilla TO authenticated;
GRANT ALL ON TABLE public.despiece_plantilla TO service_role;
GRANT ALL ON TABLE public.despiece_corte TO anon;
GRANT ALL ON TABLE public.despiece_corte TO authenticated;
GRANT ALL ON TABLE public.despiece_corte TO service_role;

NOTIFY pgrst, 'reload schema';
