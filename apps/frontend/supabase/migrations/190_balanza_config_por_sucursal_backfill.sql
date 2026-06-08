-- Negocios que ya guardaron plantillas de balanza distintas en sucursal.pos_prefs
-- deben seguir con el comportamiento por sucursal tras el opt-in explícito (default false).

UPDATE public.tenant t
SET
  pos_prefs = COALESCE(t.pos_prefs, '{}'::jsonb) || '{"balanzaConfigPorSucursal": true}'::jsonb
WHERE COALESCE(t.pos_prefs ->> 'balanzaConfigPorSucursal', 'false') IS DISTINCT FROM 'true'
  AND EXISTS (
    SELECT 1
    FROM public.sucursal s
    WHERE s.tenant_id = t.id
      AND s.pos_prefs IS NOT NULL
      AND (
        COALESCE(s.pos_prefs ->> 'balanzaTemplate', '')
        IS DISTINCT FROM COALESCE(t.pos_prefs ->> 'balanzaTemplate', '')
        OR COALESCE(s.pos_prefs -> 'balanzaTemplates', '[]'::jsonb)
        IS DISTINCT FROM COALESCE(t.pos_prefs -> 'balanzaTemplates', '[]'::jsonb)
        OR COALESCE(s.pos_prefs ->> 'balanzaUnidadTemplate', '')
        IS DISTINCT FROM COALESCE(t.pos_prefs ->> 'balanzaUnidadTemplate', '')
        OR COALESCE(s.pos_prefs ->> 'balanzaImporteTemplate', '')
        IS DISTINCT FROM COALESCE(t.pos_prefs ->> 'balanzaImporteTemplate', '')
      )
  );

COMMENT ON COLUMN public.tenant.pos_prefs IS
  'Preferencias POS por defecto del negocio (JSON). balanzaConfigPorSucursal=true habilita plantillas/PLU por sucursal; migración 190 activa el flag en tenants con overrides legacy.';
