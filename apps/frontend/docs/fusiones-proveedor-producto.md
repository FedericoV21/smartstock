---
estado: activo
ultima_actualizacion: 2026-05-06
---

# Fusión de proveedores y productos

Esta guía describe **cómo unificar registros duplicados** en la aplicación (UI), qué valida el backend y qué hace la base de datos. Sirve para soporte, implementación y operación.

Ambas operaciones son **irreversibles** salvo restauración manual desde backup. Siempre conviene usar primero la **simulación** (`dry_run`).

---

## Permisos y módulo

- Las rutas API están protegidas con `moduloGuard('stock')`: el tenant debe tener el módulo **Stock** habilitado.
- **Proveedores**: además se exige permiso de edición de proveedores (`rejectUnlessProveedorEdicion` en `src/app/api/proveedores/fusionar/route.ts`). Los usuarios con rol **visor** no pueden fusionar.
- **Productos**: la ruta de productos no usa el mismo helper de proveedor, pero exige sesión válida y no visor; revisar RBAC en [permisos-usuario-y-rbac.md](./permisos-usuario-y-rbac.md) si se agregan restricciones finas.

---

## Fusión de proveedores

### Objetivo

Cuando el mismo proveedor se cargó dos veces (nombre o CUIT distintos), se elige un **proveedor que queda** (superviviente) y uno o más **proveedores a absorber** (se eliminan). Todo el historial repuntado al superviviente queda en un solo lugar: productos, compras, pagos, cuenta corriente, listas, importaciones, etc.

### Cómo hacerlo en la UI

1. Ir al detalle del proveedor **que querés conservar**.
2. Al final de la página, abrir el desplegable **Unificar con otro proveedor**.
3. Elegir en el desplegable el proveedor duplicado (**se elimina**).
4. Pulsar **Simular impacto**: se muestran conteos y saldos de cuenta a consolidar.
5. Si los números cierran, **Fusionar ahora** y confirmar el diálogo.

Componente: `src/components/proveedores/fusionar-proveedor-en-destino.tsx`. La lista de candidatos sale de `GET /api/proveedores?estado=todos` (excluye al actual).

### API

`POST /api/proveedores/fusionar`

Cuerpo JSON:

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `survivor_id` | UUID | Proveedor que permanece (el de la pantalla). |
| `loser_ids` | UUID[] | Uno o más proveedores a fusionar y borrar. |
| `dry_run` | boolean | `true`: solo simulación; `false`: ejecuta la fusión. |

La API llama al RPC `fusionar_proveedores` (ver migración `132_fusionar_proveedores.sql`).

### Respuesta simulación (`dry_run: true`)

Incluye entre otros:

- `counts`: filas afectadas por tipo (productos con ese `proveedor_id`, `producto_proveedor`, listas, comprobantes, movimientos, lotes, pagos, obligaciones `pago_proveedor_factura`, etc.).
- `producto_proveedor_duplicate_junction_removed`: vínculos catálogo–proveedor del perdedor que se descartarían porque ya existe el mismo producto vinculado al superviviente.
- `cuentas_corriente`: filas de `cuenta_corriente` de los perdedores con `proveedor_id`, `cuenta_id` y `saldo` (la ejecución consolida saldos en la cuenta del superviviente o repunta la cuenta del perdedor).

### Qué hace la base de datos al ejecutar

Orden conceptual (todo en una transacción, con *advisory lock* por tenant + superviviente):

1. **Cuenta corriente**: si el superviviente ya tiene cuenta, se suma el saldo del perdedor, se repuntan `pago.cuenta_id` y se borra la cuenta del perdedor; si no, se reasigna `proveedor_id` de la cuenta del perdedor al superviviente.
2. **Deduplicación** en `producto_proveedor`: se borran filas del perdedor que duplican par `(tenant, producto_id)` ya presente para el superviviente.
3. **UPDATE** de `proveedor_id` al superviviente en: `producto_proveedor`, `producto`, `lista_precios`, `comprobante`, `importacion_log`, `lector_factura_log`, `movimiento`, `producto_lote_ingreso`, `pago`, `pago_proveedor_factura`, `whatsapp_branch_rule`.
4. **DELETE** de filas de `proveedor` para cada perdedor.

---

## Fusión de productos

### Objetivo

Unificar dos fichas de producto que representan el mismo artículo en el **mismo depósito (sucursal)** y con el **mismo proveedor** y **misma unidad**. El stock del depósito común **se suma**. El resto de FKs (movimientos, ítems de comprobante, pedidos, listas, historial de precios, promociones, etc.) se repuntan al producto superviviente; el producto perdedor se elimina.

