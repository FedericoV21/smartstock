-- Logos de negocio para tickets POS (y otros usos). Bucket público para que la impresión
-- térmica cargue la imagen sin cookies; escritura restringida al tenant.

INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-logos', 'tenant-logos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

CREATE POLICY "Cualquiera lee logos de tenant"
ON storage.objects FOR SELECT
USING (bucket_id = 'tenant-logos');

CREATE POLICY "Tenant sube su logo"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'tenant-logos'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Tenant actualiza su logo"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'tenant-logos'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
)
WITH CHECK (
  bucket_id = 'tenant-logos'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

CREATE POLICY "Tenant borra su logo"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'tenant-logos'
  AND public.current_tenant_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);
