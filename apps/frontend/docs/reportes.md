---
estado: activo
version: v8.1
ultima_actualizacion: 2026-04-21
---

# Nexus — Reportes operativos

Guía corta para entender **qué pregunta responde cada reporte**, **de dónde salen los datos** y **qué no cubre** (para no confundir al usuario final).

## Requisitos de módulo

La mayoría de las rutas bajo `/reportes` y sus APIs en `/api/reportes/*` requieren el flag **`analizador_rentabilidad`** en `modulo_config`. El reporte de tickets POS además requiere **`facturador_pos`**. El **cierre de caja** (arqueo de efectivo y snapshot) está en **Facturación** (`/facturacion/cierre-caja`, APIs `/api/caja/*` y, para el CRUD de cajas por sucursal, `/api/configuracion/cajas`) y usa **`facturador_simple`**. Detalle en `docs/facturacion.md`.

## Filtros cronologicos

- **Hoy:** usa el dia calendario actual de Argentina (`desde = hasta = hoy`).
- **Semana:** usa desde el lunes de la semana argentina actual hasta hoy, inclusive.
- **Mes:** usa desde el dia 1 del mes argentino actual hasta hoy, inclusive.
- **Rango con una sola fecha:** usa esa fecha como dia unico (`desde = hasta = fecha`).
- **Rango con dos fechas:** incluye ambos extremos (`desde <= fecha <= hasta`).

Las APIs de reportes paginan internamente las consultas grandes a Supabase/PostgREST para evitar el tope por
defecto de 1000 filas. Los limites visibles en pantalla, cuando existen, solo recortan filas mostradas, no la base de
calculo de los totales.

## Diccionario de reportes (vista rápida)

| Ruta UI | API | Pregunta de negocio |
|--------|-----|---------------------|
| `/reportes` | `GET /api/reportes/resumen` | ¿Cuánto **ingresé** por ventas (facturas A/B/C + tickets POS, neto de NC), desglose, comprobantes, deuda CC y costo proveedores? |
| `/reportes/resumen-general` | (resumen + enlaces) | Atajos al resto de reportes con KPI mensual. |
| `/reportes/ventas-consumidor` | `GET /api/reportes/ventas-consumidor` | ¿Cómo fue el **POS por tickets** (cantidad, monto, franja horaria, caja/operador)? **No** desglosa por producto. |
| `/reportes/ventas-articulo` | `GET /api/reportes/ventas-articulo` | ¿Qué **SKU** vendí (unidades, importe, margen estimado) y cómo está el **stock / vencimiento / última entrada**? |
| `/reportes/clientes` | `GET /api/reportes/clientes-deuda` | ¿Quién debe y cómo está el aging? |
| `/reportes/cta-cte-resumen` | (clientes-deuda / agregados) | Resumen de deuda por cliente. |
| `/reportes/proveedores` | `GET /api/reportes/proveedores-gasto` | Ranking de “gasto” por proveedor según reglas del endpoint (costo asociado a ítems vendidos, no libro de compras). |
| `/reportes/ganancias-netas` | `GET /api/reportes/ganancias-netas` | Serie diaria ventas vs costo (ítems). |
| `/reportes/libro-iva` | `GET /api/reportes/libro-iva` | Libro IVA según comprobantes fiscales. |
| `/reportes/recibos` | `GET /api/reportes/recibos` | Recibos + `cobranza_pago` sin recibo + **`pago`** sin `comprobante_id` (CC). Filtros: período, `cliente_id` (UUID). |
| `/reportes/extracto-cuenta-corriente` | `GET /api/reportes/extracto-cuenta-corriente` | Extracto CC por cliente: cargos (ventas a CC / mixto), NC y pagos con saldo corrido. CSV/PDF. Requiere `facturador_simple`. |
| `/facturacion/cierre-caja` | `GET/POST /api/caja/cierre-z` | Cierre de caja: snapshot + **arqueo** (efectivo sistema vs contado). La ruta `/reportes/cierre-z` redirige aquí. |

### Resumen (`GET /api/reportes/resumen`)

- **`facturado`** (nombre histórico en JSON; en pantalla “ingresos netos”) = neto del rango: suma de `comprobante.total` con `estado = emitido` y `fecha` en el período para **`factura_a` / `factura_b` / `factura_c`** y **`ticket`**, menos la suma de `total` de **`nota_credito_*`**. No suma `presupuesto`, `remito` ni `recibo`.
- Para que el usuario distinga **lo fiscalmente facturado** de **lo vendido solo con ticket**: **`monto_facturas_fiscales`** + **`comprobantes_factura`** vs **`monto_tickets_pos`** + **`comprobantes_ticket`** (tickets no son factura A/B/C en el modelo).
- También: **`monto_notas_credito`**; **`vendidos_comprobantes`** = cantidad de comprobantes de venta (facturas + tickets) en el rango.

### Alertas relacionadas (no son “reporte” pero alimentan operación)

| API | Uso |
|-----|-----|
| `GET /api/alertas/stock-bajo` | Productos con `stock_actual <= stock_minimo` (filtro en listado). |
| `GET /api/alertas/vencimientos` | Productos con `fecha_vencimiento` en ventana próxima. |

