---
estado: 🔵 Planificado
version: v14.0
ultima_actualizacion: 2026-05-07
revisiones:
  - 2026-05-07 (rev 2): ajustado al estado real del repo tras migraciones 116–135 (ganancia por tramos ya implementada, lotes de ingreso, movimiento.proveedor_id, PLU con unidad, fusión de productos, business_prefs, usuario_permiso). Migraciones del bloque renumeradas a 136+.
---

# BLOQUE L — v14.0 (Despiece de Carnicerías — Pricing por Cortes)

---

## 0. Contexto y por qué este plan existe

Una carnicería **no compra cortes**, compra animales enteros: medias reses, medias de cerdo, pollos. Una media de cerdo de 47 kg que entra a $2.900/kg sale en 9–10 cortes distintos (matambre, bondiola, costillar, paleta, patita, recorte, etc.) que se venden a precios **muy distintos por kg**: el matambre a $8.500/kg y la patita a $1.000/kg.

El problema central del rubro es operativo y se repite todos los días: **¿a qué precio pongo cada corte para no fundirme y ganar lo que quiero ganar?** Hoy lo resuelven con planillas de Excel artesanales pasadas de carnicero en carnicero, con divisores mágicos, fórmulas escritas a mano y celdas etiquetadas como "RENTAVILIDAD" (mal escrito).

El usuario nos compartió una planilla real (`Carnicerias.xlsx`, "PRESUPUESTO GENERAL PRODUCTOS VARIOS — REYES") que modela esto para tres animales: cerdo, pollo y vacuno. La planilla tiene cuatro estrategias de pricing por corte conviviendo en la misma hoja:

1. **Rentabilidad variable por corte**: cada corte tiene un factor de ajuste sobre el promedio (matambre +80%, patita −50%).
2. **Rentabilidad fija pareja**: todos los cortes con la misma rentabilidad (50%, 70% o 20% según animal).
3. **Precio anclado manualmente**: el carnicero escribe el precio que el mercado banca y la planilla calcula cuánta rentabilidad le queda.
4. **Corrección de precio**: prueba un precio nuevo y mide cuánto se desvía del promedio teórico.

El módulo `analizador_rentabilidad` (Bloque E) ya hace algo parecido pero **al revés**: parte de un costo conocido por producto y sugiere precio de venta para mantener margen. Acá el problema es distinto: hay **un solo costo de compra** (el animal) que tiene que repartirse en N productos hijos con kg parciales y precios desiguales, y el sistema tiene que ayudar al carnicero a definir esos N precios respetando la rentabilidad global objetivo.

Smart Stock hoy no modela "1 producto padre que se transforma en N productos hijos al ingresar al inventario". Las piezas existen sueltas, varias de ellas implementadas en migraciones recientes:

- `producto.unidad_compra` y `producto.contenido_unidad_compra` modelan caja/pack (migración `099`), pero asumen que el contenido de la caja son **N unidades del mismo producto**, no productos distintos.
- `producto_ganancia_tramo` (migraciones `116` y `118`) ya está **implementada**: define ganancia por cantidad por producto, con `cantidad_desde`, `ganancia_pct` y `orden`. El motor de pricing del despiece **convive** con esto sin acoplamiento — el despiece define `producto.precio_venta`, los tramos operan después.
- `producto_lote_ingreso` (migración `119`) ya está implementada: cada entrada de stock por importación / lector de facturas / compra / POS / manual queda registrada con cantidad, vencimiento, costo y proveedor. **Esta es la pieza clave para la Fase 2** (despiece transaccional): un ingreso de "1 media de cerdo" se puede modelar como N lotes de hijos con un mismo `lote_padre_id`.
- `movimiento.proveedor_id` (migración `120`) y `registrar_movimiento(..., p_proveedor_id)` permiten trazabilidad por proveedor en cada movimiento de stock — útil para Fase 2.
- `producto.es_pesable` + `producto.plu` con la migración `135` aceptan productos con `unidad ∈ {kg, gramo, unidad}`. Esto significa que los cortes pueden ser **pesables con unidad `kg`** (lo común: matambre por kg) o **por unidad** (un pollo entero, una bondiola pesada en bandeja con PLU).
- `business_prefs` (migración `118`) en `tenant` y `sucursal` con override por sucursal: el lugar natural para guardar preferencias del módulo de despiece a nivel tenant (qué estrategia mostrar primero, redondeos, etc.).
- `usuario_permiso` (migración `134`) permite permisos granulares por usuario además de los del rol — la sección de permisos del módulo se modela como permisos en la tabla `permiso` y se otorgan por rol y por usuario.
- `fusionar_productos` (migración `133`) repunta FKs al fusionar productos. Cuando se fusionen productos hijos de un despiece, el survivor mantiene su lugar en `despiece_corte` y se borra la entrada del loser para evitar duplicados (ver sección 4).
- `precio_historial` y `producto.precio_costo` modelan costos y márgenes por producto individual.

Este plan agrega la pieza faltante: **el modelo de despiece**, que toma un producto-padre (animal) y lo descompone en productos-hijos (cortes) con kg de rendimiento, factor de ajuste y precio anclado opcional, y un motor de pricing que calcula las cuatro estrategias de la planilla automáticamente.

La versión objetivo es **v14.0** y el prefijo de tickets es `V140-DESP-XXX`. La última migración aplicada en el repo al momento de escribir este plan es la `135` (`producto_plu_pesable_o_unidad`), por lo que las migraciones nuevas del bloque arrancan en **`136`**.

---

## 1. Decisiones clave a tomar antes de arrancar

Antes de tocar nada, hay cinco definiciones que conviene cerrar porque condicionan toda la implementación. Son más de negocio que técnicas.

### (a) ¿El despiece descuenta stock del padre y crea stock de los hijos?

Hay dos modelos posibles:

- **Opción A — Solo pricing**: el módulo es una calculadora de precios. El carnicero compra la media, en el sistema da de alta la media como producto, y aparte da de alta los cortes como productos sueltos. El módulo solo le dice "para no perder plata, vendé el matambre a $8.500/kg". No mueve stock ni vincula la compra a las ventas.
- **Opción B — Despiece transaccional**: cuando el carnicero da de alta una compra de "1 media de cerdo", el sistema **descuenta 1 unidad del padre y suma N kg en cada hijo** según los kg de rendimiento de la plantilla. La trazabilidad es completa: cada kg vendido sale de un animal específico.

**Recomendación**: arrancar con **Opción A** y dejar la B como fase 2. El módulo es valioso solo como calculadora (la planilla actual ya lo demuestra). La opción B agrega complejidad de stock que requiere repensar el modelo (stock por unidad vs stock por kg, mermas, cortes que no se vendieron, etc.) y conviene validarla con un piloto antes.

### (b) ¿Una plantilla por tenant o varias?

