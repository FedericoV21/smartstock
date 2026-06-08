-- Imágenes de producto para POS (miniaturas). Bucket público para que el cliente cargue la URL sin cookies;
-- escritura restringida al tenant (primera carpeta = tenant_id).

INSERT INTO storage.buckets (id, name, public)
VALUES ('producto-imagenes', 'producto-imagenes', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

CREATE POLICY "Cualquiera lee imagenes de producto"
ON storage.objects FOR SELECT
USING (bucket_id = 'producto-imagenes');

CREATE POLICY "Tenant sube imagenes de producto"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'producto-imagenes'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Tenant actualiza imagenes de producto"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'producto-imagenes'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
)
WITH CHECK (
  bucket_id = 'producto-imagenes'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Tenant borra imagenes de producto"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'producto-imagenes'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);
