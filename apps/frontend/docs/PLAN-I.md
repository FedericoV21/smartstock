---
estado: 🔴 Pendiente
version: v8.0
ultima_actualizacion: 2026-04-21
---

# Nexus — Plan Bloque Promociones (v8.0)

## 0. Contexto y estado del sistema

Este plan arranca sobre una plataforma con los bloques A–G cerrados (v1.0 → v7.0): facturación simple, ARCA, analizador, POS con escáner (con la corrección posterior de la migración `047` que permite la misma barra entre distintos proveedores), cobranza por factura, y lector de facturas con IA. El próximo incremento es un motor de **promociones sobre productos** que alimente al POS y al facturador tradicional.

La versión objetivo es **v8.0** y el prefijo de tickets es `V80-PROMO-XXX`. Migraciones nuevas: a partir de `048`.

---

## 1. Decisiones clave a tomar antes de arrancar

Antes de meterme en la arquitectura, hay tres definiciones que conviene cerrar porque cambian completamente el alcance. Son más de negocio que técnicas.

### (a) Scope de promociones en v1 ¿cuáles tipos soportar?

Las promos del mundo real caen en familias bien distintas, y cada una tiene complejidad diferente:

- **Descuento porcentual directo** — "20% off en este producto". Trivial, es casi un campo `precio_promo` con vigencia.
- **N×M sobre el mismo producto** — "2x1", "3x2", "4x3". Agrupa unidades del mismo SKU, calcula cuántas pagás.
- **% en unidad N del mismo producto** — "30% en la segunda unidad", "50% en la tercera". Descuento progresivo por unidad.
- **Descuento por volumen** — "llevando 3 o más, 15% off". Umbral mínimo de cantidad.
- **Combos / cross-product** — "llevando shampoo + acondicionador, 25% off". Múltiples SKUs.
- **Descuento por categoría** — "20% off en toda la categoría bebidas". Aplica a muchos SKUs.

Mi recomendación fuerte es arrancar con los primeros cuatro (todas promos *sobre un mismo producto*) y dejar combos y por-categoría para una v2. Los combos duplican la complejidad del motor de cálculo, y el caso "2x1 / 30% segunda unidad / % off" cubre el 90% de lo que pide un almacén o kiosco argentino.

### (b) ¿La promo afecta el precio por unidad o el total de la línea?

Esto es crítico para la contabilidad fiscal. Dos caminos:

- **Precio unitario modificado**: recalculás `precio_unitario` por item y el IVA queda coherente. Fiscalmente más limpio. Pero pierde visibilidad del precio "original" en la factura.
- **Línea extra de descuento**: mantenés precio unitario y agregás un item negativo o un campo `descuento_promo` en el item. Más auditable, pero complica el PDF y la integración ARCA.

Viendo cómo el sistema ya maneja `aplicarFinanciacion` (ajuste sobre el total con tratamiento ARCA via tributo 99 / escalado IVA), el camino coherente es **modificar el precio unitario efectivo del item** y guardar el `precio_unitario_original` como dato informativo. El subtotal del item ya queda correcto, el IVA se calcula sobre el neto promocionado, y el ticket muestra la promo aplicada como línea informativa debajo.

### (c) ¿Stackean con descuentos manuales / financiación / cuenta corriente?

El POS hoy ya permite un **descuento/recargo sobre subtotal** aplicado en pantalla pero **no enviado al backend** (ver `facturacion.md` sección "Comprobante emitido"). Las promos de producto se aplican **antes** que ese ajuste. El orden final queda:

1. Promo de producto (modifica precio unitario efectivo del item) →
2. Subtotal + IVA (`calcularImportes` actual) →
3. Descuento/recargo global manual del POS (cuando se modele en backend) →
4. Ajuste por medio de pago / financiación (`aplicarFinanciacion` / `aplicarFinanciacionMixto`).

Las promos son "de catálogo" y se aplican primero. El descuento manual y la financiación son sobre el total ya promocionado. Esto evita el lío de descuentos sobre descuentos y es lo que espera el comerciante intuitivamente.

### (d) Interacción con la dualidad producto + proveedor (migración `047`)

Este es un punto nuevo respecto al primer borrador y es importante. Hoy el catálogo permite que dos productos activos del mismo tenant compartan `codigo_barras` si difieren en `proveedor_id`. Cuando definimos a qué producto se vincula una promo, estamos hablando del **registro de producto concreto** (una fila en `producto`), no del código de barras. Dos implicaciones:

- La promo se asocia a `producto_id`, no a `codigo_barras`. Si el tenant tiene dos filas con la misma barra (distintos proveedores), cada una puede tener su propia promo o ninguna.
- En el POS, cuando el escaneo devuelve **409 ambiguo** y el operador elige una fila del modal, la promo que se evalúa es la de la fila elegida. Si la fila no elegida tenía promo y la elegida no, no aplica. Esto se documenta explícitamente.

---

## 2. Modelo de datos

Dos tablas nuevas y columnas adicionales en `comprobante_item` y `pedido_item`.

### 2.1. Tabla `promocion`

Promociones activas por tenant, con vigencia temporal y tipo.

```
promocion
  id                UUID PK
  tenant_id         UUID FK → tenant (RLS)
  nombre            TEXT            -- "2x1 en gaseosas", uso interno y ticket
  tipo              promocion_tipo  -- ENUM, ver abajo
  -- parámetros según tipo (nullable según tipo):
  cantidad_lleva    INT             -- para Nx1: lleva 2
  cantidad_paga     INT             -- para Nx1: paga 1
  unidad_descuento  INT             -- para "% en unidad N": 2 (segunda), 3 (tercera)
  porcentaje        NUMERIC(5,2)    -- para % off y % en unidad N
  cantidad_minima   INT             -- para descuento por volumen: 3
  -- vigencia:
  vigente_desde     DATE NULL       -- NULL = sin restricción
  vigente_hasta     DATE NULL       -- NULL = sin restricción
  dias_semana       INT[] NULL      -- [1..7], NULL = todos (útil para "martes de descuento")
  activa            BOOLEAN DEFAULT true
  created_at, updated_at
```

**ENUM `promocion_tipo`:**

- `porcentaje_off` — % sobre precio unitario
- `n_x_m` — lleva N paga M (2x1, 3x2, 4x3)
- `porcentaje_unidad_n` — % en unidad N y siguientes
- `descuento_volumen` — % si lleva ≥ cantidad_minima

**Constraints:**

