-- V??-PED-WF-001: workflow (etiquetas/estados) configurable para pedidos por tenant.
-- Mantiene `pedido.estado` como fase del sistema (stock/facturación) y agrega un estado visible personalizable.

-- ------------------------------------------------------------
-- 1) Catálogo de estados (workflow) por tenant
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pedido_estado_workflow (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,

  slug        TEXT NOT NULL,
  nombre      TEXT NOT NULL,
  color       TEXT,
  -- `fase` define cuándo se ejecutan efectos del sistema (stock, facturación).
  fase        public.estado_pedido NOT NULL,
  orden       INTEGER NOT NULL DEFAULT 0,
  activo      BOOLEAN NOT NULL DEFAULT true,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_pedido_estado_workflow_slug_not_blank CHECK (btrim(slug) <> ''),
  CONSTRAINT chk_pedido_estado_workflow_nombre_not_blank CHECK (btrim(nombre) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pedido_estado_workflow_tenant_slug_unique
  ON public.pedido_estado_workflow (tenant_id, lower(slug));

CREATE INDEX IF NOT EXISTS idx_pedido_estado_workflow_tenant_orden
  ON public.pedido_estado_workflow (tenant_id, orden, created_at);

CREATE INDEX IF NOT EXISTS idx_pedido_estado_workflow_tenant_fase
  ON public.pedido_estado_workflow (tenant_id, fase);

DROP TRIGGER IF EXISTS set_pedido_estado_workflow_updated_at ON public.pedido_estado_workflow;
CREATE TRIGGER set_pedido_estado_workflow_updated_at
  BEFORE UPDATE ON public.pedido_estado_workflow
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

COMMENT ON TABLE public.pedido_estado_workflow IS
  'Catálogo de estados/etiquetas de pedidos configurable por tenant. Cada estado mapea a una fase (`estado_pedido`).';

-- ------------------------------------------------------------
-- 2) Transiciones permitidas por tenant
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pedido_estado_workflow_transicion (
  tenant_id   UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  desde_id    UUID NOT NULL REFERENCES public.pedido_estado_workflow (id) ON DELETE CASCADE,
  hacia_id    UUID NOT NULL REFERENCES public.pedido_estado_workflow (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, desde_id, hacia_id),
  CONSTRAINT chk_pedido_estado_workflow_transicion_not_self CHECK (desde_id <> hacia_id)
);

CREATE INDEX IF NOT EXISTS idx_pedido_estado_workflow_transicion_tenant_desde
  ON public.pedido_estado_workflow_transicion (tenant_id, desde_id);

CREATE INDEX IF NOT EXISTS idx_pedido_estado_workflow_transicion_tenant_hacia
  ON public.pedido_estado_workflow_transicion (tenant_id, hacia_id);

COMMENT ON TABLE public.pedido_estado_workflow_transicion IS
  'Aristas de transiciones permitidas entre estados de workflow (por tenant).';

-- ------------------------------------------------------------
-- 3) Referencia del pedido al estado de workflow
-- ------------------------------------------------------------
ALTER TABLE public.pedido
  ADD COLUMN IF NOT EXISTS workflow_estado_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedido_workflow_estado_id_fkey') THEN
    ALTER TABLE public.pedido
      ADD CONSTRAINT pedido_workflow_estado_id_fkey
      FOREIGN KEY (workflow_estado_id) REFERENCES public.pedido_estado_workflow (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pedido_tenant_sucursal_workflow_estado
  ON public.pedido (tenant_id, sucursal_id, workflow_estado_id);

-- ------------------------------------------------------------
-- 4) RLS (tenant scope) — patrón del proyecto: public.current_tenant_id()
-- ------------------------------------------------------------
ALTER TABLE public.pedido_estado_workflow ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_pedido_estado_workflow ON public.pedido_estado_workflow;
CREATE POLICY tenant_select_pedido_estado_workflow
  ON public.pedido_estado_workflow FOR SELECT
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_pedido_estado_workflow ON public.pedido_estado_workflow;
CREATE POLICY tenant_insert_pedido_estado_workflow
  ON public.pedido_estado_workflow FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_update_pedido_estado_workflow ON public.pedido_estado_workflow;
CREATE POLICY tenant_update_pedido_estado_workflow
  ON public.pedido_estado_workflow FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_pedido_estado_workflow ON public.pedido_estado_workflow;