Una carnicería puede tener distintos despieces:
- Para distintos animales (media de cerdo vs cerdo entero vs lechón).
- Para distintos proveedores (un frigorífico le da las medias con espinazo y otro sin).
- Para distintos planes comerciales (despiece "popular" con cortes baratos vs "premium").

**Decisión**: una tabla `despiece_plantilla` con N filas por tenant, donde cada plantilla apunta a **un producto-padre** y **un set de productos-hijos con sus kg de rendimiento**. Si una carnicería usa el mismo despiece para todos los proveedores, tendrá una sola plantilla. Si los varía, varias.

### (c) ¿El producto-padre está en el catálogo o es un "concepto" abstracto?

La planilla usa "MEDIA DE CERDO" como un input de costo, no como un producto que se vende a clientes. Pero es razonable que aparezca en el catálogo como producto de compra (para registrar la factura del frigorífico, para el analizador, etc.).

**Decisión**: el producto-padre es un **producto normal del catálogo** con un campo nuevo `es_despiece_padre = true`. Se compra en facturas de proveedor pero **no se vende al público** (excepto que el carnicero quiera). Sobre los hijos: gracias a la migración `135` (`producto_plu_pesable_o_unidad`), un corte puede ser:

- `unidad = 'kg'` y `es_pesable = true` (lo más común: matambre por kg).
- `unidad = 'gramo'` y `es_pesable = true` (cortes chicos).
- `unidad = 'unidad'` y `es_pesable = true` con PLU (un pollo entero envasado, bondiola en bandeja, paquete de chorizo casero).
- `unidad = 'unidad'` sin pesable (productos derivados ya empacados en porciones fijas).

El motor de cálculo trabaja siempre en **kg de rendimiento** (la unidad natural del despiece), independientemente de la unidad del producto hijo. Si el hijo es por unidad y no pesable, hay que registrar el peso promedio por unidad en el corte (campo opcional `peso_promedio_unidad`) para que el cálculo cierre. Esto se cubre en la sección 2.

### (d) ¿Qué pasa con embutidos y achuras?

En la planilla de Reyes, el resumen general (filas 9–10) maneja embutidos y achuras de forma simple: un costo total y un % de ganancia, sin despiece. No salen de un animal, son productos comprados ya transformados.

**Decisión**: el módulo solo modela animales con despiece. Embutidos y achuras siguen siendo productos comunes con su propio costo de compra y ganancia (lo que ya hace Smart Stock). El **dashboard del módulo** los puede sumar para el cálculo de rentabilidad general, pero por fuera del flujo de despiece.

### (e) ¿Cómo se tratan los cortes "compuestos" (asado vs asado de punta, nalga vs tapa de nalga)?

En la planilla aparecen fórmulas como `C53 = 13.8 - C54` (asado = 13.8 kg totales menos lo que va a "asado punta") y `C69 = 6.46 - 1.6` (nalga total menos tapa de nalga). El carnicero tiene un kg total de "carne contigua" que separa en dos productos según le convenga.

**Decisión**: en la versión 1, **no soportar cortes compuestos** automáticamente. Cada corte tiene su `kg_rendimiento` independiente. Si el carnicero quiere separar nalga en "nalga" y "tapa de nalga", carga las dos filas con sus kg cada una. La fórmula `13.8 - C54` no es generalizable de un carnicero a otro y es mejor pedir el dato directo. En una fase futura se puede agregar un grupo `corte_compuesto` con un total y una distribución, pero arrancar simple.

---

## 2. Modelo de datos

### 2.1. Tablas nuevas

**Migración: `136_despiece_plantilla.sql`**.

```sql
-- Tabla de plantillas de despiece (un animal = una plantilla)
CREATE TABLE despiece_plantilla (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,                       -- "Media de cerdo Reyes", "Pollo proveedor X"
    producto_padre_id UUID NOT NULL REFERENCES producto(id) ON DELETE RESTRICT,
    peso_total_kg NUMERIC(10,3) NOT NULL,       -- 47 kg, 2 kg, 118 kg
    rentabilidad_objetivo_pct NUMERIC(6,2),     -- 50, 70, 20 (objetivo de rentabilidad fija)
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    notas TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_despiece_plantilla_padre ON despiece_plantilla(tenant_id, producto_padre_id, nombre);
CREATE INDEX idx_despiece_plantilla_tenant ON despiece_plantilla(tenant_id);

-- Tabla de cortes por plantilla (un padre = N hijos)
CREATE TABLE despiece_corte (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    plantilla_id UUID NOT NULL REFERENCES despiece_plantilla(id) ON DELETE CASCADE,
    producto_hijo_id UUID NOT NULL REFERENCES producto(id) ON DELETE RESTRICT,
    kg_rendimiento NUMERIC(10,3) NOT NULL CHECK (kg_rendimiento >= 0),
    factor_ajuste_pct NUMERIC(12,10) NOT NULL DEFAULT 0, -- +0.80 (matambre +80%), -0.50 (patita -50%)
    precio_anclado NUMERIC(12,2),                       -- precio manual del carnicero (NULL si no quiere fijar)
    -- Para cortes con unidad='unidad' (no pesable o pesable por pieza con PLU):
    -- peso promedio que cada unidad contiene del padre. Permite mantener kg_rendimiento como
    -- fuente de verdad y derivar la cantidad de unidades = kg_rendimiento / peso_promedio_unidad.
    peso_promedio_unidad_kg NUMERIC(10,3),
    orden INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_despiece_corte_peso_unidad
      CHECK (peso_promedio_unidad_kg IS NULL OR peso_promedio_unidad_kg > 0)
);

CREATE UNIQUE INDEX idx_despiece_corte_unico ON despiece_corte(plantilla_id, producto_hijo_id);
CREATE INDEX idx_despiece_corte_tenant ON despiece_corte(tenant_id);
CREATE INDEX idx_despiece_corte_plantilla ON despiece_corte(plantilla_id, orden);

-- RLS (mismo patrón de tenant_isolation usado en el resto del proyecto)
ALTER TABLE despiece_plantilla ENABLE ROW LEVEL SECURITY;
ALTER TABLE despiece_corte ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_despiece_plantilla ON despiece_plantilla
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_insert_despiece_plantilla ON despiece_plantilla
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_update_despiece_plantilla ON despiece_plantilla
    FOR UPDATE USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_delete_despiece_plantilla ON despiece_plantilla
    FOR DELETE USING (tenant_id = current_tenant_id());

CREATE POLICY tenant_select_despiece_corte ON despiece_corte
    FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_insert_despiece_corte ON despiece_corte
    FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY tenant_update_despiece_corte ON despiece_corte
    FOR UPDATE USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_delete_despiece_corte ON despiece_corte
    FOR DELETE USING (tenant_id = current_tenant_id());

-- Triggers updated_at (mismo patrón que el resto del proyecto: moddatetime)
CREATE TRIGGER set_despiece_plantilla_updated_at
    BEFORE UPDATE ON despiece_plantilla
    FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER set_despiece_corte_updated_at
    BEFORE UPDATE ON despiece_corte
    FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

NOTIFY pgrst, 'reload schema';
```