- `chk_promo_nxm_valido` — si tipo = `n_x_m`, `cantidad_lleva > cantidad_paga > 0`
- `chk_promo_porcentaje_valido` — si tipo implica %, `porcentaje > 0 AND porcentaje <= 100`
- `chk_promo_vigencia` — `vigente_hasta IS NULL OR vigente_desde IS NULL OR vigente_hasta >= vigente_desde`
- `chk_promo_volumen_minimo` — si tipo = `descuento_volumen`, `cantidad_minima >= 2`

**Índices:**

- `idx_promocion_tenant`
- `idx_promocion_activa_vigente` — parcial `WHERE activa = true`, para la query caliente del POS

### 2.2. Tabla `producto_promocion`

Relación N:N. Una promo puede aplicar a varios productos (ej. "2x1 en todas las gaseosas") y un producto puede tener múltiples promos, aunque en v1 restringimos a una activa por vez.

```
producto_promocion
  promocion_id  UUID FK → promocion
  producto_id   UUID FK → producto
  tenant_id     UUID FK → tenant (denormalizado para RLS)
  created_at
  PRIMARY KEY (promocion_id, producto_id)
```

**Índices:**

- `idx_producto_promocion_producto` — para la búsqueda "dame las promos de este producto"
- `idx_producto_promocion_tenant`

Constraint a nivel de aplicación (no SQL en v1): **un producto solo puede tener una promoción activa y vigente simultáneamente**. Si intentás aplicar una segunda, la API devuelve 409 con la promo que ya está vinculada, y el frontend le pide al usuario si quiere reemplazar (desactiva la anterior y vincula la nueva) o cancelar. Esto simplifica la UI y el motor de cálculo enormemente.

Dado el modelo producto+proveedor: la relación es a `producto.id`, así que si un mismo código de barras existe en dos filas (dos proveedores), cada una tiene su propia vinculación independiente.

### 2.3. Extensiones en `comprobante_item` y `pedido_item`

Para dejar registro inmutable de la promo aplicada en cada venta (igual filosofía que `precio_costo`):

```
comprobante_item / pedido_item:
  + promocion_id              UUID NULL FK → promocion
  + promocion_descripcion     TEXT NULL            -- snapshot del nombre al momento de vender
  + precio_unitario_original  NUMERIC(12,2) NULL   -- precio sin promo
  + descuento_promo_monto     NUMERIC(12,2) NULL   -- ahorro total de esa línea
```

Mismo criterio que con `precio_costo`: se captura en el momento de emitir y no se recalcula nunca más. Si la promo cambia o se borra, los comprobantes históricos mantienen la información original.

---

## 3. Motor de cálculo — `aplicarPromociones`

Este es el corazón del feature y el punto donde más cuidado hay que poner. Nueva función en `src/lib/facturacion/promociones.ts`.

**Firma:**

```
aplicarPromociones(
  items: ItemInput[],            // los items del carrito
  promosPorProducto: Map<...>,   // promos vigentes por producto_id
  fecha: Date                    // fecha de emisión (valida vigencia)
): ItemConPromo[]
```

**Responsabilidades:**

1. Para cada item, busca si el producto tiene promo activa y vigente en la fecha.
2. Valida condiciones: `cantidad_minima`, `dias_semana`, rango de fechas.
3. Aplica el cálculo según el tipo:
   - `porcentaje_off`: `precio_unitario_efectivo = precio_unitario * (1 - porcentaje/100)` por cada unidad.
   - `n_x_m`: calcula cuántos "combos" entran en la cantidad, el resto va a precio lleno. Ej: cantidad = 5, 2x1 → 2 combos (4 unidades pagás 2) + 1 unidad suelta. Total a pagar = 3 unidades.
   - `porcentaje_unidad_n`: de las `cantidad` unidades, las que corresponden a la posición N y siguientes llevan %.
   - `descuento_volumen`: si `cantidad >= cantidad_minima`, aplica % a todas.
4. Calcula `precio_unitario_efectivo` promedio (total con promo / cantidad) para persistir un valor unitario coherente.
5. Retorna el item enriquecido con `promocion_id`, `promocion_descripcion`, `precio_unitario_original`, `precio_unitario_efectivo`, `descuento_promo_monto`.

**Punto crítico del N×M**: cuando cantidad no es múltiplo del combo, hay unidades a precio pleno + unidades del combo. El `precio_unitario_efectivo` es el promedio ponderado. Ejemplo: 5 unidades × $100 con 2x1. Pagás por 3 unidades = $300. Precio unitario efectivo = $60. Esto se persiste así y el subtotal cierra. La descripción en el ticket muestra la lógica real: "5 × $100 (2x1) = $300 — Ahorro $200".

**Casos borde a blindar con tests unitarios:**

- Cantidad = 0 o negativa → no aplicar promo, comportamiento normal.
- Cantidad decimal (productos pesables) + promo N×M → las promos N×M no aplican a pesables, solo a unitarios. Validar y retornar sin aplicar.
- Promo con `cantidad_minima` = 5 e item con cantidad = 4 → no aplica.
- Fecha fuera de vigencia → no aplica.
- Día de semana no incluido → no aplica.
- Promo aplicada a producto pesable con `porcentaje_off` → sí aplica (es sobre el precio, no depende de unidades enteras).
- Item con `precio_unitario` editado manualmente en el carrito → la promo aplica sobre ese precio editado, no sobre `producto.precio_venta`. Esto se documenta explícitamente.

---

## 4. Integración con el flujo existente

El motor vive entre el carrito y `calcularImportes`. Modificaciones mínimas en los endpoints existentes.

**En `POST /api/facturacion/emitir`:**

Entre el paso 5 (validar stock) y el paso 6 (`calcularImportes`), se inserta:

- Cargar promos vigentes de los productos del carrito (una sola query: `SELECT * FROM producto_promocion JOIN promocion WHERE producto_id IN (...) AND activa AND vigencia OK`).
- Llamar a `aplicarPromociones(items, promosMap, fecha)`.
- El resultado reemplaza los `items` que entran a `calcularImportes`. El `precio_unitario` que llega a `calcularImportes` es el efectivo (ya con promo aplicada).
- Al insertar en `comprobante_item`, se agregan las columnas nuevas (`promocion_id`, `promocion_descripcion`, `precio_unitario_original`, `descuento_promo_monto`).

**Importante:** el cliente (POS o /facturacion/nueva) **puede** precalcular promos para mostrar el total en tiempo real, pero el cálculo autoritativo es el del servidor. Si hay discrepancia entre lo que mostró el frontend y lo que calcula el backend (por ejemplo porque la promo venció entre que se abrió el POS y se cobró), gana el servidor. El response incluye el detalle de promos aplicadas para que el frontend muestre el ajuste si difiere.

