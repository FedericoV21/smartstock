-- Soft delete de usuarios (no borrar filas).
-- Mantiene historial y evita cascadas inesperadas.

ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

CREATE INDEX IF NOT EXISTS idx_usuario_tenant_deleted_at
  ON public.usuario (tenant_id, deleted_at);

COMMENT ON COLUMN public.usuario.deleted_at IS
  'Marca de soft delete. NULL = vigente; NOT NULL = eliminado.';
COMMENT ON COLUMN public.usuario.deleted_by IS
  'Usuario que ejecutó el soft delete (auth.uid), si aplica.';

