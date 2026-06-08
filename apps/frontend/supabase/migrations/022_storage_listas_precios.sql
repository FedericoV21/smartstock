-- Migración 022: Bucket de Storage para listas de precios (archivos originales).
-- Sigue el patrón de 013_storage_comprobantes.sql.

INSERT INTO storage.buckets (id, name, public)
VALUES ('listas-precios', 'listas-precios', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Tenant lee sus listas de precios"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'listas-precios'
  AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
);

CREATE POLICY "Tenant sube sus listas de precios"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'listas-precios'
  AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
);