**En el endpoint del pedido → factura**: misma lógica, promos se aplican al momento de facturar el pedido (no al crearlo), porque la vigencia corre en ese momento. Alternativamente, el pedido puede capturar la promo al momento de crearse y respetarla aunque venza antes de facturar — esto es una decisión de negocio que conviene confirmar (ver sección 8, punto 4).

**Interacción con `aplicarFinanciacion`**: no cambia nada. La financiación sigue siendo el último paso, aplicado sobre el total ya promocionado. El tratamiento ARCA (tributo 99 para recargo, escalado neto/IVA para descuento) funciona exactamente igual.

---

## 5. UI

### 5.1. Gestión de promociones — nueva sección

Página nueva: `/promociones`. Incluida en el sidebar dentro del grupo de Stock (el mismo módulo `stock`, no requiere flag nuevo en `modulo_config` en v1 — discutible, ver sección 8).

**Vistas:**

- **Listado** — tabla con nombre, tipo, vigencia, productos afectados (count), estado (activa/inactiva). Filtros por estado y tipo.
- **Crear/editar promoción** — formulario con:
  - Nombre
  - Tipo (dropdown) — UI se adapta según tipo: muestra solo los campos relevantes (si `n_x_m`, muestra "lleva" y "paga"; si `porcentaje_off`, muestra "porcentaje", etc.).
  - Vigencia (fechas desde/hasta opcionales, checkbox "siempre vigente")
  - Días de semana (chips multi-select, default "todos los días")
  - Selector de productos (multi-select con buscador, mismo componente que usa el analizador para seleccionar productos; muestra nombre + proveedor para desambiguar filas con misma barra)
  - Preview del efecto: "Sobre un producto de $1000, el cliente paga $800 (ahorra $200)"
- **Detalle** — listado de productos afectados + últimas 20 ventas donde se aplicó la promo (útil para ver si está funcionando).

### 5.2. Extensión en el detalle de producto

En `/productos/[id]`, agregar un bloque "Promociones activas" que muestra las promos vinculadas al producto con un link para editarlas o un botón "Asignar promoción" que abre el formulario prefiltrado al producto actual.

### 5.3. UI en el POS (`/facturacion/pos`)

Cuando se escanea un producto con promo activa:

- La línea del carrito muestra un **badge** al lado del nombre: `2x1`, `-20%`, etc.
- Debajo del subtotal de la línea, línea chica en verde: "Ahorro: $200".
- En el panel derecho de totales, fila nueva antes del subtotal: `Ahorro en promociones: $XXX`.
- La animación de highlight al agregar al carrito se mantiene, pero con un toast chico: "Promo aplicada: 2x1 en Coca-Cola 2.25L".
- El campo de descuento/recargo sobre subtotal que ya existe en el POS (ver `facturacion.md` sección "Carrito y totales") sigue funcionando igual, pero opera sobre el subtotal ya promocionado.

### 5.4. UI en `/facturacion/nueva`

Igual que el POS, más conservador: columna nueva en la tabla de items llamada "Promo" con el badge, y una fila de totales "Ahorro en promociones" antes del subtotal.

### 5.5. PDF y ticket

- **Ticket térmico del POS**: debajo de cada línea con promo, una sublínea chica: `  2x1 — Ahorro $200`. Al final, antes del total, una línea: `Ahorró en promociones: $XXX`.
- **PDF A4 de factura**: columna "Descripción" del item incluye la promo al lado del nombre del producto ("Coca-Cola 2.25L — 2x1"). Abajo del listado de items, antes del subtotal, línea: "Ahorro por promociones: $XXX". El IVA se calcula sobre el subtotal promocionado, igual que hoy.

Para ARCA: el precio unitario que va al WSFE es el `precio_unitario_efectivo`, y el importe de línea es el correcto. No hay tributo extra ni manejo especial, a diferencia de la financiación. Esto es porque las promos modifican la base imponible real (no son un recargo por medio), y ARCA lo acepta naturalmente.

---

## 6. Testing

**Unit tests** (`src/test/promociones.test.ts`), sin DB:

- Cada tipo de promo con múltiples cantidades (incluido el borde del no-múltiplo en N×M).
- Vigencia: antes, durante, después, sin rango.
- Días de semana: incluidos, no incluidos.
- `cantidad_minima`: justo, uno menos, uno más.
- Producto pesable con promo incompatible.
- Precio unitario editado manualmente en el carrito.

**Integration tests** (con Supabase client real):

- Crear promo, vincular a producto, emitir comprobante con ese producto, verificar que `comprobante_item` tiene las columnas promo pobladas.
- Emitir con promo vencida → el item sale a precio lleno.
- Promo activa pero desactivada manualmente → no aplica.
- Aislamiento multi-tenant: tenant A crea una promo, tenant B no la ve, no la puede aplicar.
- Flujo completo POS: escanear, ver promo aplicada, cobrar, verificar PDF y registro en DB.
- Dos filas de producto con misma barra y distinto proveedor: una con promo y otra sin, el operador elige desde el modal de ambigüedad y el motor aplica correctamente solo a la fila elegida.
- Pedido con promo → facturación del pedido: verificar que se persiste lo correcto según la política de "congelar al crear" vs "recalcular al facturar".
- Combinación con financiación: producto con 2x1 + pago con recargo efectivo −10% → total final correcto, PDF y ARCA alineados.

**Tests de regresión**: correr toda la batería actual de `calcular-importes.test.ts`, `financiacion.test.ts` y `financiacion-mixto.test.ts` para confirmar que sin promos nada cambia.

---

## 7. Tickets

Convención de numeración: `V80-PROMO-XXX`.

Las migraciones SQL arrancan en `048`. Las migraciones previas del proyecto llegan hasta `047`.

### Fase 1 — Fundacional (schema + motor, sin UI)

---

#### V80-PROMO-001 — Migración: ENUM promocion_tipo y tabla promocion

- Tipo: migration
- Módulo: promociones
- Prioridad: critical
- Estimación: 3
- Versión: v8.0
- Estado: todo
- Dependencias: —

**Descripción:** Crear el ENUM `promocion_tipo` con los valores `porcentaje_off`, `n_x_m`, `porcentaje_unidad_n`, `descuento_volumen`. Crear la tabla `promocion` con todos los campos del modelo, constraints de validación y RLS por tenant.

**Criterios de aceptación:**

- [ ] ENUM `promocion_tipo` creado con los 4 valores definidos
- [ ] Tabla `promocion` creada con columnas según sección 2.1 del plan
- [ ] Constraints `chk_promo_nxm_valido`, `chk_promo_porcentaje_valido`, `chk_promo_vigencia`, `chk_promo_volumen_minimo` aplicados
- [ ] Índices `idx_promocion_tenant` y `idx_promocion_activa_vigente` (parcial) creados
- [ ] RLS activado con policies de `tenant_isolation` (SELECT/INSERT/UPDATE/DELETE)
- [ ] Trigger `moddatetime` sobre `updated_at`

