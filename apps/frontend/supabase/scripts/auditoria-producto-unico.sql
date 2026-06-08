-- Auditoría fase 0 — producto único por tenant (plan docs/plan producto unico.md)
-- Ejecutar con rol de servicio (p. ej. SQL Editor en Supabase con service role) para bypassar RLS.
-- Solo lectura: no modifica datos.

-- Resumen por tenant
WITH grupos AS (
  SELECT
    tenant_id,
    LOWER(TRIM(codigo)) AS cod_norm,
    unidad,
    COUNT(*) AS n_filas,
    COUNT(DISTINCT sucursal_id) AS n_sucursales,
    COUNT(DISTINCT precio_venta) AS n_precios_venta_distintos,
    COUNT(DISTINCT precio_costo) AS n_costos_distintos,
    COUNT(DISTINCT codigo_barras) FILTER (WHERE codigo_barras IS NOT NULL) AS n_barcodes,
    COUNT(DISTINCT LOWER(TRIM(nombre))) AS n_nombres_distintos,
    COUNT(DISTINCT proveedor_id) FILTER (WHERE proveedor_id IS NOT NULL) AS n_proveedores,
    COUNT(DISTINCT iva_porcentaje) AS n_ivas_distintos,
    BOOL_OR(es_pesable) AS algun_pesable,
    BOOL_OR(NOT es_pesable) AS algun_no_pesable,
    SUM(stock_actual) AS stock_total,
    array_agg(id ORDER BY updated_at DESC) AS ids,
    array_agg(sucursal_id ORDER BY updated_at DESC) AS sucursales
  FROM public.producto
  WHERE activo = true
    AND codigo IS NOT NULL
    AND codigo <> ''
  GROUP BY tenant_id, LOWER(TRIM(codigo)), unidad
  HAVING COUNT(*) > 1
),
resumen_tenant AS (
  SELECT
    tenant_id,
    COUNT(*) AS grupos_duplicados,
    SUM(CASE WHEN n_precios_venta_distintos > 1 THEN 1 ELSE 0 END) AS conflictos_precio_venta,
    SUM(CASE WHEN n_costos_distintos > 1 THEN 1 ELSE 0 END) AS conflictos_costo,
    SUM(CASE WHEN n_barcodes > 1 THEN 1 ELSE 0 END) AS conflictos_barcode,
    SUM(CASE WHEN n_nombres_distintos > 1 THEN 1 ELSE 0 END) AS conflictos_nombre,
    SUM(CASE WHEN n_proveedores > 1 THEN 1 ELSE 0 END) AS conflictos_proveedor,
    SUM(CASE WHEN n_ivas_distintos > 1 THEN 1 ELSE 0 END) AS conflictos_iva,
    SUM(CASE WHEN algun_pesable AND algun_no_pesable THEN 1 ELSE 0 END) AS conflictos_pesable,
    MAX(n_filas) AS max_filas_en_grupo
  FROM grupos
  GROUP BY tenant_id
)
SELECT
  t.id AS tenant_id,
  t.nombre,
  t.plan,
  COALESCE(r.grupos_duplicados, 0) AS grupos_duplicados,
  COALESCE(r.conflictos_precio_venta, 0) AS conflictos_precio_venta,
  COALESCE(r.conflictos_costo, 0) AS conflictos_costo,
  COALESCE(r.conflictos_barcode, 0) AS conflictos_barcode,
  COALESCE(r.conflictos_nombre, 0) AS conflictos_nombre,
  COALESCE(r.conflictos_proveedor, 0) AS conflictos_proveedor,
  COALESCE(r.conflictos_iva, 0) AS conflictos_iva,
  COALESCE(r.conflictos_pesable, 0) AS conflictos_pesable,
  COALESCE(r.max_filas_en_grupo, 0) AS max_filas_en_grupo,
  CASE
    WHEN r.grupos_duplicados IS NULL THEN 'limpio'
    WHEN COALESCE(r.conflictos_precio_venta, 0) + COALESCE(r.conflictos_barcode, 0) + COALESCE(r.conflictos_nombre, 0) = 0 THEN 'trivial'
    WHEN COALESCE(r.conflictos_precio_venta, 0) > 0 OR COALESCE(r.conflictos_barcode, 0) > 0 THEN 'requiere_resolucion'
    ELSE 'menor'
  END AS dificultad_migracion
FROM public.tenant t
LEFT JOIN resumen_tenant r ON r.tenant_id = t.id
ORDER BY COALESCE(r.grupos_duplicados, 0) DESC;

-- Detalle: hasta 50 grupos más conflictivos (precio / barcode / nombre)
WITH grupos AS (
  SELECT
    tenant_id,
    LOWER(TRIM(codigo)) AS cod_norm,
    unidad,
    COUNT(*) AS n_filas,
    COUNT(DISTINCT sucursal_id) AS n_sucursales,
    COUNT(DISTINCT precio_venta) AS n_precios_venta_distintos,
    COUNT(DISTINCT codigo_barras) FILTER (WHERE codigo_barras IS NOT NULL) AS n_barcodes,
    COUNT(DISTINCT LOWER(TRIM(nombre))) AS n_nombres_distintos,
    array_agg(id ORDER BY updated_at DESC) AS ids,
    array_agg(sucursal_id ORDER BY updated_at DESC) AS sucursales
  FROM public.producto
  WHERE activo = true
    AND codigo IS NOT NULL
    AND codigo <> ''
  GROUP BY tenant_id, LOWER(TRIM(codigo)), unidad
  HAVING COUNT(*) > 1
)
SELECT
  tenant_id,
  cod_norm,
  unidad,
  n_filas,
  n_sucursales,
  n_precios_venta_distintos,
  n_barcodes,
  n_nombres_distintos,
  ids,
  sucursales
FROM grupos
WHERE n_precios_venta_distintos > 1
   OR n_barcodes > 1
   OR n_nombres_distintos > 1
ORDER BY n_filas DESC, n_precios_venta_distintos DESC
LIMIT 50;
