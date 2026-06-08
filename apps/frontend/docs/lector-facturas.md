---
estado: ✅ Implementado (núcleo v7)
version: v1.0
ultima_actualizacion: 2026-04-21
---

# Nexus — Lector de facturas con IA

## Visión general

El **lector de facturas** permite subir un PDF o imagen de un comprobante (factura A/B/C, remito, ticket), extraer datos con **Gemini**, matchear proveedor/cliente por CUIT e ítems contra el catálogo, y tras un **preview editable** crear un `comprobante` en estado **`importado`** con movimientos de stock y cuenta corriente opcionales.

El costo de compra registrado en el comprobante importado es el **hecho económico de la factura**: **no** se aplica el `proveedor.descuento_pct` del acuerdo comercial (ese descuento solo interviene en el flujo de **listas de precios del analizador**).

**Matching automático con el catálogo (código interno)** — Tras la extracción IA, el motor de matching (`matchearItemsPrevia`) resuelve cada línea contra el catálogo del tenant **priorizando el código** leído en la factura (`item.codigo` → `producto.codigo`): comparación normalizada (trim, minúsculas y variante compacta sin guiones/espacios). **No** exige coincidencia de proveedor ni de código de barras: cualquier producto **activo** con el mismo código interno puede enlazarse. Si **varios** productos comparten ese código (p. ej. mismo SKU cargado por distintos proveedores), se elige uno de forma **determinística** (menor `id` UUID). Luego, ítems no resueltos por código siguen con match por **nombre** normalizado y, si aplica, **IA fuzzy**. En la confirmación, si un ítem venía como «crear desde factura» pero el código ya existe en el mismo tenant, el servidor **reutiliza** ese producto en lugar de crear fila duplicada (`buscar-por-codigo-interno.ts`).

Es el complemento de **`ia_precios`**: allí se extraen **listas de precios**; aquí **facturas o tickets**. Ambos comparten:

- Cliente `llamarGemini` (`src/lib/ia/gemini.ts`).
- **Límite mensual unificado** de usos de IA (`src/lib/ia/limite.ts`): cuenta filas en `importacion_log` con `origen` en `ia_pdf` y `lector_factura`.
- Patrón UX **carga → preview → confirmar** (alineado a `/ia-precios`).

Documento de planificación y decisiones de producto: **`docs/PLAN-H.md`**. Migración principal: **`supabase/migrations/046_lector_facturas_fase1.sql`**.

---

## Acceso (módulos y guards)

En `modulo_config` existe el flag **`lector_facturas`** (default `false`). La función SQL **`activar_plan(..., 'completo')`** lo pone en `true` junto al resto del plan completo.

En la **aplicación**, el acceso al lector (sidebar, páginas y APIs) usa el arreglo **`MODULOS_ACCESO_LECTOR_FACTURAS`** (`src/lib/modulos/modulo-key.ts`):

- `lector_facturas` **o**
- `facturador_simple`

Así, los tenants con facturación simple ven el menú y pueden usar el flujo aunque el flag dedicado siga en `false`. Las rutas servidor usan **`requireModuloAny`** (`src/lib/modulos/page-guard.ts`) y las APIs **`moduloGuardAny`** (`src/lib/modulos/guard.ts`) con ese mismo arreglo.

**Rol:** operadores y admins pueden confirmar; **visor** queda bloqueado en las APIs que lo aplican (p. ej. confirmar).

---

## Rutas de UI

| Ruta | Descripción |
|---|---|
| `/lector-facturas` | Pantalla principal: extracción (drop zone estilo IA Precios), preview, opciones de operación/stock/CC/costos, confirmación. |
| `/lector-facturas/historial` | Tabla de últimos registros de `lector_factura_log` (fecha, archivo, estado, dirección, enlace a facturación si hay comprobante). |

No existen en la implementación actual las rutas planificadas `/lector-facturas/nueva`, `/lector-facturas/logs` ni detalle `/lector-facturas/logs/[id]`; el historial está unificado en `/historial`.

Tras confirmar con éxito, el cliente redirige a **`/facturacion`**.

---

## Navegación (sidebar)

El ítem **«Lector facturas»** aparece en:

- **Importar** (junto a IA Precios).
- **Facturación** (entre Facturación y POS).

Configuración en `src/components/dashboard/dashboard-chrome.tsx` con ícono `ScanText` y visibilidad vía **`moduloAny: MODULOS_ACCESO_LECTOR_FACTURAS`**.

---

## APIs