**Notas técnicas:** Archivo `supabase/migrations/048_promocion.sql`. Ver sección 2.1 del plan.

---

#### V80-PROMO-002 — Migración: tabla producto_promocion (N:N)

- Tipo: migration
- Módulo: promociones
- Prioridad: critical
- Estimación: 2
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-001

**Descripción:** Crear la tabla de relación N:N entre productos y promociones con PK compuesta, RLS y los índices necesarios para el lookup caliente del POS.

**Criterios de aceptación:**

- [ ] Tabla `producto_promocion` con PK compuesta `(promocion_id, producto_id)`
- [ ] `tenant_id` denormalizado en la tabla para usar en RLS
- [ ] FK `promocion_id → promocion(id)` con `ON DELETE CASCADE`
- [ ] FK `producto_id → producto(id)` con `ON DELETE CASCADE`
- [ ] Índices `idx_producto_promocion_producto` y `idx_producto_promocion_tenant`
- [ ] RLS con policies de `tenant_isolation`

**Notas técnicas:** Archivo `supabase/migrations/049_producto_promocion.sql`. La restricción "un producto → una sola promo activa" se valida en aplicación, no con constraint SQL (en v1).

---

#### V80-PROMO-003 — Migración: columnas promo en comprobante_item y pedido_item

- Tipo: migration
- Módulo: promociones
- Prioridad: critical
- Estimación: 3
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-001

**Descripción:** Agregar las columnas `promocion_id`, `promocion_descripcion`, `precio_unitario_original` y `descuento_promo_monto` a `comprobante_item` y `pedido_item` para persistir el snapshot de la promo aplicada en cada venta.

**Criterios de aceptación:**

- [ ] `comprobante_item`: columnas agregadas como nullable
- [ ] `pedido_item`: mismas columnas agregadas como nullable
- [ ] FK `promocion_id` con `ON DELETE SET NULL` (si se borra la promo, los comprobantes mantienen el snapshot pero pierden el link)
- [ ] Backfill no requerido: los comprobantes previos quedan con NULL en estas columnas y la UI los interpreta como "sin promo"
- [ ] La migración es aditiva y no rompe emisiones en curso

**Notas técnicas:** Archivo `supabase/migrations/050_comprobante_item_promocion.sql`. El `precio_unitario_original` es redundante con `precio_unitario` cuando no hay promo; por claridad se deja NULL en esos casos.

---

#### V80-PROMO-004 — Regenerar tipos TypeScript

- Tipo: infra
- Módulo: promociones
- Prioridad: critical
- Estimación: 1
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-001, V80-PROMO-002, V80-PROMO-003

**Descripción:** Regenerar los tipos de Supabase (`database.types.ts`) para reflejar las tablas nuevas y las columnas agregadas. Definir los tipos de dominio en `src/types/promociones.ts`.

**Criterios de aceptación:**

- [ ] `database.types.ts` regenerado con las 3 tablas nuevas/modificadas
- [ ] `src/types/promociones.ts` con interfaces `Promocion`, `ProductoPromocion`, `ItemConPromo`, `PromocionTipo`
- [ ] Labels en español para cada `PromocionTipo` (`PROMOCION_TIPO_LABELS`)
- [ ] El build de TypeScript pasa sin errores en todo el repo

**Notas técnicas:** Correr `npx supabase gen types typescript --linked`. Reemplaza el archivo de tipos existente.

---

#### V80-PROMO-005 — Motor de cálculo `aplicarPromociones` + tests unitarios

- Tipo: feature
- Módulo: promociones
- Prioridad: critical
- Estimación: 8
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-004

**Descripción:** Implementar la función pura `aplicarPromociones` en `src/lib/facturacion/promociones.ts` que recibe items, un mapa de promos por `producto_id` y la fecha, y devuelve los items enriquecidos con el cálculo aplicado. Sin DB, sin I/O: función 100% testeable.

**Criterios de aceptación:**

- [ ] `aplicarPromociones(items, promosPorProducto, fecha)` implementada en `src/lib/facturacion/promociones.ts`
- [ ] Maneja los 4 tipos de promo definidos (`porcentaje_off`, `n_x_m`, `porcentaje_unidad_n`, `descuento_volumen`)
- [ ] Retorna items con `precio_unitario_original`, `precio_unitario_efectivo`, `promocion_id`, `promocion_descripcion`, `descuento_promo_monto`
- [ ] Validación de vigencia (fecha dentro del rango, día de semana incluido)
- [ ] `n_x_m` sobre productos pesables → no aplica (retorna sin promo)
- [ ] Redondeo a 2 decimales, consistente con `calcularImportes`
- [ ] Tests unitarios (`src/test/promociones.test.ts`) con al menos 20 casos: cada tipo × varios bordes (sección 6 del plan)
- [ ] Coverage del motor > 95%

**Notas técnicas:** Función pura, sin dependencia de Supabase. El input y output son objetos TypeScript. Usar la misma convención de redondeo que `calcularImportes` (`Math.round(x * 100) / 100`).

---

### Fase 2 — Backend de gestión

---

#### V80-PROMO-006 — API `GET/POST /api/promociones`

- Tipo: feature
- Módulo: promociones
- Prioridad: high
- Estimación: 5
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-004, V80-PROMO-005

**Descripción:** Implementar el listado y la creación de promociones con sus vinculaciones de productos, con guard de módulo `stock`, guard de rol (visor no puede crear), y validaciones de negocio.

**Criterios de aceptación:**

- [ ] `GET /api/promociones?activa=...&tipo=...` lista promos del tenant con filtros opcionales y count de productos vinculados
- [ ] `POST /api/promociones` recibe body con datos de la promo + array `producto_ids`
- [ ] Validación: campos obligatorios según `tipo` (si `n_x_m`, requiere `cantidad_lleva` y `cantidad_paga`; etc.)
- [ ] Validación: vigencia (fechas coherentes, días de semana válidos entre 1 y 7)
- [ ] Si alguno de los `producto_ids` ya tiene otra promo activa y vigente, responde 409 con `{ conflictos: [{ producto_id, promocion_existente }] }`
- [ ] Crea registro en `promocion` + bulk insert en `producto_promocion` en una transacción
- [ ] Guard `moduloGuard('stock')` y rechazo a rol `visor`
- [ ] RLS garantiza aislamiento multi-tenant

