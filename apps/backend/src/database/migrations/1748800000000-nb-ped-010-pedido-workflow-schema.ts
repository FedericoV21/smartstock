import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-PED-010: estados de workflow configurables para pedidos por tenant.
 */
export class NbPed010PedidoWorkflowSchema1748800000000 implements MigrationInterface {
  name = 'NbPed010PedidoWorkflowSchema1748800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.pedido_estado_workflow (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  nombre      TEXT NOT NULL,
  color       TEXT,
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
  EXECUTE FUNCTION public.moddatetime(updated_at);

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

CREATE INDEX IF NOT EXISTS idx_pedido_tenant_workflow_estado
  ON public.pedido (tenant_id, workflow_estado_id);

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

INSERT INTO public.pedido_estado_workflow_transicion (tenant_id, desde_id, hacia_id)
SELECT w_from.tenant_id, w_from.id, w_to.id
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
SELECT w_from.tenant_id, w_from.id, w_to.id
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

UPDATE public.pedido p
SET workflow_estado_id = w.id
FROM public.pedido_estado_workflow w
WHERE p.workflow_estado_id IS NULL
  AND w.tenant_id = p.tenant_id
  AND lower(w.slug) = lower(p.estado::text);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.pedido DROP CONSTRAINT IF EXISTS pedido_workflow_estado_id_fkey;
ALTER TABLE public.pedido DROP COLUMN IF EXISTS workflow_estado_id;
DROP TABLE IF EXISTS public.pedido_estado_workflow_transicion CASCADE;
DROP TABLE IF EXISTS public.pedido_estado_workflow CASCADE;
`);
  }
}
