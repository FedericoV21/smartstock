-- Migración 013: Bucket de Storage para comprobantes PDF
-- Crea el bucket y policies RLS para que cada tenant solo acceda a sus propios PDFs.
--
-- NOTA: Si el bucket ya fue creado manualmente en el Dashboard de Supabase,
-- esta migración puede fallar. En ese caso, solo ejecutar las policies.

INSERT INTO storage.buckets (id, name, public)
VALUES ('comprobantes', 'comprobantes', false)
ON CONFLICT (id) DO NOTHING;

-- Policy SELECT: solo puede leer archivos en su carpeta {tenant_id}/
CREATE POLICY "Tenant lee sus comprobantes"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'comprobantes'
  AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
);

-- Policy INSERT: solo puede subir archivos en su carpeta {tenant_id}/
CREATE POLICY "Tenant sube sus comprobantes"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'comprobantes'
  AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
);
