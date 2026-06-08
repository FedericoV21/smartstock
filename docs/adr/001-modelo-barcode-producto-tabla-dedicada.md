# ADR 001 — Modelo de códigos de barras de producto (tabla dedicada)

- **Estado:** Aceptada  
- **Fecha:** 2026-04-20  
- **Ticket:** NB-BAR-001  

## Contexto

Los productos usan `codigo` como identificador interno (SKU). El legado incluye `producto.codigo_barras` (nullable) mezclando semántica de “código interno” y “código de barras”, con validación débil y dificultad para múltiples barras por ítem (EAN/UPC/ITF14 de proveedores distintos).

## Decisión

1. **Mantener** `producto.codigo` como clave de negocio principal (stock, importación, facturación).  
2. **Introducir** la tabla dedicada `producto_barcode` con:
   - `tenant_id`, `producto_id`, `tipo` (`EAN13` | `UPCA` | `ITF14` | `OTRO`), `valor`, `es_principal`, `activo`, timestamps.  
3. **Unicidad:** un mismo `valor` activo solo una vez por tenant (`uq_producto_barcode_tenant_valor_activo`).  
4. **Principal:** a lo sumo un barcode principal activo por producto (`uq_producto_barcode_producto_principal_activo`).  
5. **Migración de datos:** backfill desde `producto.codigo_barras` hacia `producto_barcode` con inferencia de `tipo` por longitud (ver migración NB-BAR-002).  
6. **Compatibilidad:** el campo `producto.codigo_barras` puede seguir existiendo en BD para lecturas legacy; la fuente de verdad para altas/edición de barras es `producto_barcode` + API Nest.

## Consecuencias

- **Positivas:** búsqueda POS/import por barcode tipado; validaciones por tipo; múltiples barras por producto sin tocar el SKU.  
- **Coste:** doble lectura posible (legacy + tabla) hasta deprecar explícitamente `codigo_barras` en UI y jobs.  
- **Fiscal ARCA:** el código de barras fiscal del comprobante (NB-ARC-105) es dominio aparte; no reemplaza esta tabla.

## Referencias

- Migración TypeORM: `apps/backend/src/database/migrations/1745100120000-nb-bar-002-producto-barcode.ts`  
- Entidad: `apps/backend/src/products/entities/producto-barcode.entity.ts`  
- Plan histórico: `docs/backend-nest-barcodes-plan.md`  
