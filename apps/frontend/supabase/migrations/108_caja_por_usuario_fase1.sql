-- Plan cajas usuario — Fase 1 (V120-CAJA-001 a V120-CAJA-003).
-- Entidad caja, turnos, FK fuerte en comprobante, backfill "Caja general" + tickets históricos.
-- Convive con caja_apertura / cierre_z actuales (caja_id TEXT); la app aún no usa caja_uuid.

-- ─── Tabla caja ─────────────────────────────────────────────────────────────
CREATE TABLE public.caja (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  numero INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  usuario_default_id UUID REFERENCES public.usuario (id) ON DELETE SET NULL,
  activa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uk_caja_numero_sucursal UNIQUE (sucursal_id, numero),
  CONSTRAINT chk_caja_numero_positivo CHECK (numero > 0)
);

CREATE INDEX idx_caja_tenant ON public.caja (tenant_id);

CREATE INDEX idx_caja_sucursal ON public.caja (sucursal_id);

CREATE INDEX idx_caja_usuario_default
  ON public.caja (usuario_default_id)
  WHERE
    usuario_default_id IS NOT NULL;

COMMENT ON TABLE public.caja IS
  'Punto de venta / caja lógica por sucursal (Plan cajas usuario). Numeración de tickets por caja en fases posteriores.';

CREATE TRIGGER set_caja_updated_at
  BEFORE UPDATE ON public.caja
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

ALTER TABLE public.caja ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_caja ON public.caja FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_insert_caja ON public.caja FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_update_caja ON public.caja FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_delete_caja ON public.caja FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

-- ─── caja_usuario (N:M) ─────────────────────────────────────────────────────
CREATE TABLE public.caja_usuario (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  caja_id UUID NOT NULL REFERENCES public.caja (id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uk_caja_usuario UNIQUE (caja_id, usuario_id)
);

CREATE INDEX idx_caja_usuario_tenant ON public.caja_usuario (tenant_id);

CREATE INDEX idx_caja_usuario_usuario ON public.caja_usuario (usuario_id);

ALTER TABLE public.caja_usuario ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_caja_usuario ON public.caja_usuario FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_insert_caja_usuario ON public.caja_usuario FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_update_caja_usuario ON public.caja_usuario FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_delete_caja_usuario ON public.caja_usuario FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

-- ─── caja_turno ─────────────────────────────────────────────────────────────
CREATE TABLE public.caja_turno (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
  tenant_id UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  caja_id UUID NOT NULL REFERENCES public.caja (id) ON DELETE RESTRICT,
  usuario_id UUID NOT NULL REFERENCES public.usuario (id) ON DELETE RESTRICT,
  estado TEXT NOT NULL CHECK (estado IN ('abierto', 'cerrado')),
  abierto_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_at TIMESTAMPTZ,
  monto_inicial NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (monto_inicial >= 0),
  cierre_z_id UUID REFERENCES public.cierre_z (id) ON DELETE SET NULL,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_caja_turno_tenant ON public.caja_turno (tenant_id);

CREATE INDEX idx_caja_turno_caja ON public.caja_turno (caja_id);

CREATE INDEX idx_caja_turno_usuario ON public.caja_turno (usuario_id);

CREATE INDEX idx_caja_turno_abierto_at ON public.caja_turno (abierto_at DESC);

CREATE UNIQUE INDEX uk_caja_turno_usuario_abierto ON public.caja_turno (usuario_id)
WHERE
  estado = 'abierto';

CREATE UNIQUE INDEX uk_caja_turno_caja_abierto ON public.caja_turno (caja_id)
WHERE
  estado = 'abierto';

COMMENT ON TABLE public.caja_turno IS
  'Turno de caja: apertura explícita hasta cierre Z (Plan cajas usuario).';

CREATE TRIGGER set_caja_turno_updated_at
  BEFORE UPDATE ON public.caja_turno
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime (updated_at);

ALTER TABLE public.caja_turno ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_caja_turno ON public.caja_turno FOR SELECT
  USING (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_insert_caja_turno ON public.caja_turno FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_update_caja_turno ON public.caja_turno FOR UPDATE
  USING (tenant_id = public.current_tenant_id ())
  WITH CHECK (tenant_id = public.current_tenant_id ());

CREATE POLICY tenant_delete_caja_turno ON public.caja_turno FOR DELETE
  USING (tenant_id = public.current_tenant_id ());

-- ─── comprobante: columnas nuevas (conviven con caja_id TEXT legacy) ────────
ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS caja_uuid UUID REFERENCES public.caja (id) ON DELETE RESTRICT;

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS caja_turno_id UUID REFERENCES public.caja_turno (id) ON DELETE RESTRICT;

ALTER TABLE public.comprobante
  ADD COLUMN IF NOT EXISTS numero_caja INTEGER;

CREATE INDEX IF NOT EXISTS idx_comprobante_caja_uuid ON public.comprobante (caja_uuid)
WHERE
  caja_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comprobante_caja_turno ON public.comprobante (caja_turno_id)
WHERE
  caja_turno_id IS NOT NULL;

COMMENT ON COLUMN public.comprobante.caja_uuid IS
  'FK a caja (UUID). Convive con caja_id TEXT hasta migración de cleanup.';

COMMENT ON COLUMN public.comprobante.caja_turno_id IS
  'Turno de caja activo al emitir el ticket (fase POS).';

COMMENT ON COLUMN public.comprobante.numero_caja IS
  'Correlativo de ticket por caja; comprobantes fiscales siguen usando numero.';

-- ─── Backfill: una "Caja general" por sucursal ────────────────────────────────
INSERT INTO public.caja (tenant_id, sucursal_id, numero, nombre)
SELECT
  s.tenant_id,
  s.id,
  1,
  'Caja general'
FROM
  public.sucursal s
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      public.caja c
    WHERE
      c.sucursal_id = s.id
  );

-- Tickets con número: caja + numero_caja en un solo UPDATE (evita chk_ticket_numero_caja a mitad de backfill)
UPDATE public.comprobante c
SET
  caja_uuid = (
    SELECT
      ca.id
    FROM
      public.caja ca
    WHERE
      ca.sucursal_id = c.sucursal_id
      AND ca.numero = 1
    LIMIT
      1
  ),
  numero_caja = c.numero
WHERE
  c.tipo = 'ticket'::public.tipo_comprobante
  AND c.caja_uuid IS NULL
  AND c.numero IS NOT NULL;

-- CHECK e índice único después del backfill (no pueden existir filas ticket+caja sin numero_caja)
ALTER TABLE public.comprobante
  DROP CONSTRAINT IF EXISTS chk_ticket_numero_caja;

ALTER TABLE public.comprobante
  ADD CONSTRAINT chk_ticket_numero_caja CHECK (
    NOT (tipo = 'ticket'::public.tipo_comprobante AND caja_uuid IS NOT NULL)
    OR numero_caja IS NOT NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS uk_comprobante_ticket_caja_numero ON public.comprobante (caja_uuid, numero_caja)
WHERE
  tipo = 'ticket'::public.tipo_comprobante
  AND caja_uuid IS NOT NULL
  AND numero_caja IS NOT NULL;
