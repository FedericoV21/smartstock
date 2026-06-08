-- Super admin: el JWT lleva tenant_id efectivo (cliente), pero la fila del staff en
-- public.usuario sigue con tenant_id = negocio casa. Sin esta policy, RLS oculta la
-- propia fila y la app deja de reconocer al usuario tras cambiar contexto.

DROP POLICY IF EXISTS "usuario_select_own_row" ON public.usuario;
CREATE POLICY "usuario_select_own_row"
  ON public.usuario
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());
