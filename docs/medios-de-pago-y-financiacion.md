---
estado: listo
version: v1
ultima_actualizacion: 2026-04-20
---

# Medios de pago, atajos rápidos y pago mixto

Este documento describe cómo se configuran los medios de pago, los recargos o descuentos por método (atajos del POS) y la lógica de **pago mixto**: montos parciales por canal, suma igual al total de mercadería y ajuste fiscal unificado (PDF, comprobante en base de datos y ARCA cuando aplica).

La implementación vive principalmente en:

- `src/lib/facturacion/financiacion.ts` — `aplicarFinanciacion`, `aplicarFinanciacionMixto`
- `src/lib/facturacion/emitir-comprobante.ts` — carga de opciones, validación y emisión
- `src/components/pos/cobro-modal.tsx` — UI del POS (rápido / planes / mixto)

---

## Conceptos

| Término | Significado |
|--------|-------------|
| **Total de mercadería** | Total del comprobante **antes** de aplicar recargos o descuentos por medio de pago (`importes.total` tras `calcularImportes`). En el POS se muestra como base para repartir el pago mixto. |
| **Ajuste por medio** | Porcentaje configurado por tenant para cada código de atajo (`efectivo`, `débito`, etc.): positivo = recargo, negativo = descuento, aplicado sobre el **monto asignado** a ese medio (no sobre el total de mercadería en pago mixto). |
| **Total a cobrar** | Mercadería + ajuste neto cuando hay recargo o descuento por medios. Es el `total` final del comprobante tras `aplicarFinanciacion` / `aplicarFinanciacionMixto`. |

---

## Configuración en base de datos

### Medios de pago y opciones (cuotas / recargo)

Definidos en la migración `038_medios_pago_financiacion.sql` (tablas `medio_pago`, `medio_pago_opcion`, columnas extra en `comprobante`, etc.). Permiten planes por medio (por ejemplo 3 cuotas con recargo) desde **Configuración → Medios de pago**.

### Atajos rápidos del POS (`medio_pago_rapido`)

Migración: `039_medio_pago_rapido.sql`.

- Una fila por `(tenant_id, codigo)` con `recargo_porcentaje`.
- Códigos permitidos: `efectivo`, `debito`, `credito`, `transferencia`, `mixto`.
- El código **`mixto` en la tabla** no se usa para calcular un único % sobre el total en el flujo de pago mixto detallado; el cálculo usa los % de **efectivo, débito, crédito y transferencia** sobre cada monto parcial.

La pantalla de configuración expone estos valores; las APIs bajo `/api/configuracion/medios-de-pago` incluyen y actualizan los atajos (`rapidos`).

---

## Flujos de cobro

### 1. POS — pestaña «Rápido», un solo método

Se aplica el % del atajo correspondiente al método elegido sobre **toda** la mercadería (comportamiento clásico de un solo medio).

### 2. POS — pestaña «Planes (cuotas)»

Se envía `medio_pago_opcion_id`. La financiación viene de `medio_pago_opcion` (y el medio relacionado), no de los atajos rápidos.

### 3. Pago mixto (`metodo_pago: 'mixto'`)

1. El usuario reparte importes en **efectivo, débito, crédito y transferencia** (cuatro montos ≥ 0).
2. La **suma** de esos cuatro montos debe coincidir con el **total de mercadería** del comprobante (tolerancia ±0,02 en validación servidor/cliente).
3. El **ajuste neto** es la suma de  
   `monto_i × (recargo_porcentaje_i / 100)`  
   para cada canal con monto &gt; 0, usando los % de `medio_pago_rapido` por código.

**Ejemplo**

- Mercadería: **$1.000**
- $400 efectivo con atajo **−10%** → −$40  
- $600 débito con atajo **+15%** → +$90  
- Ajuste neto: **+$50** → total final **$1.050**

En el POS, el «total a cobrar» se calcula con la misma lógica proporcional cuando el método es mixto.

---

## Tratamiento fiscal (facturación / ARCA)

`aplicarFinanciacionMixto`:

1. Calcula el ajuste neto y arma una descripción detallada por línea.
2. Si el ajuste neto es ~0, delega en financiación nula (total = mercadería).
3. Si no, convierte el ajuste neto en un **porcentaje sintético** respecto del total de mercadería y reutiliza `aplicarFinanciacion` para mantener el mismo criterio que un solo medio: recargo vía tributo 99 / importes según reglas existentes, descuento escalando neto/IVA cuando corresponde.

Así el PDF, el registro en `comprobante` y el pedido de CAE (si el módulo ARCA está activo) quedan alineados con el mismo número final.

En emisión, si `metodo_pago === 'mixto'`:

- Se exige `metodo_pago_detalle` válido.
- **No** se usa `cargarFinanciacionRapida('mixto')` ni se aplica una opción de catálogo a ese cálculo; `medio_pago_opcion_id` se guarda en `null` para ese comprobante.
- Se persisten `metodo_pago = 'mixto'`, el detalle en `metodo_pago_detalle` (JSON) y los campos de financiación (`total_mercaderia`, `financiacion_*`).

---

## API de emisión

`POST /api/facturacion/emitir` acepta, entre otros:

| Campo | Uso |
|-------|-----|
| `metodo_pago` | `efectivo` \| `debito` \| `credito` \| `transferencia` \| `mixto` |
| `metodo_pago_detalle` | Objeto con claves `efectivo`, `debito`, `credito`, `transferencia` (números). Obligatorio y validado cuando `metodo_pago` es `mixto`. |
| `medio_pago_opcion_id` | Opción de plan de cuotas; incompatible con el guardado de opción en el mismo comprobante cuando el flujo es mixto (ver arriba). |

---

## Pruebas automatizadas

`src/test/financiacion-mixto.test.ts` cubre el ejemplo numérico 400 / 600 con −10% / +15% sobre base 1000.

---

## Resolución de problemas

### Error: no existe la tabla `medio_pago_rapido`

La migración `039` no está aplicada en el proyecto Supabase remoto. Opciones: `npx supabase db push` o ejecutar el SQL de `039_medio_pago_rapido.sql` en el SQL Editor. Luego recargar el esquema de PostgREST (por ejemplo `NOTIFY pgrst, 'reload schema';` o desde Ajustes del proyecto → API → Reload schema) para que el cliente reconozca la tabla.

### La suma de montos «no cierra» en mixto

El backend compara contra el **total de mercadería** calculado en servidor (`calcularImportes`), no contra un total ya recargado. El cliente debe enviar montos que sumen ese total (misma tolerancia que arriba).

---

## Documentación relacionada

- [Facturación general](./facturacion.md) — PDF, numeración, stock
- [ARCA](./arca.md) — CAE, WSFE, tributos
