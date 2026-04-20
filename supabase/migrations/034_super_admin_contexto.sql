-- Super admin: whitelist por tenant, contexto de impersonación en JWT (custom_access_token_hook),
-- auditoría de cambios de contexto. Ver docs/multi-tenancy.md.

ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS es_super_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tenant_contexto_id uuid REFERENCES public.tenant (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.usuario.es_super_admin IS 'Staff de plataforma: puede actuar en tenants de super_admin_tenant_acceso.';
COMMENT ON COLUMN public.usuario.tenant_contexto_id IS 'Tenant efectivo si es super admin; NULL = usar tenant_id (casa).';

CREATE TABLE IF NOT EXISTS public.super_admin_tenant_acceso (
  usuario_id uuid NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_super_admin_tenant_acceso_tenant
  ON public.super_admin_tenant_acceso (tenant_id);

CREATE TABLE IF NOT EXISTS public.super_admin_contexto_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  tenant_id_prev uuid REFERENCES public.tenant (id) ON DELETE SET NULL,
  tenant_id_next uuid REFERENCES public.tenant (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_super_admin_contexto_log_usuario
  ON public.super_admin_contexto_log (usuario_id, created_at DESC);

ALTER TABLE public.super_admin_tenant_acceso ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_tenant_acceso_select_own" ON public.super_admin_tenant_acceso;
CREATE POLICY "super_admin_tenant_acceso_select_own"
  ON public.super_admin_tenant_acceso
  FOR SELECT
  TO authenticated
  USING (usuario_id = auth.uid());

ALTER TABLE public.super_admin_contexto_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.usuario_guard_tenant_contexto()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_contexto_id IS DISTINCT FROM OLD.tenant_contexto_id THEN
    IF current_setting('app.allow_tenant_contexto', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'tenant_contexto_id solo puede cambiarse vía super_admin_set_tenant_contexto';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS usuario_tenant_contexto_guard ON public.usuario;
CREATE TRIGGER usuario_tenant_contexto_guard
  BEFORE UPDATE OF tenant_contexto_id ON public.usuario
  FOR EACH ROW
  EXECUTE FUNCTION public.usuario_guard_tenant_contexto();

CREATE OR REPLACE FUNCTION public.super_admin_set_tenant_contexto(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_prev uuid;
  v_home uuid;
  v_super boolean;
  v_target uuid := p_tenant_id;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT u.tenant_contexto_id, u.tenant_id, u.es_super_admin
  INTO v_prev, v_home, v_super
  FROM public.usuario u
  WHERE u.id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario no encontrado';
  END IF;

  IF NOT v_super THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  IF v_target IS NOT NULL AND v_target <> v_home THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.super_admin_tenant_acceso s
      WHERE s.usuario_id = v_uid AND s.tenant_id = v_target
    ) THEN
      RAISE EXCEPTION 'Sin acceso a este negocio';
    END IF;
  END IF;

  IF v_target IS NOT NULL AND v_target = v_home THEN
    v_target := NULL;
  END IF;

  IF v_prev IS NOT DISTINCT FROM v_target THEN
    RETURN;
  END IF;

  PERFORM set_config('app.allow_tenant_contexto', 'true', true);

  UPDATE public.usuario u
  SET tenant_contexto_id = v_target
  WHERE u.id = v_uid;

  INSERT INTO public.super_admin_contexto_log (usuario_id, tenant_id_prev, tenant_id_next)
  VALUES (v_uid, v_prev, v_target);
END;
$$;

REVOKE ALL ON FUNCTION public.super_admin_set_tenant_contexto(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.super_admin_set_tenant_contexto(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_home uuid;
  v_context uuid;
  v_super boolean;
  v_effective uuid;
  v_uid uuid;
BEGIN
  v_uid := (event->>'user_id')::uuid;

  SELECT u.tenant_id, u.tenant_contexto_id, u.es_super_admin
  INTO v_home, v_context, v_super
  FROM public.usuario u
  WHERE u.id = v_uid;

  IF v_home IS NULL THEN
    RETURN event;
  END IF;

  v_effective := v_home;

  IF v_super AND v_context IS NOT NULL AND v_context <> v_home THEN
    IF EXISTS (
      SELECT 1
      FROM public.super_admin_tenant_acceso s
      WHERE s.usuario_id = v_uid AND s.tenant_id = v_context
    ) THEN
      v_effective := v_context;
    END IF;
  END IF;

  event := jsonb_set(
    event,
    '{claims,tenant_id}',
    to_jsonb(v_effective::text)
  );

  RETURN event;
END;
$$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

GRANT SELECT ON TABLE public.super_admin_tenant_acceso TO supabase_auth_admin;

-- Permitir al super admin leer datos básicos de tenants en su whitelist (selector, etiquetas).
DROP POLICY IF EXISTS "tenant_select_super_admin_acceso" ON public.tenant;
CREATE POLICY "tenant_select_super_admin_acceso"
  ON public.tenant
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.super_admin_tenant_acceso s
      WHERE s.usuario_id = auth.uid()
        AND s.tenant_id = tenant.id
    )
  );