Para la API publica async orientada a chatbots e integraciones externas, ver **`docs/lector-facturas-api.md`**.

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/lector-facturas/extraer` | `multipart/form-data` con campo `archivo`. Sube a Storage (`facturas-recibidas`), llama a Gemini, persiste `lector_factura_log`, matching de ítems, devuelve payload de preview (incl. `log_id`, `iva_porcentaje` por ítem, `iva_default` cuando aplica). |
| `POST` | `/api/lector-facturas/confirmar` | JSON con `log_id`, datos de cabecera, ítems con `producto_id`, totales y flags (`actualizar_costos`, `afecta_stock`, `afecta_cuenta_corriente`). Crea comprobante importado, ítems, movimientos, CC, `precio_historial` si corresponde. |
| `GET` | `/api/lector-facturas/limite` | `{ permitido, usadas, limite }` para el contador mensual compartido. |
| `GET` | `/api/lector-facturas/logs` | Hasta 100 filas recientes del log para el tenant. |

**No implementado:** `DELETE /api/lector-facturas/logs/[id]` (marcar descartado), descrito aún como idea en `PLAN-H.md`.

**Tipos de comprobante confirmables** en UI/backend alineados a la fase actual: `factura_a`, `factura_b`, `factura_c`, `remito`, `ticket`. Notas de crédito/débito automáticas quedan fuera del alcance inicial.

---

## Base de datos (resumen)

Definido en la migración **046**:

- Tabla **`lector_factura_log`** (auditoría por extracción: archivo, `gemini_raw`, `datos_extraidos`, `direccion`, `estado`, `comprobante_id`, etc.) con RLS por tenant.
- **`modulo_config.lector_facturas`**
- Enum **`estado_comprobante`**: valor **`importado`**
- **`comprobante.tipo_operacion`**, **`comprobante.proveedor_id`** (y vínculos para compras importadas)
- **`cuenta_corriente`**: soporte **proveedor** (`proveedor_id`), uniques parciales cliente/proveedor; ajustes en **`registrar_pago`**
- Bucket Storage **`facturas-recibidas`** con políticas por tenant
- **`importacion_log`**: uso del origen / conteo para límite IA según implementación en `limite.ts`

Origen de movimientos / historial: referencias tipo **`factura_recibida`** / **`factura_importada`** (y `precio_historial` con origen de factura recibida cuando se actualizan costos).

Detalle de columnas e índices: ver **`PLAN-H.md`** y el SQL de **`046_lector_facturas_fase1.sql`**.

---

## Código principal

| Área | Ubicación |
|---|---|
| Prompt y extracción JSON | `src/lib/ia/prompts.ts` (`PROMPT_EXTRACCION_FACTURA`), `src/lib/lector-facturas/extraccion.ts` |
| Dirección CUIT / proveedor-cliente | `src/lib/lector-facturas/direccion.ts` |
| Storage y rate limit | `src/lib/lector-facturas/storage.ts`, `rate-limit.ts` |
| CC al confirmar | `src/lib/lector-facturas/cuenta-corriente-helpers.ts` |
| Matching ítems | `src/lib/analizador/matching.ts` (`ItemMatcheable`, `matchearItemsPrevia`, etc.) |
| UI | `src/components/lector-facturas/extraer-factura.tsx`, `lector-facturas-client.tsx`, `lector-historial-client.tsx` |
| Páginas | `src/app/(dashboard)/lector-facturas/page.tsx`, `historial/page.tsx` |

---

## Compra: ítem sin producto en catálogo

Si la operación es **compra** y un ítem no matchea, el usuario puede confirmar igual: se muestra **advertencia** en pantalla y, al confirmar, el backend **crea un `producto`** mínimo (nombre = descripción de la línea, código del PDF o `LFA-…`, proveedor de la factura, costo/IVA/unidad de la línea, precio de venta con 0 % de margen sobre ese costo e IVA) y luego registra **comprobante, ítems y movimiento** como el resto. En **venta** sigue siendo obligatorio tener producto del catálogo en cada línea.

## Preferencias de negocio aplicables

Al confirmar una factura **recibida** (compra), el lector respeta las preferencias `business_prefs` (definidas en **Configuración → Catálogo y proveedores**):

- **`unificarProductosEntreProveedores`**: en importador / alta manual / POS aplica match estricto `código + código de barras` para no duplicar. **En el lector de facturas el vínculo automático con el catálogo es por código interno únicamente** (línea de factura ↔ `producto.codigo`), **sin filtrar por proveedor**; si varios activos comparten el mismo código en el tenant, se elige uno de forma estable (menor `id`). El usuario puede seguir eligiendo otro producto a mano en la UI.
- **`precioCostoSoloSube`**: cuando el usuario marca "Actualizar costos al confirmar", el costo de cada producto solo se actualiza si la factura trae un costo **mayor** al actual. Si trae un costo menor, se mantiene el costo previo (pensado para evitar bajadas accidentales por reposiciones puntuales).
- **`registrarLotesPorIngreso`**: cada `entrada` por compra genera además una fila en `producto_lote_ingreso` con cantidad, costo y proveedor del ítem, enlazada al `lector_factura_log_id` y al `movimiento_id`. La ficha del producto muestra esos lotes en la pestaña **Lotes / Vencimientos**. Cómo se reflejan en alertas del dashboard y qué ocurre ante varios vencimientos o ventas sin consumir lote está documentado en `docs/stock.md` («Alertas vs. varios lotes»).

`movimiento.proveedor_id` se setea automáticamente con el proveedor del comprobante en cada entrada.

## Limitaciones y mejoras pendientes

- Sin **transacción única** end-to-end en confirmar: un fallo parcial puede dejar objetos inconsistentes (mejora futura).
- **Duplicados** de misma factura: lógica depende de número/proveedor; revisar casos borde.
- **DELETE** de logs / soft-delete no expuesto en API.
- **Widget** en dashboard y alertas de “facturas importadas del mes” no incluidos en el núcleo actual.

---

## Referencias

- `docs/PLAN-H.md` — Plan bloque H, diagramas, riesgos, tickets.
- `docs/ia-precios.md` — Patrón Gemini, preview, importación.
- `docs/facturacion.md` — Comprobantes y emisión.
- `docs/base-de-datos.md` — `modulo_config`, orden de migraciones.
- `docs/modulos.md` — Feature flags y mapa de rutas (incluye `lector_facturas`).