**Notas técnicas:** Archivos `src/app/api/promociones/route.ts`. Reutilizar `createServerClient`. El conflicto 409 permite al frontend preguntar "¿reemplazar promo anterior?" — el reemplazo se hace con un segundo POST con flag `reemplazar: true`.

---

#### V80-PROMO-007 — API `GET/PUT/DELETE /api/promociones/[id]`

- Tipo: feature
- Módulo: promociones
- Prioridad: high
- Estimación: 5
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-006

**Descripción:** Implementar el detalle, actualización y eliminación (soft delete vía `activa = false`) de una promo existente, con las mismas validaciones que el POST.

**Criterios de aceptación:**

- [ ] `GET /api/promociones/[id]` devuelve la promo + productos vinculados + últimas 20 ventas donde se aplicó
- [ ] `PUT /api/promociones/[id]` actualiza datos de la promo y la lista de productos vinculados (reconcilia altas/bajas en `producto_promocion`)
- [ ] `DELETE /api/promociones/[id]` hace soft delete: `UPDATE promocion SET activa = false`, mantiene los registros para trazabilidad histórica
- [ ] Al actualizar la lista de productos, si se agrega uno con otra promo activa, responde 409 igual que el POST
- [ ] Guard de módulo y rol
- [ ] Las ventas previas conservan `promocion_id` aunque la promo esté desactivada (porque `ON DELETE SET NULL` solo dispara en hard delete)

**Notas técnicas:** Archivo `src/app/api/promociones/[id]/route.ts`. El GET incluye una query agregada sobre `comprobante_item` para traer las últimas ventas.

---

#### V80-PROMO-008 — Integración en `POST /api/facturacion/emitir`

- Tipo: feature
- Módulo: facturacion
- Prioridad: critical
- Estimación: 5
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-005

**Descripción:** Integrar `aplicarPromociones` en el endpoint de emisión. Entre la validación de stock y el cálculo de importes, cargar las promos vigentes y aplicarlas. Persistir el snapshot en `comprobante_item`. El response incluye el detalle de promos aplicadas.

**Criterios de aceptación:**

- [ ] Nueva query: `SELECT` de promos vigentes para los productos del carrito en una sola llamada
- [ ] `aplicarPromociones` se llama con la fecha del comprobante (no `new Date()` si el body tiene fecha distinta)
- [ ] Los items enriquecidos reemplazan a los originales antes de `calcularImportes`
- [ ] El insert en `comprobante_item` incluye las 4 columnas nuevas (`promocion_id`, `promocion_descripcion`, `precio_unitario_original`, `descuento_promo_monto`)
- [ ] El response del endpoint incluye `promociones_aplicadas: [{ producto_id, promocion_id, promocion_descripcion, ahorro }]` para que el cliente pueda mostrar un resumen
- [ ] El total en el response puede diferir del total calculado en el cliente si las promos cambiaron — el cliente reconcilia
- [ ] Los movimientos de stock siguen usando `cantidad` (no se descuenta "menos stock" por 2x1; el stock efectivo son todas las unidades que se llevó el cliente)
- [ ] Tests de regresión: emitir sin promos devuelve exactamente el mismo resultado que antes

**Notas técnicas:** Punto delicado: el `subtotal` de `comprobante_item` se persiste como `cantidad * precio_unitario_efectivo` (consistente con `calcularImportes`), pero `precio_unitario_original` queda disponible para reportes. El stock se sigue descontando por la cantidad total (las 5 unidades del 2x1, no 3).

---

#### V80-PROMO-009 — Integración en pedido → factura

- Tipo: feature
- Módulo: pedidos
- Prioridad: high
- Estimación: 3
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-008

**Descripción:** Decidir y aplicar la política de promos en pedidos: al crear un pedido, capturar la promo vigente; al facturar el pedido, usar la promo capturada (no recalcular con las vigentes a la fecha de factura). Es la política "congelar al crear" (ver sección 8 punto 4).

**Criterios de aceptación:**

- [ ] `POST /api/pedidos` llama a `aplicarPromociones` con la fecha del pedido y persiste las 4 columnas en `pedido_item`
- [ ] Al facturar un pedido desde `POST /api/pedidos/[id]/facturar`, los items del pedido se copian al comprobante conservando las columnas promo (no se recalcula)
- [ ] Si durante la vida del pedido (borrador/confirmado) se editan items, se recalcula la promo al guardar
- [ ] Si la promo se borra o desactiva entre creación del pedido y facturación, el `promocion_id` queda pero funciona como snapshot histórico
- [ ] Esta política se documenta en `pedidos.md`

**Notas técnicas:** Alternativa (no elegida en v1): recalcular al facturar. Se deja documentada como decisión consciente. Si el negocio lo requiere después, se agrega un flag en la promo `bloqueada_al_crear_pedido: boolean`.

---

#### V80-PROMO-010 — Tests de integración del backend

- Tipo: test
- Módulo: promociones
- Prioridad: high
- Estimación: 5
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-008, V80-PROMO-009

**Descripción:** Suite de tests de integración que cubren los flujos backend críticos: crear promo, vincular a producto, emitir, verificar DB; emitir con promo vencida; aislamiento multi-tenant; interacción con `producto` duplicado por proveedor; interacción con financiación.

**Criterios de aceptación:**

- [ ] Test: crear promo + emitir + verificar que `comprobante_item` tiene las 4 columnas pobladas
- [ ] Test: emitir con promo vencida → el item sale a precio lleno, las columnas promo quedan NULL
- [ ] Test: promo desactivada manualmente → no aplica al emitir
- [ ] Test: aislamiento multi-tenant — tenant A no ve ni aplica promos de tenant B
- [ ] Test: dos filas de producto con misma barra y distinto proveedor, una con promo, el POS elige la fila correcta del modal 409
- [ ] Test: pedido con promo capturada → facturación mantiene el snapshot aunque la promo se borre
- [ ] Test: emisión con promo 2x1 + pago mixto con atajo efectivo −10% → total final correcto, `aplicarFinanciacionMixto` recibe el total promocionado
- [ ] Todos los tests usan Supabase client real, corriendo contra el proyecto de dev o el local

**Notas técnicas:** Seguir el estilo de `src/test/financiacion-mixto.test.ts`. Usar fixtures de tenants/productos/promos que se limpien al final de cada test.

---

### Fase 3 — UI de gestión

---

#### V80-PROMO-011 — Página `/promociones`: listado

- Tipo: feature
- Módulo: promociones
- Prioridad: high
- Estimación: 5
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-006

**Descripción:** Crear la ruta `/promociones` con la tabla de promos, filtros, acciones rápidas (desactivar/activar) y link al detalle.