### 2.2. Cambios en tablas existentes

**Migración: `137_producto_es_despiece_padre.sql`**

```sql
ALTER TABLE producto ADD COLUMN es_despiece_padre BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX idx_producto_despiece_padre ON producto(tenant_id) WHERE es_despiece_padre = TRUE;

NOTIFY pgrst, 'reload schema';
```

**Migración: `138_modulo_config_despiece.sql`**

```sql
-- Agregar el flag despiece_carniceria al modulo_config
ALTER TABLE modulo_config ADD COLUMN despiece_carniceria BOOLEAN NOT NULL DEFAULT FALSE;

-- Activar por default solo para tenants en planes que incluyan el módulo.
-- La función activar_plan se actualiza en una migración posterior junto a la lógica del flag.
NOTIFY pgrst, 'reload schema';
```

**Migración: `139_fusionar_productos_despiece.sql`** (extiende la `133`).

Cuando se fusionan dos productos hijos del mismo despiece, hay que limpiar la fila duplicada en `despiece_corte` antes de repuntar las FKs:

```sql
-- Extiende fusionar_productos para limpiar despiece_corte:
-- si el survivor y el loser son el mismo corte en una plantilla, borrar el del loser.
-- Si son cortes distintos en la misma plantilla, también borrar el del loser
-- (un producto solo puede aparecer una vez por plantilla; ya está cubierto por idx_despiece_corte_unico).
-- La fusión se modela como "el loser deja de existir como corte; el survivor mantiene el suyo si lo tenía".
```

> Esta migración modifica la función `fusionar_productos` para agregar dentro del bloque que repunta FKs:
>
> ```sql
> -- Borrar filas del perdedor que chocarían con el destino en despiece_corte
> DELETE FROM public.despiece_corte dc
> USING public.despiece_corte dc2
> WHERE dc.tenant_id = p_tenant_id
>   AND dc.producto_hijo_id = v_loser
>   AND dc2.tenant_id = dc.tenant_id
>   AND dc2.plantilla_id = dc.plantilla_id
>   AND dc2.producto_hijo_id = p_survivor_id;
>
> -- Repuntar el resto al survivor
> UPDATE public.despiece_corte SET producto_hijo_id = p_survivor_id
> WHERE tenant_id = p_tenant_id AND producto_hijo_id = v_loser;
> ```
>
> Si el loser es un padre de despiece (`es_despiece_padre = true`), se debe **rechazar la fusión** con un error explícito (`RAISE EXCEPTION 'No se puede fusionar un producto que es padre de despiece. Eliminá la plantilla primero.'`). Los survivors padre se mantienen.

**Cambios en `precio_historial.origen`**: agregar `'despiece'` como valor válido (es un TEXT en el schema actual, no un ENUM, así que es solo agregar el valor a la documentación y al código de aplicación).

### 2.3. Permisos en el catálogo `permiso`

La migración `134` introdujo el sistema de permisos granulares por usuario. El módulo de despiece se integra agregando entradas al catálogo:

**Migración: `140_permisos_despiece.sql`**

```sql
INSERT INTO public.permiso (clave, modulo, descripcion)
VALUES
  ('despiece.ver',             'despiece', 'Ver plantillas de despiece y calcular precios'),
  ('despiece.editar',          'despiece', 'Crear y editar plantillas de despiece'),
  ('despiece.aplicar_precios', 'despiece', 'Aplicar una estrategia de pricing al catálogo')
ON CONFLICT (clave) DO NOTHING;

-- Asignación a roles base
INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
JOIN public.permiso p ON p.clave IN ('despiece.ver')
WHERE lower(r.slug) IN ('superadmin', 'admin', 'cajero', 'visor')
ON CONFLICT DO NOTHING;

INSERT INTO public.rol_permiso (rol_id, permiso_id)
SELECT r.id, p.id
FROM public.rol r
JOIN public.permiso p ON p.clave IN ('despiece.editar', 'despiece.aplicar_precios')
WHERE lower(r.slug) IN ('superadmin', 'admin')
ON CONFLICT DO NOTHING;
```

### 2.4. Justificación de las decisiones de modelo

- **Plantilla separada de corte**: permite tener N plantillas por animal (una por proveedor o por estrategia comercial) sin duplicar la información del padre.
- **`producto_padre_id` en `producto`, no en una tabla intermedia**: el padre es un producto normal; lo que cambia es que tiene plantillas asociadas. Una columna boolean simple es suficiente para listarlo en pantallas como "productos con despiece".
- **`factor_ajuste_pct` con escala 0–1 (no 0–100)**: la planilla original usa 0.80 para "+80%", manteniendo la misma escala. La fórmula es `precio = promedio × (1 + factor)`. Usar escala alta (`NUMERIC(12,10)`) porque la planilla trae factores como `0.8055555`, `0.3966265060` y `0.0668674699`; con `NUMERIC(8,4)` se perdería precisión y los tests contra Excel no cerrarían igual.
- **`precio_anclado` nullable**: permite distinguir "no quiero fijar precio para este corte" (NULL → solo se calcula con las otras estrategias) de "lo quiero a $8.500" (valor fijo).
- **`peso_total_kg` en plantilla, no en producto-padre**: porque puede variar entre plantillas del mismo animal (un proveedor entrega medias de 47 kg, otro de 50 kg), y porque conceptualmente es propiedad del modelo de despiece, no del producto en abstracto.
- **`rentabilidad_objetivo_pct` en plantilla**: cada animal tiene su rentabilidad objetivo distinta (cerdo 50%, pollo 70%, vacuno 20% en la planilla original). Es propiedad del despiece, no global del tenant.
- **`peso_promedio_unidad_kg` opcional**: para cortes con unidad `'unidad'`, permite traducir entre kg de rendimiento (cómo se mide el despiece) y unidades del catálogo (cómo se vende). Si el hijo es kg/gramo, se ignora.
- **No agrego un ENUM nuevo para `precio_historial.origen`**: esa columna en el repo actual es TEXT libre (revisar al implementar). Si fuera ENUM, hay que extenderlo en `precio_historial`. La aplicación valida el valor antes de insertar.

---

## 3. Motor de cálculo (las cuatro estrategias)

### 3.1. Inputs del motor

```typescript
interface InputDespiece {
  costo_compra_kg: number;        // $2900 (lo que pagó el carnicero por kg)
  peso_total_kg: number;          // 47 kg de la media
  rentabilidad_objetivo_pct: number; // 50 (busca un margen del 50% global)
  cortes: Array<{
    producto_hijo_id: string;
    nombre: string;
    kg_rendimiento: number;       // 1.65 kg de matambre
    factor_ajuste_pct: number;    // 0.80
    precio_anclado: number | null; // 8500 o null
  }>;
}
```

