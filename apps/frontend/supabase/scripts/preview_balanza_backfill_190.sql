-- Preview migración 190 — balanzaConfigPorSucursal backfill
-- Solo lectura. Ejecutar en SQL Editor (Supabase prod/staging) antes de db push.
-- Misma lógica que supabase/migrations/190_balanza_config_por_sucursal_backfill.sql

-- ── 1) Resumen ─────────────────────────────────────────────────────────────
WITH overrides AS (
  SELECT
    t.id AS tenant_id,
    t.nombre AS tenant_nombre,
    COALESCE(t.pos_prefs ->> 'balanzaConfigPorSucursal', 'false') AS flag_actual,
    s.id AS sucursal_id,
    s.nombre AS sucursal_nombre,
    s.codigo AS sucursal_codigo,
    COALESCE(t.pos_prefs ->> 'balanzaTemplate', '') AS tenant_balanza_template,
    COALESCE(s.pos_prefs ->> 'balanzaTemplate', '') AS sucursal_balanza_template,
    COALESCE(t.pos_prefs -> 'balanzaTemplates', '[]'::jsonb) AS tenant_balanza_templates,
    COALESCE(s.pos_prefs -> 'balanzaTemplates', '[]'::jsonb) AS sucursal_balanza_templates,
    COALESCE(t.pos_prefs ->> 'balanzaUnidadTemplate', '') AS tenant_balanza_unidad,
    COALESCE(s.pos_prefs ->> 'balanzaUnidadTemplate', '') AS sucursal_balanza_unidad,
    COALESCE(t.pos_prefs ->> 'balanzaImporteTemplate', '') AS tenant_balanza_importe,
    COALESCE(s.pos_prefs ->> 'balanzaImporteTemplate', '') AS sucursal_balanza_importe
  FROM public.tenant t
  INNER JOIN public.sucursal s ON s.tenant_id = t.id
  WHERE s.pos_prefs IS NOT NULL
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
)
SELECT
  COUNT(DISTINCT tenant_id) AS tenants_a_backfillear,
  COUNT(*) AS sucursales_con_override_balanza
FROM overrides
WHERE flag_actual IS DISTINCT FROM 'true';

-- ── 2) Detalle por negocio / sucursal (qué cambiaría el 190) ───────────────
WITH overrides AS (
  SELECT
    t.id AS tenant_id,
    t.nombre AS tenant_nombre,
    COALESCE(t.pos_prefs ->> 'balanzaConfigPorSucursal', 'false') AS flag_actual,
    s.id AS sucursal_id,
    s.nombre AS sucursal_nombre,
    s.codigo AS sucursal_codigo,
    COALESCE(t.pos_prefs -> 'balanzaTemplates', '[]'::jsonb) AS tenant_templates,
    COALESCE(s.pos_prefs -> 'balanzaTemplates', '[]'::jsonb) AS sucursal_templates,
    COALESCE(t.pos_prefs ->> 'balanzaUnidadTemplate', '') AS tenant_unidad,
    COALESCE(s.pos_prefs ->> 'balanzaUnidadTemplate', '') AS sucursal_unidad,
    COALESCE(t.pos_prefs ->> 'balanzaImporteTemplate', '') AS tenant_importe,
    COALESCE(s.pos_prefs ->> 'balanzaImporteTemplate', '') AS sucursal_importe
  FROM public.tenant t
  INNER JOIN public.sucursal s ON s.tenant_id = t.id
  WHERE s.pos_prefs IS NOT NULL
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
)
SELECT
  tenant_nombre,
  tenant_id,
  flag_actual,
  '→ true' AS flag_despues_190,
  sucursal_codigo,
  sucursal_nombre,
  CASE WHEN tenant_templates IS DISTINCT FROM sucursal_templates THEN 'templates' END AS diff_templates,
  CASE WHEN tenant_unidad IS DISTINCT FROM sucursal_unidad THEN 'unidad' END AS diff_unidad,
  CASE WHEN tenant_importe IS DISTINCT FROM sucursal_importe THEN 'importe' END AS diff_importe,
  tenant_templates,
  sucursal_templates
FROM overrides
WHERE flag_actual IS DISTINCT FROM 'true'
ORDER BY tenant_nombre, sucursal_codigo;

-- ── 3) Ya tienen el flag activo (190 no los toca) ───────────────────────────
SELECT
  t.id,
  t.nombre,
  t.pos_prefs ->> 'balanzaConfigPorSucursal' AS flag
FROM public.tenant t
WHERE COALESCE(t.pos_prefs ->> 'balanzaConfigPorSucursal', 'false') = 'true'
ORDER BY t.nombre;

-- ── 4) Sucursales con pos_prefs pero SIN override de balanza (no entran al 190)
SELECT
  t.nombre AS tenant_nombre,
  s.codigo,
  s.nombre AS sucursal_nombre
FROM public.tenant t
INNER JOIN public.sucursal s ON s.tenant_id = t.id
WHERE s.pos_prefs IS NOT NULL
  AND NOT (
    COALESCE(s.pos_prefs ->> 'balanzaTemplate', '')
    IS DISTINCT FROM COALESCE(t.pos_prefs ->> 'balanzaTemplate', '')
    OR COALESCE(s.pos_prefs -> 'balanzaTemplates', '[]'::jsonb)
    IS DISTINCT FROM COALESCE(t.pos_prefs -> 'balanzaTemplates', '[]'::jsonb)
    OR COALESCE(s.pos_prefs ->> 'balanzaUnidadTemplate', '')
    IS DISTINCT FROM COALESCE(t.pos_prefs ->> 'balanzaUnidadTemplate', '')
    OR COALESCE(s.pos_prefs ->> 'balanzaImporteTemplate', '')
    IS DISTINCT FROM COALESCE(t.pos_prefs ->> 'balanzaImporteTemplate', '')
  )
ORDER BY t.nombre, s.codigo;

-- ── 5) PLU por sucursal (tabla 189; solo informativo post-migración) ────────
-- Ejecutar después de aplicar 189. Negocios con filas acá necesitan opt-in para PLU dep.
SELECT
  t.nombre AS tenant_nombre,
  COUNT(DISTINCT ps.producto_id) AS productos_con_plu_override,
  COUNT(DISTINCT ps.sucursal_id) AS sucursales_con_plu_override
FROM public.plu_sucursal ps
INNER JOIN public.tenant t ON t.id = ps.tenant_id
GROUP BY t.id, t.nombre
ORDER BY t.nombre;