**Criterios de aceptación:**

- [ ] Ruta `/promociones` protegida con guard de módulo `stock`
- [ ] Tabla: columnas Nombre, Tipo (badge), Vigencia (desde–hasta), Productos afectados (count), Estado (activa/inactiva), Acciones
- [ ] Filtros: estado (todas/activas/inactivas), tipo
- [ ] Botón "Nueva promoción" → abre formulario en `/promociones/nueva`
- [ ] Acción rápida por fila: toggle activa/inactiva (llama a PUT)
- [ ] Link a detalle: `/promociones/[id]`
- [ ] Empty state cuando no hay promos: card con CTA "Creá tu primera promoción"
- [ ] Sidebar suma el link "Promociones" dentro del grupo Stock

**Notas técnicas:** Archivo `src/app/(dashboard)/promociones/page.tsx`. Usa los componentes de tabla existentes del proyecto (estilo `/productos`).

---

#### V80-PROMO-012 — Página `/promociones/nueva` y `/promociones/[id]/editar`

- Tipo: feature
- Módulo: promociones
- Prioridad: high
- Estimación: 8
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-011, V80-PROMO-007

**Descripción:** Formulario de alta y edición de promoción. Layout adaptativo según el tipo de promo elegido. Selector de productos multi-select con buscador. Preview en vivo del efecto de la promo sobre un precio de ejemplo.

**Criterios de aceptación:**

- [ ] Campo Nombre (obligatorio, 3–100 caracteres)
- [ ] Dropdown Tipo — al cambiar, se muestran/ocultan los campos específicos del tipo
- [ ] Para `n_x_m`: inputs "Lleva" y "Paga" (enteros positivos, lleva > paga)
- [ ] Para `porcentaje_off` y `descuento_volumen`: input "Porcentaje" (0–100, hasta 2 decimales)
- [ ] Para `porcentaje_unidad_n`: inputs "Unidad desde" (entero ≥ 2) y "Porcentaje"
- [ ] Para `descuento_volumen`: input "Cantidad mínima" (entero ≥ 2)
- [ ] Vigencia: fechas desde/hasta con checkbox "siempre vigente" que deshabilita los dates
- [ ] Días de semana: 7 chips (Lun–Dom) toggleables, default "todos los días"
- [ ] Selector de productos: autocomplete con buscador por nombre/código/barra, muestra `nombre + proveedor` para desambiguar filas con misma barra
- [ ] Preview en vivo: "Sobre un producto de $1000, con 5 unidades, el cliente paga $X y ahorra $Y"
- [ ] Al guardar, si la API responde 409 (conflicto con otra promo), modal de confirmación "Ya tiene la promo X vinculada, ¿reemplazar?"
- [ ] Edición carga los valores actuales y la lista de productos vinculados
- [ ] Toast de éxito al guardar, redirect a `/promociones`

**Notas técnicas:** Archivos `src/app/(dashboard)/promociones/nueva/page.tsx` y `src/app/(dashboard)/promociones/[id]/editar/page.tsx`. El selector de productos puede reutilizar un componente existente (hay uno similar en el analizador para el flujo de vinculación manual).

---

#### V80-PROMO-013 — Página `/promociones/[id]` detalle

- Tipo: feature
- Módulo: promociones
- Prioridad: medium
- Estimación: 5
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-011

**Descripción:** Pantalla de detalle de una promo: resumen de la configuración, lista de productos afectados y últimas ventas donde se aplicó.

**Criterios de aceptación:**

- [ ] Card superior con resumen de la promo (tipo, parámetros, vigencia, estado) + botones Editar / Desactivar / Eliminar
- [ ] Sección "Productos afectados": tabla con nombre, proveedor, precio de venta, precio con promo, acción quitar
- [ ] Sección "Últimas ventas": tabla con fecha, comprobante, cantidad, ahorro aplicado, link al comprobante
- [ ] Métricas rápidas arriba: total de veces aplicada, monto total ahorrado, productos únicos con venta
- [ ] Empty state si todavía no se aplicó

**Notas técnicas:** Archivo `src/app/(dashboard)/promociones/[id]/page.tsx`. Las métricas se calculan en el server component con una query agregada.

---

#### V80-PROMO-014 — Bloque "Promociones" en detalle de producto

- Tipo: feature
- Módulo: stock
- Prioridad: medium
- Estimación: 3
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-007

**Descripción:** En `/productos/[id]`, agregar una sección que muestre las promos vinculadas al producto con opciones para editarlas, quitarlas del producto o asignar una nueva.

**Criterios de aceptación:**

- [ ] Sección "Promociones" visible en `/productos/[id]`
- [ ] Lista de promos vinculadas con badge del tipo y link al detalle
- [ ] Botón "Asignar promoción" → abre selector con las promos del tenant o link a crear una nueva prefiltrada al producto actual
- [ ] Botón quitar por cada promo (llama a PUT de la promo removiendo el producto de su lista)
- [ ] Si el producto comparte código de barras con otra fila (distinto proveedor), mostrar info: "Esta es la fila del proveedor X, la promo solo se aplica a esta"

**Notas técnicas:** Archivo afectado: `src/app/(dashboard)/productos/[id]/page.tsx`. Reusa el selector del ticket V80-PROMO-012.

---

### Fase 4 — UI en facturación y POS

---

#### V80-PROMO-015 — Badges y cálculo en UI del POS

- Tipo: feature
- Módulo: pos
- Prioridad: critical
- Estimación: 8
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-005, V80-PROMO-008

**Descripción:** Extender la pantalla POS para mostrar promos aplicadas en el carrito: badges por línea, monto ahorrado por línea y total, reconciliación con el cálculo del servidor al emitir.

**Criterios de aceptación:**

- [ ] Al agregar un producto al carrito, se consulta el endpoint de promos (batched) y se aplica `aplicarPromociones` en el cliente para feedback inmediato
- [ ] Cada línea del carrito con promo muestra un badge (`2x1`, `-20%`, `3º al 50%`, `+3 unid 15%`)
- [ ] Subtítulo verde bajo la línea: "Ahorro: $XXX"
- [ ] Panel derecho: fila "Ahorro en promociones" antes del subtotal, con monto total
- [ ] Toast al agregar: "Promo aplicada: [nombre de la promo]"
- [ ] Al cobrar, si el servidor devuelve `promociones_aplicadas` distinto del cálculo del cliente (ej. promo venció), se muestra aviso y se actualizan los totales antes de confirmar
- [ ] El campo de descuento/recargo sobre subtotal sigue funcionando, opera sobre el subtotal ya promocionado