### 3.2. Cálculos comunes

```typescript
// 1) Suma de kg de cortes (≈ peso_total_kg, puede haber merma)
const kg_cortes_total = sum(cortes.kg_rendimiento);

// 2) Costo total de la pieza
const costo_total = costo_compra_kg * peso_total_kg;

// 3) Precio promedio teórico por kg de venta (incluye merma)
//    Esta es la D30 / D44 / D82 de la planilla
const precio_promedio_kg = (costo_compra_kg * peso_total_kg) / kg_cortes_total;
```

> **Por qué la merma importa**: si la media pesa 47 kg pero los cortes que vas a vender suman 45 kg (porque parte se pierde en hueso, grasa que se descarta, jugo), tu **costo efectivo por kg vendido** sube. La planilla original no separa "merma física" de "kg que sí vendo pero a precio cero" — los huesos pelados con 0 kg en la planilla son la forma de modelarlo. Para el motor, tratamos `kg_cortes_total` como "total comprometido para venta" y la diferencia con `peso_total_kg` como merma neta.

### 3.3. Estrategia 1 — Rentabilidad variable por corte

```typescript
// Para cada corte: precio_v1 = precio_promedio_kg × (1 + factor_ajuste)
const estrategia_1 = cortes.map(c => ({
  ...c,
  precio_kg: precio_promedio_kg * (1 + c.factor_ajuste_pct),
  importe: c.kg_rendimiento * (precio_promedio_kg * (1 + c.factor_ajuste_pct)),
}));

const venta_total_v1 = sum(estrategia_1.importe);
const rentabilidad_v1_pct = (venta_total_v1 / costo_total - 1) * 100;
```

**Propiedad clave**: si la suma ponderada de los factores está bien calibrada, `rentabilidad_v1_pct ≈ rentabilidad_objetivo_pct`. El motor debe **validar** esto y avisar al carnicero si está muy lejos.

### 3.4. Estrategia 2 — Rentabilidad fija pareja

Acá la planilla hace un truco que merece análisis. Define un divisor mágico (1.3538 para cerdo, 1.306 para pollo, 1.2783 para vacuno) y aplica:

```typescript
// Versión planilla original (con divisor mágico):
const precio_v2 = (precio_v1 / DIVISOR) * (1 + rentabilidad_objetivo_pct/100);
```

**Pero el divisor es derivable**. El divisor que la planilla usa es **el promedio ponderado de `(1 + factor_ajuste_pct)` sobre los kg rendidos**. Equivale a `1 + rentabilidad_v1` cuando la estrategia variable se mide contra el costo total del padre. Para evitar el "número mágico", el motor calcula:

```typescript
// Versión limpia: queremos que TODOS los cortes tengan la misma rentabilidad
// sobre un costo unitario común (que es precio_promedio_kg).
// El precio v2 de cada corte es simplemente precio_promedio_kg × (1 + rent/100)
// PERO eso ignora los factores de mercado (matambre vale más que patita).
//
// La planilla quiere mantener LA FORMA RELATIVA de los precios (factores)
// pero ajustar la escala para que la rentabilidad global sea exactamente la objetivo.

const factor_escala = (1 + rentabilidad_objetivo_pct/100) /
                      (venta_total_v1 / costo_total);

const estrategia_2 = cortes.map(c => ({
  ...c,
  precio_kg: precio_promedio_kg * (1 + c.factor_ajuste_pct) * factor_escala,
}));
```

> **Decisión**: documentar las DOS variantes en el motor y dejar que el carnicero elija. La "planilla pura" (con divisor calculado) replica exactamente lo que ya conocen y reduce fricción. La "limpia" es matemáticamente más sólida. Por defecto: la "planilla pura" porque preserva intuición existente.

### 3.5. Estrategia 3 — Precio anclado manual

```typescript
// Solo aplica para cortes con precio_anclado != null
const estrategia_3 = cortes.map(c => ({
  ...c,
  precio_kg: c.precio_anclado,
  importe: c.precio_anclado != null ? c.kg_rendimiento * c.precio_anclado : null,
}));

const venta_total_v3 = sum(estrategia_3.filter(c => c.importe != null).importe);
// Para cortes sin precio_anclado, fallback a estrategia 1 o 2 (configurable)

// Rentabilidad real con precios anclados
const rentabilidad_v3_pct = (venta_total_v3 / costo_total - 1) * 100;
```

Este es el modo más usado en la práctica: el carnicero pone los precios "que la calle banca" y el sistema le dice **qué rentabilidad le sale**. Si es menos de la objetivo, le sugiere ajustes (subir el precio del corte X, bajar la merma, comprar más barato).

### 3.6. Estrategia 4 — Corrección de precio (modo simulador)

No es una estrategia separada sino un **simulador**: el carnicero edita el precio anclado de un corte y ve en tiempo real:

- Cuánto se desvía del precio promedio teórico.
- Cómo cambia la rentabilidad global.
- Cómo se compara con el precio sugerido por las estrategias 1 y 2.

### 3.7. Donde vive el motor

```text
src/lib/despiece/
├── motor.ts             // calcular4Estrategias(input) -> resultado completo
├── tipos.ts             // InputDespiece, ResultadoDespiece, etc.
├── validar.ts           // checks de consistencia (kg ≥ 0, sumas, ranges)
└── aplicar.ts           // aplicarPreciosAlCatalogo(plantillaId, estrategia) -> updatea producto.precio_venta + precio_historial
```

El motor es **puro** (sin side effects, sin acceso a DB). Recibe inputs, devuelve outputs. Esto permite:
- Testearlo a fondo con casos de la planilla original.
- Reusarlo en backend (route handlers) y frontend (preview en vivo).
- Conectarlo más adelante con el módulo `analizador_rentabilidad` sin acoplamiento.

---

## 4. APIs y route handlers

### 4.1. Endpoints

```text
GET    /api/despiece/plantillas
       Lista plantillas del tenant. Filtros opcionales: producto_padre_id, activo.

POST   /api/despiece/plantillas
       Crea una plantilla. Body: { nombre, producto_padre_id, peso_total_kg, rentabilidad_objetivo_pct, cortes: [...] }

GET    /api/despiece/plantillas/[id]
       Detalle completo (plantilla + cortes con productos hijos hidratados).

PUT    /api/despiece/plantillas/[id]
       Update. Permite agregar/editar/eliminar cortes en una sola llamada (replace pattern).

DELETE /api/despiece/plantillas/[id]
       Soft delete (marca activo=false).

POST   /api/despiece/calcular
       Endpoint stateless que recibe el input completo y devuelve las 4 estrategias.
       Útil para preview en vivo sin guardar.

POST   /api/despiece/plantillas/[id]/aplicar
       Aplica una estrategia a los productos hijos:
         - Body: { estrategia: 'variable' | 'fija' | 'anclada', solo_cortes?: string[] }
         - Para cada producto hijo afectado, actualiza precio_venta y crea fila en precio_historial con origen='despiece'.
         - Devuelve resumen: { productos_actualizados, precios_anteriores, precios_nuevos }.
```

