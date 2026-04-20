-- Alinear policies de Storage con public.current_tenant_id() (claim JWT `tenant_id`).
-- Las migraciones 013 y 022 usaban app_metadata.tenant_id, que no coincide con el resto
-- del proyecto (017_lista_precios, RLS de tablas) y bloqueaba INSERT/UPDATE en storage.

-- Bucket comprobantes
DROP POLICY IF EXISTS "Tenant lee sus comprobantes" ON storage.objects;
DROP POLICY IF EXISTS "Tenant sube sus comprobantes" ON storage.objects;

CREATE POLICY "Tenant lee sus comprobantes"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'comprobantes'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Tenant sube sus comprobantes"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'comprobantes'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Tenant actualiza sus comprobantes"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'comprobantes'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
)
WITH CHECK (
  bucket_id = 'comprobantes'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Tenant borra sus comprobantes"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'comprobantes'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

-- Bucket listas-precios
DROP POLICY IF EXISTS "Tenant lee sus listas de precios" ON storage.objects;
DROP POLICY IF EXISTS "Tenant sube sus listas de precios" ON storage.objects;

CREATE POLICY "Tenant lee sus listas de precios"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'listas-precios'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Tenant sube sus listas de precios"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'listas-precios'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Tenant actualiza sus listas de precios"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'listas-precios'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
)
WITH CHECK (
  bucket_id = 'listas-precios'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Tenant borra sus listas de precios"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'listas-precios'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);