**Notas técnicas:** Archivos `src/components/pos/carrito.tsx`, `src/components/pos/resumen.tsx`. Nuevo hook `usePromociones(productosIds)` que cachea las promos vigentes por sesión de POS.

---

#### V80-PROMO-016 — UI en `/facturacion/nueva`

- Tipo: feature
- Módulo: facturacion
- Prioridad: high
- Estimación: 5
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-015

**Descripción:** Extender el formulario de emisión tradicional (`EmitirComprobante`) para mostrar promos aplicadas con badge por línea y fila de ahorro total.

**Criterios de aceptación:**

- [ ] Columna "Promo" en la tabla de items con badge si aplica
- [ ] Tooltip sobre el badge con el detalle de la promo
- [ ] Fila "Ahorro por promociones" en los totales, antes del subtotal
- [ ] Si el usuario edita manualmente el precio unitario, la promo se recalcula sobre el precio editado (comportamiento documentado en sección 3)
- [ ] Al emitir, reconciliación con el servidor igual que el POS

**Notas técnicas:** Archivo afectado: `src/components/facturacion/emitir-comprobante.tsx`.

---

#### V80-PROMO-017 — PDF A4 de factura con promociones

- Tipo: feature
- Módulo: facturacion
- Prioridad: high
- Estimación: 5
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-008

**Descripción:** Extender el generador de PDF (`pdf-generator.ts`) para incluir la información de promociones en cada item y el total ahorrado al final.

**Criterios de aceptación:**

- [ ] En la columna "Descripción", si el item tiene promo, aparece el nombre + sufijo (ej. "Coca-Cola 2.25L — 2x1")
- [ ] Bajo el listado de items, antes del subtotal, línea "Ahorro por promociones: $XXX" si hubo promos
- [ ] El precio unitario impreso es `precio_unitario_original` con una anotación pequeña "(c/promo: $XXX)" cuando hay descuento
- [ ] IVA y total quedan calculados sobre el precio efectivo (sin cambios respecto a hoy, solo cambia lo que se muestra)
- [ ] Los comprobantes antiguos (sin columnas promo) siguen renderizando igual que siempre

**Notas técnicas:** Archivo afectado: `src/lib/facturacion/pdf-generator.ts`. Agregar un parámetro opcional `items_con_promo: ItemPromo[]` que por default es empty.

---

#### V80-PROMO-018 — Ticket térmico del POS con promociones

- Tipo: feature
- Módulo: pos
- Prioridad: high
- Estimación: 3
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-008

**Descripción:** Extender el template del ticket térmico para mostrar la información de promos bajo cada línea y el total ahorrado antes del total final.

**Criterios de aceptación:**

- [ ] Debajo de cada línea con promo, sublínea indentada en tipografía chica: `  2x1 — Ahorro $200`
- [ ] Antes del total, línea "AHORRÓ EN PROMOS: $XXX" si hubo promos
- [ ] En modo 80mm y 57mm, ambas anchuras formatean correctamente
- [ ] El preview de impresión muestra lo mismo que sale impreso
- [ ] Tickets sin promos se imprimen idénticos a antes

**Notas técnicas:** Archivo afectado: `src/components/pos/ticket-termico.tsx` (o equivalente según la estructura actual del proyecto).

---

### Fase 5 — Refinamiento y documentación

---

#### V80-PROMO-019 — Métricas y dashboard de promociones

- Tipo: feature
- Módulo: promociones
- Prioridad: medium
- Estimación: 5
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-013

**Descripción:** Agregar card en el dashboard principal con métricas del mes de promociones aplicadas (monto ahorrado total, promos más usadas, productos top) y un endpoint que alimenta ese card.

**Criterios de aceptación:**

- [ ] API `GET /api/promociones/metricas?periodo=...` devuelve: monto total ahorrado, count de comprobantes con promo, top 5 promos por uso, top 5 productos por ahorro
- [ ] Card "Promociones del mes" en el dashboard con esos datos
- [ ] Link a `/promociones` desde el card
- [ ] Solo visible si el tenant tiene al menos una promo creada
- [ ] El período es seleccionable: mes actual, mes anterior, últimos 30 días

**Notas técnicas:** Query agregada sobre `comprobante_item` con `promocion_id IS NOT NULL`. Archivo: `src/app/api/promociones/metricas/route.ts` y componente del dashboard.

---

#### V80-PROMO-020 — Importador: columna "Promociones" (opcional, futura)

- Tipo: feature
- Módulo: importador
- Prioridad: low
- Estimación: 3
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-006

**Descripción:** Permitir que el importador Excel reconozca una columna de "promoción" para vincular productos a promociones existentes durante la carga masiva. No crea promociones nuevas, solo vincula.

**Criterios de aceptación:**

- [ ] El diccionario de aliases reconoce headers como "promoción", "promo", "oferta"
- [ ] El valor puede ser el nombre exacto de una promo existente en el tenant (match case-insensitive)
- [ ] Si el nombre no matchea ninguna promo existente → error de fila reportado, no bloquea el resto
- [ ] Si el producto ya tenía otra promo → error (igual que la API)
- [ ] Es una feature opcional: sin la columna, la importación funciona como hoy

**Notas técnicas:** Extensión mínima de `src/lib/normalizador/aliases.ts` y `src/lib/importar/ejecutar-importacion.ts`. Crear promos desde el importador queda fuera del alcance.

---

#### V80-PROMO-021 — Documentación `promociones.md`

- Tipo: docs
- Módulo: promociones
- Prioridad: high
- Estimación: 2
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-015, V80-PROMO-017, V80-PROMO-018

**Descripción:** Escribir el documento `docs/promociones.md` con el estilo del resto del memory bank: visión general, modelo de datos, motor de cálculo, integraciones, APIs, UI, casos borde documentados, decisiones tomadas.

**Criterios de aceptación:**

- [ ] Frontmatter con `estado`, `version`, `ultima_actualizacion`
- [ ] Secciones: Visión general, Modelo de datos, Motor de cálculo, Integración con facturación, Integración con pedidos, UI de gestión, UI en facturación/POS, PDF y ticket, Casos borde, APIs, Testing
- [ ] Ejemplos de cálculo con los 4 tipos de promo
- [ ] Referencia cruzada con `facturacion.md`, `medios-de-pago-y-financiacion.md`, `base-de-datos.md`, `pedidos.md`
- [ ] README.md actualizado: agregar `promociones.md` al índice de documentos

**Notas técnicas:** Archivo `docs/promociones.md`. Actualizar también `base-de-datos.md` con las nuevas tablas y `modulos.md` si se confirma que no hace falta un módulo propio.

---

#### V80-PROMO-022 — Actualización de `activeContext.md` y `TICKETS.md`