### 4.2. Validaciones del backend

- `peso_total_kg > 0`.
- `kg_rendimiento ≥ 0` (puede ser cero para cortes que no se venden, como hueso).
- Suma de `kg_rendimiento` ≤ `peso_total_kg × 1.05` (tolerancia de 5%; alertar si excede).
- `producto_padre_id` debe ser un producto del mismo tenant con `unidad_stock = 'unidad'`.
- `producto_hijo_id` debe ser pesable (`es_pesable = true`) y de unidad `kg`.
- No permitir el mismo `producto_hijo_id` dos veces en la misma plantilla.

### 4.3. Permisos

El módulo se gobierna por `modulo_config.despiece_carniceria` (default `false`). Solo activable en planes que lo incluyan (define el equipo comercial).

A nivel de permisos granulares (sistema introducido por la migración `134` con la tabla `usuario_permiso`), se agregan tres claves al catálogo `permiso` (ver migración `140` en sección 2.3):

- `despiece.ver` (default a roles `superadmin`, `admin`, `cajero`, `visor`).
- `despiece.editar` (default a `superadmin`, `admin`).
- `despiece.aplicar_precios` (default a `superadmin`, `admin`).

El admin del tenant puede **otorgar permisos puntuales por usuario** vía `usuario_permiso` (ej. dar `despiece.editar` a un cajero específico que ayuda con la planilla). El backend resuelve el permiso efectivo como `rol_permiso ∪ usuario_permiso`.

---

## 5. UI / Pantallas

### 5.1. Nueva sección en sidebar

Bajo "Catálogo" o como item independiente "Carnicería" (mostrar solo si el flag está activo):

```text
Carnicería
├── Plantillas de despiece
├── Calcular (rápido, sin guardar)
└── Histórico de aplicaciones
```

### 5.2. Pantalla principal: editor de plantilla

```text
/dashboard/despiece/plantillas/[id]
```

**Layout**:

```text
┌───────────────────────────────────────────────────────────────────┐
│ ← Volver                                                          │
│                                                                   │
│ Plantilla: "Media de cerdo Reyes"  [Editar nombre]                │
│ Producto padre: Media de Cerdo (cerdo-media)                      │
│                                                                   │
│ ┌─ Datos generales ───────────────────────────────────────────┐  │
│ │ Costo compra ($/kg): [  2.900  ]                             │  │
│ │ Peso total (kg):     [  47    ]                              │  │
│ │ Rentabilidad obj.:   [  50%  ]                               │  │
│ │ Costo total: $136.300                                        │  │
│ └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│ Cortes (9)                                          [+ Agregar]   │
│ ┌────────────────────────────────────────────────────────────────┐│
│ │Corte             KG    Factor    P.Variable  P.Fija   P.Ancl. ││
│ ├────────────────────────────────────────────────────────────────┤│
│ │matambre cerdo   1.65   +80.5%   $5,236      $4,350    $8,500  ││
│ │vacío            1.675  +66.6%   $4,832      $4,015    $7,000  ││
│ │costillar        5.33   +38.9%   $4,029      $3,348    $6,500  ││
│ │paleta s/p       6.20   +11.0%   $3,219      $2,675    $4,800  ││
│ │bondiola s/h     2.70   +80.5%   $5,236      $4,350    $8,000  ││
│ │jamón s/h       11.10   +38.8%   $4,028      $3,347    $6,500  ││
│ │carré sin cuero  6.60   +33.3%   $3,866      $3,213    $6,500  ││
│ │patita           0.60   −50.0%   $1,450      $1,205    $1,000  ││
│ │recorte/papada   2.00   −10.0%   $2,609      $2,168    $5,200  ││
│ ├────────────────────────────────────────────────────────────────┤│
│ │TOTAL           37.85                                            ││
│ └────────────────────────────────────────────────────────────────┘│
│                                                                   │
│ ┌─ Resumen por estrategia ────────────────────────────────────┐   │
│ │              Venta total    Rentab.   vs objetivo            │   │
│ │ Variable     $159,720       17.2%     ⚠ por debajo (50%)     │   │
│ │ Fija         $204,450       50.0%     ✓ ok                   │   │
│ │ Anclada      $213,400       56.6%     ✓ ok                   │   │
│ └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│ [Guardar plantilla]  [Aplicar estrategia ▾]                       │
└───────────────────────────────────────────────────────────────────┘
```

**Interacciones clave**:

- Editar cualquier celda (kg, factor, precio anclado) recalcula los totales **en vivo** en el cliente, llamando a `motor.ts` localmente. No hace falta ida y vuelta al servidor.
- "Aplicar estrategia" abre un modal con preview de cambios en `producto.precio_venta` y diff con el valor actual.
- Una columna verde/roja muestra el estado del corte (precio anclado por debajo del costo, etc.).

### 5.3. Pantalla "Calcular rápido"

```text
/dashboard/despiece/calcular
```

Para el carnicero que **no quiere guardar una plantilla**, solo quiere hacer la cuenta. Mismo editor que arriba pero sin persistencia, con botón "Guardar como plantilla" para promoverlo.

### 5.4. Componentes nuevos

```text
src/components/despiece/
├── editor-plantilla.tsx          // editor completo
├── tabla-cortes.tsx               // grilla editable
├── resumen-estrategias.tsx        // bloque de totales
├── modal-aplicar-precios.tsx      // confirmación antes de updatear catálogo
└── selector-producto-padre.tsx    // combobox que filtra es_despiece_padre=true
```

### 5.5. Integración con `producto/nuevo` y `producto/editar`

En la ficha de producto, agregar:

- Si `es_despiece_padre=true`: tab nuevo "Plantillas de despiece" con lista de plantillas asociadas y botón "+ Nueva plantilla".
- En cualquier producto hijo de una plantilla: badge "Pertenece al despiece de [Media de cerdo Reyes]" con link a la plantilla.

---

## 6. Pricing avanzado: integración con tramos y promos

Smart Stock ya tiene `producto_ganancia_tramo` (plan-ganancia-por-tramos.md) y motor de promociones. ¿Cómo conviven con el despiece?

**Decisión**: el módulo de despiece **calcula y aplica `producto.precio_venta`** (el precio base del producto). Una vez aplicado, los tramos por cantidad y las promociones operan **sobre ese precio base**, igual que para cualquier producto. No hay acoplamiento.