CREATE POLICY tenant_delete_pedido_estado_workflow
  ON public.pedido_estado_workflow FOR DELETE
  USING (tenant_id = public.current_tenant_id());

ALTER TABLE public.pedido_estado_workflow_transicion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select_pedido_estado_workflow_transicion ON public.pedido_estado_workflow_transicion;
CREATE POLICY tenant_select_pedido_estado_workflow_transicion
  ON public.pedido_estado_workflow_transicion FOR SELECT
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_pedido_estado_workflow_transicion ON public.pedido_estado_workflow_transicion;
CREATE POLICY tenant_insert_pedido_estado_workflow_transicion
  ON public.pedido_estado_workflow_transicion FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_update_pedido_estado_workflow_transicion ON public.pedido_estado_workflow_transicion;
CREATE POLICY tenant_update_pedido_estado_workflow_transicion
  ON public.pedido_estado_workflow_transicion FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS tenant_delete_pedido_estado_workflow_transicion ON public.pedido_estado_workflow_transicion;
CREATE POLICY tenant_delete_pedido_estado_workflow_transicion
  ON public.pedido_estado_workflow_transicion FOR DELETE
  USING (tenant_id = public.current_tenant_id());

-- ------------------------------------------------------------
-- 5) Seed defaults por tenant (idempotente)
-- Slugs base alineados a `estado_pedido` para backfill y compatibilidad
-- ------------------------------------------------------------
INSERT INTO public.pedido_estado_workflow (tenant_id, slug, nombre, color, fase, orden, activo)
SELECT t.id, x.slug, x.nombre, x.color, x.fase::public.estado_pedido, x.orden, true
FROM public.tenant t
CROSS JOIN (
  VALUES
    ('borrador',   'Borrador',   NULL, 'borrador',   10),
    ('confirmado', 'Confirmado', NULL, 'confirmado', 20),
    ('entregado',  'Enviado',    NULL, 'entregado',  30),
    ('cancelado',  'Cancelado',  NULL, 'cancelado',  40)
) AS x(slug, nombre, color, fase, orden)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.pedido_estado_workflow w
  WHERE w.tenant_id = t.id
    AND lower(w.slug) = lower(x.slug)
);

-- Transiciones base: borrador -> confirmado/cancelado; confirmado -> entregado/cancelado
INSERT INTO public.pedido_estado_workflow_transicion (tenant_id, desde_id, hacia_id)
SELECT
  w_from.tenant_id,
  w_from.id,
  w_to.id
FROM public.pedido_estado_workflow w_from
JOIN public.pedido_estado_workflow w_to
  ON w_to.tenant_id = w_from.tenant_id
WHERE lower(w_from.slug) = 'borrador'
  AND lower(w_to.slug) IN ('confirmado', 'cancelado')
  AND NOT EXISTS (
    SELECT 1
    FROM public.pedido_estado_workflow_transicion tr
    WHERE tr.tenant_id = w_from.tenant_id
      AND tr.desde_id = w_from.id
      AND tr.hacia_id = w_to.id
  );

INSERT INTO public.pedido_estado_workflow_transicion (tenant_id, desde_id, hacia_id)
SELECT
  w_from.tenant_id,
  w_from.id,
  w_to.id
FROM public.pedido_estado_workflow w_from
JOIN public.pedido_estado_workflow w_to
  ON w_to.tenant_id = w_from.tenant_id
WHERE lower(w_from.slug) = 'confirmado'
  AND lower(w_to.slug) IN ('entregado', 'cancelado')
  AND NOT EXISTS (
    SELECT 1
    FROM public.pedido_estado_workflow_transicion tr
    WHERE tr.tenant_id = w_from.tenant_id
      AND tr.desde_id = w_from.id
      AND tr.hacia_id = w_to.id
  );

-- ------------------------------------------------------------
-- 6) Backfill pedidos existentes: workflow_estado_id = estado default
-- ------------------------------------------------------------
UPDATE public.pedido p
SET workflow_estado_id = w.id
FROM public.pedido_estado_workflow w
WHERE p.workflow_estado_id IS NULL
  AND w.tenant_id = p.tenant_id
  AND lower(w.slug) = lower(p.estado::text);

