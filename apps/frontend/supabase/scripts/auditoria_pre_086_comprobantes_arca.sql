-- V90-ARCA-011: ejecutar ANTES de aplicar 086_comprobante_arca_numeracion_v9.sql.
-- Debe devolver 0 filas antes de migrar. Si hay filas:
--   - Si tiene CAE válido (14 dígitos): revisar y pasar a emitido o corregir estado.
--   - Si no tiene CAE: anular localmente o corregir datos; el número fiscal no debía consumirse sin CAE.

SELECT tenant_id, id, tipo, numero, estado, cae, created_at
FROM public.comprobante
WHERE estado IN ('pendiente_arca', 'error_arca')
  AND numero IS NOT NULL
ORDER BY tenant_id, created_at;