Ejemplo: el matambre tiene precio base $8.500/kg vía despiece. El carnicero define un tramo en `producto_ganancia_tramo` que dice "para más de 5 kg, 10% off". POS aplica el descuento sobre $8.500. Promociones del estilo "lleva 2, paga 1.5" siguen funcionando.

---

## 7. Pricing y dashboard del nivel global

La planilla tiene un **resumen general arriba** (filas 4–14) que junta los 3 animales con embutidos y achuras y calcula la rentabilidad consolidada del negocio. Esto vale la pena replicarlo.

**Pantalla nueva**: `/dashboard/despiece/dashboard`

```text
┌───────────────────────────────────────────────────────────────────┐
│ Presupuesto general — proyección mensual                          │
│                                                                   │
│ ┌─ Animales con despiece ──────────────────────────────────────┐  │
│ │ Animal      Cantidad  $/kg vta   Importe       Costo         │  │
│ │ Cerdo       900 kg    $7,500     $6,750,000    $2,610,000    │  │
│ │ Pollo        50 kg    $9,200     $460,000      $96,000       │  │
│ │ Vacuno    2,000 kg    $11,300    $22,600,000   $12,800,000   │  │
│ └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│ ┌─ Otros productos ────────────────────────────────────────────┐  │
│ │ Categoría     Costo total   % ganancia   Importe venta       │  │
│ │ Embutidos     $700,000      60%          $1,120,000          │  │
│ │ Achuras       $400,000      60%          $640,000            │  │
│ └──────────────────────────────────────────────────────────────┘  │
│                                                                   │
│ ┌─ Consolidado ────────────────────────────────────────────────┐  │
│ │ Venta total:       $31,570,000                                │  │
│ │ Compra total:      $16,606,000                                │  │
│ │ Ganancia bruta:    $14,964,000                                │  │
│ │ Rentabilidad:      90.1%                                      │  │
│ └──────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

Los inputs son:
- Cantidad mensual proyectada (en kg) por animal — input manual del carnicero.
- Para cada animal, usa los precios de la estrategia activa de su plantilla.
- Para "otros productos", agrupa categorías del catálogo (embutidos, achuras) y aplica una rentabilidad simple.

Este dashboard es el **valor visible** del módulo: el carnicero ve plata y rentabilidad, no fórmulas.

---

## 8. Tickets

### V140-DESP-001 — Migración 136: tablas despiece_plantilla y despiece_corte

- Tipo: migration
- Módulo: despiece
- Prioridad: critical
- Estimación: 5
- Versión: v14.0
- Estado: todo
- Dependencias: ninguna

**Descripción:** Crear las tablas `despiece_plantilla` y `despiece_corte` con RLS, índices y triggers. Detalle de schema en sección 2.1 del plan. Archivo `supabase/migrations/136_despiece_plantilla.sql`.

**Criterios de aceptación:**
- [ ] Tabla `despiece_plantilla` creada con FK a `producto(id)` y `tenant(id)`.
- [ ] Tabla `despiece_corte` con `UNIQUE(plantilla_id, producto_hijo_id)`, columna `peso_promedio_unidad_kg` y constraint `chk_despiece_corte_peso_unidad`.
- [ ] RLS habilitado y 4 policies (`select`, `insert`, `update`, `delete`) por tabla, usando `current_tenant_id()` como en migraciones recientes (`131`, `134`).
- [ ] Triggers `moddatetime` para `updated_at` en ambas tablas.
- [ ] Índices: `idx_despiece_plantilla_padre` (UNIQUE), `idx_despiece_plantilla_tenant`, `idx_despiece_corte_unico` (UNIQUE), `idx_despiece_corte_tenant`, `idx_despiece_corte_plantilla` (incluye `orden`).
- [ ] `NOTIFY pgrst, 'reload schema'` al final.
- [ ] Tipos TypeScript regenerados en `src/types/database.ts`.

---

### V140-DESP-002 — Migración 137: campo es_despiece_padre en producto

- Tipo: migration
- Módulo: despiece
- Prioridad: critical
- Estimación: 1
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-001

**Descripción:** Agregar columna `es_despiece_padre BOOLEAN DEFAULT FALSE` a `producto` con índice parcial. Archivo `supabase/migrations/137_producto_es_despiece_padre.sql`.

**Criterios de aceptación:**
- [ ] Columna agregada con default false.
- [ ] Índice parcial `idx_producto_despiece_padre` con `WHERE es_despiece_padre = TRUE`.
- [ ] `NOTIFY pgrst` al final.
- [ ] Tipos TS regenerados.

---

### V140-DESP-003 — Migración 138: flag despiece_carniceria en modulo_config

- Tipo: migration
- Módulo: despiece
- Prioridad: high
- Estimación: 2
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-001

**Descripción:** Agregar `despiece_carniceria` al `modulo_config`, integrar al `activar_plan` y a los defaults de módulos en TypeScript. Archivo `supabase/migrations/138_modulo_config_despiece.sql`.

**Criterios de aceptación:**
- [ ] Columna `despiece_carniceria BOOLEAN DEFAULT FALSE` en `modulo_config`.
- [ ] Función `activar_plan` actualizada: activa el flag para los planes que lo incluyan (definir cuáles con producto antes de implementar).
- [ ] Defaults de módulos actualizados en TS (`src/lib/modulos/defaults.ts` o equivalente).
- [ ] `moduloGuard` cubre el módulo en route handlers.

---

### V140-DESP-003B — Migración 139: extender fusionar_productos para despiece

- Tipo: migration
- Módulo: despiece
- Prioridad: high
- Estimación: 3
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-001

**Descripción:** Reescribir `fusionar_productos` (introducida en migración `133`) para limpiar `despiece_corte` durante la fusión de productos hijos, y rechazar la fusión si alguno de los productos involucrados es padre de despiece. Archivo `supabase/migrations/139_fusionar_productos_despiece.sql`.

**Criterios de aceptación:**
- [ ] La función `fusionar_productos` borra filas duplicadas en `despiece_corte` antes de repuntar FKs.
- [ ] `RAISE EXCEPTION` si `s.es_despiece_padre = true` o `l.es_despiece_padre = true` con mensaje claro.
- [ ] Test de regresión: fusión de dos hijos del mismo despiece deja el survivor en la plantilla y elimina el loser; ninguna pérdida de FKs.
- [ ] Test de regresión: fusión cuando ninguno está en despiece se comporta igual que antes (no rompe el flow existente).

---

### V140-DESP-003C — Migración 140: catálogo de permisos de despiece

- Tipo: migration
- Módulo: despiece
- Prioridad: high
- Estimación: 2
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-001

**Descripción:** Insertar en `permiso` las claves `despiece.ver`, `despiece.editar`, `despiece.aplicar_precios` y asignarlas a roles base. Archivo `supabase/migrations/140_permisos_despiece.sql`. Sigue el patrón de la migración `134_usuario_permiso_contactos.sql`.

**Criterios de aceptación:**
- [ ] Tres claves nuevas en `permiso` con `ON CONFLICT DO NOTHING`.
- [ ] Asignación a roles `superadmin`, `admin`, `cajero`, `visor` para `despiece.ver`.
- [ ] Asignación a roles `superadmin`, `admin` para `despiece.editar` y `despiece.aplicar_precios`.
- [ ] Idempotente (correr dos veces no duplica).
- [ ] Resolver permiso efectivo en backend = `rol_permiso ∪ usuario_permiso`.

---

### V140-DESP-004 — Motor de cálculo puro: las 4 estrategias

- Tipo: feature
- Módulo: despiece
- Prioridad: critical
- Estimación: 8
- Versión: v14.0
- Estado: todo
- Dependencias: ninguna

**Descripción:** Implementar `src/lib/despiece/motor.ts` con función `calcular4Estrategias(input)` que devuelve precios y rentabilidades para las 4 estrategias. Sin side effects.

**Criterios de aceptación:**
- [ ] Función pura sin acceso a DB ni Supabase.
- [ ] Tipos completos en `tipos.ts`.
- [ ] Tests unitarios con los datos exactos de la planilla `Carnicerias.xlsx` (cerdo, pollo, vacuno) — validar que reproduce los números de la planilla con margen ≤ 0.5%.
- [ ] Validaciones en `validar.ts` cubren todos los edge cases (kg=0, factor=−1, sumas).
- [ ] Cobertura de tests > 90%.

---

### V140-DESP-005 — Endpoints CRUD de plantillas

- Tipo: feature
- Módulo: despiece
- Prioridad: high
- Estimación: 5
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-001, V140-DESP-003

**Descripción:** Implementar route handlers REST para `GET/POST/PUT/DELETE /api/despiece/plantillas[/id]`.

**Criterios de aceptación:**
- [ ] `getTenantSession` + `moduloGuard('despiece_carniceria')` en todos los endpoints.
- [ ] Validaciones del schema (Zod) con todos los checks de la sección 4.2.
- [ ] PUT con replace pattern para cortes (transaccional).
- [ ] Soft delete en DELETE (activo=false).
- [ ] Response shape consistente con otros endpoints del proyecto.
- [ ] Tests de integración con seeds.

---

### V140-DESP-006 — Endpoint stateless de cálculo

- Tipo: feature
- Módulo: despiece
- Prioridad: high
- Estimación: 2
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-004, V140-DESP-005

**Descripción:** `POST /api/despiece/calcular` que recibe el input completo y devuelve las 4 estrategias. No persiste nada.

**Criterios de aceptación:**
- [ ] Endpoint protegido por moduloGuard.
- [ ] Recibe el input, valida, llama al motor, devuelve resultado.
- [ ] Response < 100ms para inputs realistas.

---

### V140-DESP-007 — Aplicar estrategia: actualizar precios + historial

- Tipo: feature
- Módulo: despiece
- Prioridad: critical
- Estimación: 5
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-005

**Descripción:** `POST /api/despiece/plantillas/[id]/aplicar` que actualiza `producto.precio_venta` de los hijos según la estrategia elegida, y registra en `precio_historial` con origen `'despiece'`.

**Criterios de aceptación:**
- [ ] Transacción atómica: o se actualizan todos los productos o ninguno.
- [ ] Una fila en `precio_historial` por cada producto modificado.
- [ ] Soporta filtro `solo_cortes: string[]` para aplicar parcialmente.
- [ ] Response devuelve diff completo (anterior/nuevo) por producto.
- [ ] Origen `'despiece'` agregado al enum de `precio_historial.origen`.

---

### V140-DESP-008 — UI: editor de plantilla

- Tipo: feature
- Módulo: despiece
- Prioridad: high
- Estimación: 13
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-004, V140-DESP-005

**Descripción:** Pantalla `/dashboard/despiece/plantillas/[id]` con el layout de la sección 5.2.

**Criterios de aceptación:**
- [ ] Recálculo en vivo en el cliente usando el motor compartido (mismo `motor.ts`).
- [ ] Grilla editable con validaciones de cliente (kg ≥ 0, factor ∈ [−1, 5]).
- [ ] Resumen de las 3 estrategias visible siempre.
- [ ] Indicadores visuales de estados problemáticos (precio < costo, rentabilidad lejos del objetivo).
- [ ] Botón "Guardar" deshabilitado si hay errores de validación.
- [ ] Mobile: tabla responsive (acordeón por corte).

---

### V140-DESP-009 — UI: lista de plantillas + alta nueva

- Tipo: feature
- Módulo: despiece
- Prioridad: high
- Estimación: 5
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-008

**Descripción:** Pantalla `/dashboard/despiece/plantillas` con listado de plantillas del tenant + acción "Nueva plantilla".

**Criterios de aceptación:**
- [ ] Lista con búsqueda y filtros (animal, activo).
- [ ] Modal de creación: elegir producto padre, nombre, peso, rentab. objetivo.
- [ ] Al crear, redirige al editor para agregar cortes.

---

### V140-DESP-010 — UI: modal de aplicar estrategia

- Tipo: feature
- Módulo: despiece
- Prioridad: high
- Estimación: 3
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-007, V140-DESP-008

**Descripción:** Modal con preview de cambios antes de aplicar precios al catálogo. Muestra diff por producto (precio anterior vs nuevo) y permite deseleccionar cortes específicos.

**Criterios de aceptación:**
- [ ] Modal con tabla de cortes y checkbox por fila.
- [ ] Diff visible (anterior → nuevo, con %).
- [ ] Resumen de cuántos productos se afectan.
- [ ] Confirmación con texto explícito ("Esto va a cambiar el precio de venta de N productos").
- [ ] Toast de éxito y redirección al editor.

---

### V140-DESP-011 — UI: pantalla "Calcular rápido"

- Tipo: feature
- Módulo: despiece
- Prioridad: medium
- Estimación: 5
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-008

**Descripción:** Pantalla `/dashboard/despiece/calcular` que reusa el editor sin persistencia, con botón "Guardar como plantilla".

**Criterios de aceptación:**
- [ ] Misma UI que el editor pero sin guardado automático.
- [ ] El estado vive en el componente o en URL params para compartir links.
- [ ] Acción "Guardar como plantilla" abre modal de creación con datos prellenados.

---

### V140-DESP-012 — UI: dashboard consolidado

- Tipo: feature
- Módulo: despiece
- Prioridad: medium
- Estimación: 8
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-007

**Descripción:** Pantalla `/dashboard/despiece/dashboard` con la proyección mensual consolidada (sección 7).

**Criterios de aceptación:**
- [ ] Selector de período (mes en curso, mes anterior, custom).
- [ ] Inputs de cantidad proyectada por animal (persisten en `tenant_config` o tabla nueva).
- [ ] Sumatoria con embutidos/achuras (categorías configurables).
- [ ] Totales claros con formato de moneda local.
- [ ] Export a PDF / Excel del dashboard.

---

### V140-DESP-013 — Wiring de permisos en endpoints y UI

- Tipo: feature
- Módulo: despiece
- Prioridad: medium
- Estimación: 2
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-003C, V140-DESP-005, V140-DESP-008

**Descripción:** Conectar los permisos creados por la migración `140` (`despiece.ver`, `despiece.editar`, `despiece.aplicar_precios`) en route handlers y UI. La migración de catálogo ya está cubierta en `V140-DESP-003C`.

**Criterios de aceptación:**
- [ ] Endpoints `/api/despiece/*` chequean permiso efectivo (`rol_permiso ∪ usuario_permiso`) antes de operar.
- [ ] El editor de plantillas se renderiza en modo solo lectura si el usuario tiene `despiece.ver` pero no `despiece.editar`.
- [ ] El botón "Aplicar estrategia" se esconde si no tiene `despiece.aplicar_precios`.
- [ ] Pantalla de admin de usuarios permite otorgar permisos puntuales `despiece.*` por usuario vía `usuario_permiso`.
- [ ] Tests de integración con un usuario de cada rol cubren cada endpoint.

---

### V140-DESP-014 — Integración con ficha de producto

- Tipo: feature
- Módulo: despiece
- Prioridad: low
- Estimación: 3
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-008

**Descripción:** En la ficha de producto, mostrar tab "Despiece" si es padre, o badge "Pertenece a despiece" si es hijo.

**Criterios de aceptación:**
- [ ] Tab nuevo en `producto/editar` para padres.
- [ ] Listado de plantillas asociadas con link.
- [ ] Badge en hijos con link a la plantilla.

---

### V140-DESP-015 — Tests E2E del flujo completo

- Tipo: testing
- Módulo: despiece
- Prioridad: high
- Estimación: 5
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-007, V140-DESP-010

**Descripción:** Tests end-to-end con Playwright que cubren: crear plantilla → editar cortes → aplicar estrategia → verificar precios actualizados en catálogo + historial.

**Criterios de aceptación:**
- [ ] Test "happy path" completo.
- [ ] Test de edge cases (kg=0, factor extremo, plantilla sin cortes).
- [ ] Test de aislamiento por tenant (un tenant no ve plantillas de otro).
- [ ] Test de permisos (usuario sin permiso no puede aplicar precios).

---

### V140-DESP-016 — Documentación del módulo

- Tipo: docs
- Módulo: despiece
- Prioridad: medium
- Estimación: 2
- Versión: v14.0
- Estado: todo
- Dependencias: V140-DESP-008

**Descripción:** Crear `despiece.md` en project knowledge con la documentación del módulo (similar a `analizador.md`).

**Criterios de aceptación:**
- [ ] Visión general, flujo principal, modelo de datos, motor.
- [ ] Glosario de términos (factor, anclado, merma).
- [ ] Ejemplos de uso por animal con datos reales.
- [ ] Decisiones de producto y por qué.

---

## 9. Roadmap por fases

### Fase 1 — MVP (V140-DESP-001 a 003C, 004 a 010)
Migraciones (`136` a `140`), motor, UI básica y aplicar precios. Incluye tickets de fusión de productos extendida (`003B`) y catálogo de permisos (`003C`). Suficiente para reemplazar la planilla actual del carnicero. Estimación: ~55 puntos.

### Fase 2 — Productización (V140-DESP-011 a 016)
Calcular rápido, dashboard consolidado, integración con ficha de producto, tests E2E, docs. Los permisos ya están cubiertos en Fase 1 con `003C`. ~25 puntos.

### Fase 3 — Despiece transaccional (futuro)

Modelar la conversión real de stock: 1 media de cerdo entra → N kg de cada corte se incrementan, con merma trazable. Las piezas necesarias en el repo **ya existen tras las migraciones recientes**:

- `producto_lote_ingreso` (migración `119`) registra cada entrada de stock por proveedor con cantidad, vencimiento, costo y origen. El despiece transaccional se modela como **N filas en `producto_lote_ingreso`** (una por corte hijo) generadas en una sola transacción a partir de **1 entrada del padre**, todas con un `lote_padre_id` común que se agrega en una migración de Fase 3.
- `movimiento.proveedor_id` y `registrar_movimiento(..., p_proveedor_id)` (migración `120`) permiten que cada movimiento de stock generado por el despiece quede atado al proveedor del padre, manteniendo trazabilidad para `analizador_rentabilidad` y reportes.
- El nuevo `origen` para los lotes de despiece sería `'despiece'` (extendiendo el CHECK de `producto_lote_ingreso.origen`).

Requiere:
1. Migración nueva en `producto_lote_ingreso`: agregar `lote_padre_id UUID NULL REFERENCES producto_lote_ingreso(id)` y aceptar `origen = 'despiece'`.
2. RPC `despiezar_ingreso(plantilla_id, lote_padre_id)` que en una sola transacción:
   - Toma el lote padre.
   - Para cada corte de la plantilla, crea un movimiento `entrada` de `kg_rendimiento` × proporción y un lote hijo con `lote_padre_id` apuntando al padre.
   - Registra la merma como un movimiento `ajuste` negativo en el padre (los kg que se "pierden" en hueso, grasa descartada, jugo).
3. UI en la pantalla de "ingreso de animal" con preview y rendimiento real ajustado por evento (el carnicero puede editar `kg_rendimiento` del corte para esa entrada específica si las medias varían).

**No incluido en este plan**, se evalúa después del piloto de Fase 1 + 2.

### Fase 4 — Compras integradas (futuro)
Cuando el carnicero registra una factura del frigorífico con "1 media de cerdo $136.300", autocompletar la plantilla con costo nuevo, recalcular precios sugeridos y proponer aplicar. **No incluido**.

---

## 10. Notas finales

- **Idempotencia**: aplicar la misma estrategia dos veces seguidas sin cambios en cortes debería dar el mismo resultado. El historial registra cada aplicación pero solo crea fila en `precio_historial` si el precio realmente cambió.
- **Reversibilidad**: ofrecer "deshacer última aplicación" usando los registros de `precio_historial` con origen `despiece`.
- **Onboarding**: agregar al onboarding del tenant un paso opcional "¿Tu negocio es de carnicería?" que ofrezca activar el módulo y crear plantillas pre-cargadas para cerdo / pollo / vacuno con datos estándar editables.
- **Datasheet**: las plantillas pre-cargadas se construyen con los datos de la planilla `Carnicerias.xlsx` original, ya validada en una carnicería real.