- Tipo: docs
- Módulo: promociones
- Prioridad: medium
- Estimación: 1
- Versión: v8.0
- Estado: todo
- Dependencias: V80-PROMO-021

**Descripción:** Reflejar el cierre del bloque v8.0 en el contexto activo y sumar los tickets al backlog principal.

**Criterios de aceptación:**

- [ ] `activeContext.md` actualizado con la sección "Versión v8.0 — Promociones"
- [ ] Decisiones documentadas en la tabla "Decisiones tomadas"
- [ ] `TICKETS.md` incluye el bloque V80-PROMO-001 a V80-PROMO-022 al final
- [ ] Resumen de tickets y esfuerzo agregado a `TICKETS.md`
- [ ] Grafo de dependencias agregado a `TICKETS.md`

**Notas técnicas:** Copiar el formato de los bloques previos (F, G).

---

## 8. Resumen de tickets y esfuerzo

| Fase | Ticket | Descripción | Pts |
|---|---|---|---|
| 1 | V80-PROMO-001 | Migración: ENUM y tabla promocion | 3 |
| 1 | V80-PROMO-002 | Migración: producto_promocion N:N | 2 |
| 1 | V80-PROMO-003 | Migración: columnas promo en comprobante_item y pedido_item | 3 |
| 1 | V80-PROMO-004 | Regenerar tipos TypeScript | 1 |
| 1 | V80-PROMO-005 | Motor `aplicarPromociones` + tests unitarios | 8 |
| 1 | **Subtotal Fase 1** |  | **17** |
| 2 | V80-PROMO-006 | API `GET/POST /api/promociones` | 5 |
| 2 | V80-PROMO-007 | API `GET/PUT/DELETE /api/promociones/[id]` | 5 |
| 2 | V80-PROMO-008 | Integración en `POST /api/facturacion/emitir` | 5 |
| 2 | V80-PROMO-009 | Integración en pedido → factura | 3 |
| 2 | V80-PROMO-010 | Tests de integración del backend | 5 |
| 2 | **Subtotal Fase 2** |  | **23** |
| 3 | V80-PROMO-011 | Página `/promociones` listado | 5 |
| 3 | V80-PROMO-012 | Páginas nueva/editar | 8 |
| 3 | V80-PROMO-013 | Página detalle | 5 |
| 3 | V80-PROMO-014 | Bloque en detalle de producto | 3 |
| 3 | **Subtotal Fase 3** |  | **21** |
| 4 | V80-PROMO-015 | Badges y cálculo en UI del POS | 8 |
| 4 | V80-PROMO-016 | UI en `/facturacion/nueva` | 5 |
| 4 | V80-PROMO-017 | PDF A4 con promociones | 5 |
| 4 | V80-PROMO-018 | Ticket térmico con promociones | 3 |
| 4 | **Subtotal Fase 4** |  | **21** |
| 5 | V80-PROMO-019 | Métricas y dashboard | 5 |
| 5 | V80-PROMO-020 | Importador: columna promociones | 3 |
| 5 | V80-PROMO-021 | Documentación `promociones.md` | 2 |
| 5 | V80-PROMO-022 | Actualización de `activeContext.md` y `TICKETS.md` | 1 |
| 5 | **Subtotal Fase 5** |  | **11** |
| | **TOTAL BLOQUE v8.0** | **22 tickets** | **93 pts** |

---

## 9. Grafo de dependencias

```text
V80-PROMO-001 (ENUM + promocion)
  ├── V80-PROMO-002 (producto_promocion)
  └── V80-PROMO-003 (columnas en items)
        └── V80-PROMO-004 (regenerar tipos)
              └── V80-PROMO-005 (motor + tests unit)
                    ├── V80-PROMO-006 (API list/create)
                    │     └── V80-PROMO-007 (API CRUD [id])
                    │           ├── V80-PROMO-012 (UI nueva/editar)
                    │           └── V80-PROMO-014 (bloque en producto)
                    │     └── V80-PROMO-011 (UI listado)
                    │           └── V80-PROMO-013 (UI detalle)
                    │           └── V80-PROMO-020 (importador)
                    ├── V80-PROMO-008 (emitir con promos)
                    │     ├── V80-PROMO-009 (pedido → factura)
                    │     ├── V80-PROMO-010 (tests integración)
                    │     ├── V80-PROMO-015 (UI POS)
                    │     │     └── V80-PROMO-016 (UI facturación nueva)
                    │     ├── V80-PROMO-017 (PDF A4)
                    │     └── V80-PROMO-018 (ticket térmico)
                    └── V80-PROMO-019 (métricas dashboard)

V80-PROMO-021 (docs) depende de V80-PROMO-015, 017, 018
V80-PROMO-022 (activeContext + TICKETS) depende de V80-PROMO-021
```

---

## 10. Puntos abiertos para confirmar antes de arrancar

Hay cinco decisiones que vale la pena cerrar ahora para no tener que cambiar de rumbo a mitad de camino.

**(1)** ¿El scope de v1 que propuse (`porcentaje_off`, `n_x_m`, `porcentaje_unidad_n`, `descuento_volumen`) cubre lo que necesitás, o querés sumar combos/cross-product desde el arranque? Mi recomendación es mantenerlo acotado.

**(2)** ¿Promociones requieren módulo propio en `modulo_config` (ej. `promociones: boolean`) o viven dentro del módulo `stock`? Si es algo que pensás monetizar en un plan diferenciado, módulo propio. Si es una feature transversal del sistema, adentro de stock. Este plan asume lo segundo.

**(3)** ¿Un producto puede tener múltiples promos activas en paralelo, o una sola? Recomiendo una sola en v1 por simplicidad de UI y de motor. Si hay dos aplicables, gana la que da mejor precio al cliente (política explícita). Este plan asume una sola.

**(4)** En pedidos convertidos a factura, ¿la promo se congela al crear el pedido (política asumida en V80-PROMO-009) o se recalcula al facturar? Congelar es más predecible para el cliente B2B; recalcular da flexibilidad comercial.

**(5)** ¿Querés soportar también "promo de cliente" (ej. 10% off para clientes mayoristas) o las promos son solo sobre productos? Si la respuesta es sí, cambia el modelo: necesitás una tabla de reglas con filtros (por producto, por categoría, por cliente). Es un alcance bastante mayor y probablemente amerita una v8.1 o v9.

Cuando confirmes estos puntos (especialmente 1, 3 y 4, que son los que más definen el motor) se puede arrancar con la fase 1: migraciones + función `aplicarPromociones` + tests unitarios, que es la base sólida sobre la que se construye todo lo demás.