### Restricciones (RPC)

Si no se cumplen, el RPC responde con error:

- Mismo `tenant_id`, **un solo** `loser_id` en el array.
- Mismo `proveedor_id` y mismo `sucursal_id` entre superviviente y perdedor.
- Misma `unidad` de medida.
- Tras aplicar las preferencias de campos: **unicidad** de PLU (tenant, activos) y de código de barras (mismo depósito y proveedor); si hay conflicto, en `dry_run` aparece `unicidad_problemas`; en ejecución sin `dry_run` falla con excepción.
- Si el PLU final no es nulo, `es_pesable` debe ser verdadero.

### Cómo hacerlo en la UI

1. Abrir el detalle del producto **que querés conservar**.
2. Desplegar **Unificar con otro producto** (al final de la ficha).
3. Buscar el producto duplicado (mismo proveedor, mismo depósito, misma unidad).
4. Elegir por campo si quedan valores del **destino** o del **duplicado** (y opciones especiales para stock mínimo y precio por sucursal).
5. Simular y revisar `preview_maestro`, conteos y `unicidad_problemas`.
6. Fusionar si no hay bloqueos.

Componente: `src/components/productos/fusionar-producto-en-destino.tsx`.

### API

`POST /api/productos/fusionar`

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `survivor_id` | UUID | Producto que permanece. |
| `loser_ids` | UUID[] | **Exactamente un** UUID (semántica v1 del RPC). |
| `dry_run` | boolean | Simulación vs ejecución. |
| `campos` | object | Preferencias campo a campo (opcional; se completan con defaults). |

Los nombres de claves y valores válidos se normalizan en `src/lib/productos/fusionar-producto-campos.ts` (`buildFusionarProductoCamposPayload`).

**Campos `survivor` | `loser`:** precios, código, código de barras, nombre, descripción, rubro, subrubro, ubicación, imagen, PLU, pesable, IVA, % ganancia, presentación de compra (`unidad_compra` + `contenido_unidad_compra`), fecha de vencimiento.

**`stock_minimo`:** `survivor` | `loser` | `max` (default `max`).

**`precio_sucursal_override`:** `survivor` | `loser` | `merge` (default `merge`: combina costo/venta por sucursal con COALESCE sobre la fila del depósito común).

La API invoca `fusionar_productos` (migración `133_fusionar_productos.sql`).

### Respuesta simulación (`dry_run: true`)

- `preview_maestro`: valores que quedarían en el maestro tras aplicar preferencias.
- `unicidad_problemas`: lista de conflictos (`plu`, `codigo_barras`, etc.) si los hay.
- `counts`: filas a repuntar por tabla relacionada (movimientos, ítems de comprobante, pedidos, ítems de lista, historial, lotes, promociones, tramos de ganancia, `producto_proveedor`, etc.).

### Notas técnicas

- Antes de borrar el perdedor se eliminan duplicados en `producto_promocion`, `promocion_combo_item` y `producto_ganancia_tramo` que chocarían con claves únicas del superviviente.
- Se usa `set_config('app.suppress_stock_sync', ...)` para evitar efectos colaterales de triggers de stock durante la operación; luego se recalcula stock en el producto superviviente.

---

## Orden recomendado ante duplicados “en cadena”

Si tenés el mismo proveedor cargado dos veces y además productos duplicados en cada ficha:

1. **Fusionar proveedores** primero (elegí como superviviente la ficha con la que querés trabajar a futuro).
2. Luego, en el catálogo consolidado, **fusionar productos** donde aún queden duplicados en el mismo depósito.

La fusión de proveedores ya deduplica `producto_proveedor` cuando el mismo producto estaba vinculado a ambos; puede evitar pasos manuales posteriores en ese vínculo.

---

## Referencias en código

| Pieza | Ubicación |
| --- | --- |
| RPC proveedores | `supabase/migrations/132_fusionar_proveedores.sql` |
| RPC productos | `supabase/migrations/133_fusionar_productos.sql` |
| API proveedores | `src/app/api/proveedores/fusionar/route.ts` |
| API productos | `src/app/api/productos/fusionar/route.ts` |
| Preferencias JSON producto | `src/lib/productos/fusionar-producto-campos.ts` |

Para el modelo de datos general: [base-de-datos.md](./base-de-datos.md).
