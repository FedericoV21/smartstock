-- Preferencia de negocio: acceso a despiece (carnicerías, pollos).
-- Los negocios existentes mantienen el acceso hasta que desactiven la opción manualmente.

UPDATE public.tenant
SET business_prefs = COALESCE(business_prefs, '{}'::jsonb) || '{"despieceCarniceriaHabilitado": true}'::jsonb
WHERE NOT ((COALESCE(business_prefs, '{}'::jsonb)) ? 'despieceCarniceriaHabilitado');

NOTIFY pgrst, 'reload schema';