---

## Ventas por artículo (`/reportes/ventas-articulo`)

### Fuente de datos

- Líneas: tabla **`comprobante_item`**.
- Cabecera: **`comprobante`** (`estado = emitido`, `fecha` en el período).
- Producto: **`producto`** (código, nombre, stock, mínimo, `fecha_vencimiento`, proveedor y categoría por FK).
- Tipos de comprobante incluidos: mismos criterios que en ganancias netas — ventas (`ticket`, `factura_*`) y **`nota_credito_*`** (cantidades e importes con signo negativo). Se excluyen `presupuesto`, `remito`, `recibo`.

### Métricas (columnas / JSON)

| Métrica | Definición | Tabla / campo |
|--------|------------|----------------|
| `unidades` | Suma de `cantidad` por producto (NC en negativo). | `comprobante_item.cantidad` |
| `unidades_compradas` | Suma de entradas de stock en el período con `referencia_tipo` factura, pedido o importación (fecha `movimiento.created_at`). | `movimiento` (`tipo = entrada`) |
| `indicadores.total_unidades_compradas` | Total de `unidades_compradas` en el resultado. | Derivado |
| `importe_venta` | Suma de `subtotal` por producto (NC en negativo), prorrateado al total cobrado del comprobante cuando `comprobante.total` difiere de la suma de sus lineas. El factor se calcula con todas las lineas del comprobante dentro del alcance, antes de aplicar filtros de producto/categoria/proveedor. | `comprobante_item.subtotal`, `comprobante.total` |
| `costo_total` | Suma de `precio_costo * cantidad` (NC en negativo). | `comprobante_item.precio_costo` |
| `margen` | `importe_venta - costo_total`. | Derivado |
| `margen_pct` | `margen / importe_venta` si importe ≠ 0. | Derivado |
| `participacion_pct` | Participación del artículo sobre el total de `importe_venta` del resultado. | Derivado |
| `tickets` | Cantidad de **comprobantes distintos** que aportaron líneas a ese producto. | `comprobante.id` (set) |
| `stock_actual` / `stock_minimo` | Snapshot actual del maestro producto. | `producto` |
| `quiebre` | `stock_minimo > 0` y `stock_actual <= stock_minimo`. | Derivado |
| `fecha_vencimiento` | Fecha **maestra** en `producto`: alertas y reportes usan este valor. Con lotes activos suele coincidir con el **vencimiento más próximo** entre `producto_lote_ingreso` donde `cantidad` > 0 (vía trigger), no hay una fila por lote en el reporte actual. | `producto.fecha_vencimiento` |
| `dias_hasta_vencimiento` / `estado_vencimiento` | Días hasta vencimiento y etiqueta (vencido / ≤7 / ≤30 / ok / sin fecha). | Derivado |
| `ultima_entrada` | Último movimiento de **`movimiento`** con `tipo = entrada` para ese `producto_id`. | `movimiento` |

### Límites y precisiones (importante para soporte)

1. **Varios lotes por producto (`producto_lote_ingreso`):** existe ingreso por partida con cantidad y vencimiento; el reporte igualmente expone **`producto.fecha_vencimiento`** (próximo vencimiento sintetizado cuando el trigger aplica). **No** muestra segundo vencimiento ni FEFO. Las **salidas por venta** no rebajan cantidad del lote: ver `docs/stock.md`.
2. **Última entrada** es la última **entrada de stock** registrada (manual, importación, alta inicial, etc.); **no** equivale automáticamente a “última factura de compra” si ese flujo no existe o no deja movimiento.
3. El listado ordena por **importe de venta** descendente y aplica `limit` (por defecto 200, máximo 500 en API) solo a la cantidad de productos mostrados. Los totales del encabezado se calculan con todas las lineas del rango.
4. Filtros `categoria_id` y `proveedor_id` se aplican sobre el producto asociado a la línea.

### Export CSV

`GET /api/reportes/ventas-articulo?...&export=csv` devuelve las mismas columnas visibles en la tabla ampliadas para análisis en Excel.

### PDF en pantallas de reportes

El botón **Descargar PDF** genera un archivo **.pdf** con **jsPDF** (vectorial): título con acento, bloque de metadatos, tabla con cabecera oscura, bordes y filas alternadas (cebra). Los resumenes KPI usan tabla de dos columnas (etiqueta | valor). No usa impresión del navegador ni captura de pantalla.

---

## Ventas POS — tickets (`/reportes/ventas-consumidor`)

- Datos desde **`comprobante`** con `tipo = ticket`, `estado = emitido`.
- **No** usa `comprobante_item`: por eso el nombre en UI es **Ventas POS (tickets)**.
- Para análisis por SKU usar siempre **`/reportes/ventas-articulo`**.

---

## Próxima evolución (fuera del comportamiento actual)

- **Consumo de lote en ventas (FEFO / trazabilidad en salidas):** hoy **`producto_lote_ingreso`** registra ingresos; falta opcionalmente descontar `cantidad` al facturar o en ajustes, y reportes que listen **columnas por lote** o exposición FIFO.
