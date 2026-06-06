-- Verificaci├│n NB-ARC-106 ÔÇö ejecutar contra Postgres del backend Nest.
-- Reemplazar :tenant_id con el UUID del tenant de prueba (demo: 00000000-0000-4000-8000-000000000001).

\set tenant_id '00000000-0000-4000-8000-000000000001'

-- Config ARCA (sin exponer secretos)
SELECT
  tenant_id,
  sucursal_id,
  ambiente,
  cuit_emisor,
  punto_de_venta,
  (certificado_pem IS NOT NULL) AS has_certificado,
  (clave_privada_pem IS NOT NULL) AS has_clave,
  ticket_expiracion,
  updated_at
FROM public.arca_config
WHERE tenant_id = :'tenant_id';

-- Comprobantes pendientes / emitidos recientes
SELECT id, tipo, numero, estado, cae, cae_vencimiento, intentos_arca, ultimo_error_arca_codigo
FROM public.comprobante
WHERE tenant_id = :'tenant_id'
  AND estado IN ('pendiente_arca', 'error_arca', 'emitido')
ORDER BY created_at DESC
LIMIT 10;

-- ├Ültimos logs ARCA (evidencia)
SELECT
  id,
  servicio,
  operacion,
  exitoso,
  error_codigo,
  left(error_mensaje, 120) AS error_mensaje,
  comprobante_id,
  created_at
FROM public.arca_log
WHERE tenant_id = :'tenant_id'
ORDER BY created_at DESC
LIMIT 20;

-- Jobs cola (si aplica)
SELECT j.id, j.estado, j.intentos, j.comprobante_id, j.created_at
FROM public.arca_job j
JOIN public.comprobante c ON c.id = j.comprobante_id
WHERE c.tenant_id = :'tenant_id'
ORDER BY j.created_at DESC
LIMIT 10;
