---
estado: 🔵 Planificado
version: v10.0
ultima_actualizacion: 2026-04-27
---

# BLOQUE K — v10.0 (MP QR — Cobro con Código QR de Mercado Pago)

---

## Contexto y objetivo

Integrar el POS de Nexus con el cobro vía **Código QR de Mercado Pago** (API "Pagos presenciales con QR" / `instore`). El comercio imprime **una sola vez** un QR estático que pega en el mostrador. Cuando el cajero presiona "Cobrar con QR" en el modal de cobro, el backend "carga" una orden con el monto exacto en ese QR fijo. El cliente escanea con su app de MP (o cualquier billetera con QR interoperable: Modo, Cuenta DNI, etc.), ve el monto **prefijado**, paga, y el POS registra la confirmación sin intervención manual.

**Diferencias clave con MP Point (Bloque G):**
- **No hay terminal física** — el cliente paga desde su propio celular
- **El QR del mostrador no cambia nunca** — siempre es el mismo, asociado a un `external_pos_id` (la "caja")
- **Costo del comercio: 0** — solo paga la comisión del pago (sin alquilar terminal)
- **Acepta cualquier billetera con QR interoperable** — no solo MP

**Requisito de negocio:** El comercio debe tener una cuenta de Mercado Pago activa y una "caja" (`external_pos_id`) creada en su panel de MP, con el QR estático impreso y pegado en el mostrador. La integración usa el mismo `access_token` que Checkout API / Point — si ya hizo el Bloque G, el token sirve.

**Stack de integración:**
- API MP QR: `https://api.mercadopago.com/instore/orders/qr/seller/collectors/{user_id}/pos/{external_pos_id}/qrs`
- Notificación: webhooks de MP (`topic=merchant_order`) → `/api/pagos/mp-qr/webhook`
- Tiempo real en el POS: Supabase Realtime (canal por `comprobante_id`, mismo patrón que Bloque G)

---

## Relación con el Bloque G (MP Point)

Este bloque es **gemelo** del Bloque G y comparte arquitectura, patrones y casi toda la UI base. Lo que se reutiliza:

- **Patrón de configuración por tenant** — mismo modelo de access token encriptado con `pgp_sym_encrypt`, mismo flujo "Verificar y guardar"
- **Patrón de cliente HTTP encapsulado** — factory function en `src/lib/mp-qr/client.ts` igual que `src/lib/mp-point/client.ts`
- **Patrón de webhook firmado** — verificación de firma, idempotencia, lookup por `external_reference`
- **Pantalla de espera con Realtime** — la misma UX, solo cambia el copy ("Esperando que el cliente escanee el QR..." en vez de "Esperando pago en terminal...")
- **Estado en `comprobante`** — patrón `pendiente_qr` análogo a `pendiente_posnet`

Lo que cambia respecto del Bloque G:
- **No hay concepto de "device" / "modo PDV/STANDALONE"** — la config es más simple
- **Se agrega `mp_user_id` y `mp_external_pos_id`** — identifican la caja en MP (el QR fijo)
- **El endpoint MP es diferente** (`PUT .../orders` para activar el QR, `DELETE .../orders` para liberarlo)
- **El webhook usa `topic=merchant_order`** y el flujo de consulta requiere dos pasos (merchant_order → payments)

**Orden de implementación recomendado:** Cerrar primero los tickets pendientes del Bloque G (`V70-MP-009`, `V70-MP-012`, `V70-MP-013`, `V70-MP-014`) antes de arrancar este bloque, para reutilizar helpers maduros (encriptación, webhook, Realtime).

---

## Fases del bloque

| Fase | Contenido | Tickets |
|------|-----------|---------|
| 1 | Migraciones y tipos | MPQR-001 → MPQR-002 |
| 2 | Cliente HTTP MP QR | MPQR-003 |
| 3 | APIs core (iniciar, webhook, cancelar, estado) | MPQR-004 → MPQR-007 |
| 4 | UI — Configuración por tenant | MPQR-008 → MPQR-009 |
| 5 | UI — Modal de cobro + pantalla de espera | MPQR-010 → MPQR-011 |
| 6 | Robustez y casos borde | MPQR-012 |
| 7 | Tests | MPQR-013 |

---

## FASE 1 — Migraciones y tipos

---

## V100-MPQR-001 — Migración: columnas MP QR en configuracion y estado en comprobante

- Tipo: migration
- Módulo: mp-qr
- Prioridad: critical
- Estimación: 3
- Versión: v10.0
- Estado: todo
- Dependencias: V70-MP-001

**Descripción:** Agregar las columnas necesarias para almacenar la configuración de MP QR por tenant (independiente de la config de MP Point — un tenant puede tener una, la otra, o ambas habilitadas) y el estado del cobro QR en el comprobante. También agrega el valor `qr_mp` al enum de métodos de pago y `pendiente_qr` al enum de estados del comprobante.

**Criterios de aceptación:**
- [ ] Archivo `supabase/migrations/0XX_mp_qr.sql` creado (verificar siguiente número disponible al implementar)
- [ ] Columnas en `configuracion`:
  - `mp_qr_access_token text` — token de producción de la cuenta MP del tenant (encriptado con `pgp_sym_encrypt` igual que `mp_point_access_token`)
  - `mp_qr_user_id text` — ID numérico del collector en MP (ej: `123456789`); aparece en el panel de la app
  - `mp_qr_external_pos_id text` — ID que el tenant define para la caja (ej: `CAJA01`); el QR físico está asociado a este ID
  - `mp_qr_webhook_secret text` — secret para verificar firma de webhooks de MP (puede ser el mismo que `mp_point_webhook_secret` si comparten app, pero se guarda por separado para flexibilidad)
  - `mp_qr_habilitado boolean DEFAULT false`
- [ ] Columnas en `comprobante`:
  - `mp_qr_order_id text` — ID de la orden creada en MP (`merchant_order.id`, llega en el webhook)
  - `mp_qr_payment_id bigint` — ID del pago aprobado en MP (llega en el webhook tras consultar la merchant_order)
- [ ] Valor `qr_mp` agregado al ENUM `metodo_pago` (o columna si es text)
- [ ] Estado `pendiente_qr` agregado al ENUM `estado_comprobante`
- [ ] RLS: las nuevas columnas de `configuracion` respetan la policy existente de `tenant_isolation`
- [ ] Índice `idx_comprobante_mp_qr_order` sobre `(tenant_id, mp_qr_order_id)` para correlacionar webhooks
- [ ] `supabase db push` ejecuta sin errores
- [ ] `supabase gen types typescript` actualizado

**Notas técnicas:** El `access_token` se encripta exactamente igual que `mp_point_access_token` — reutilizar `pgp_sym_encrypt(token, current_setting('app.encryption_key'))`. Importante: aunque un tenant puede usar el mismo access_token de MP para Point y QR, las columnas son independientes para que pueda configurar credenciales distintas si quiere (ej: una cuenta de MP para POS físico y otra para cobro online). El `mp_qr_external_pos_id` es lo que MP llama "ID de la caja" en su panel — es el identificador que viaja codificado en el QR físico del mostrador.

---

## V100-MPQR-002 — Regenerar tipos TypeScript post-migración

- Tipo: chore
- Módulo: mp-qr
- Prioridad: critical
- Estimación: 1
- Versión: v10.0
- Estado: todo
- Dependencias: V100-MPQR-001

**Descripción:** Ejecutar `supabase gen types typescript` para que los nuevos campos de `configuracion` y `comprobante` sean tipados correctamente en todo el proyecto. Crear archivo de tipos manuales para las respuestas de la API de MP QR.

**Criterios de aceptación:**
- [ ] `src/types/supabase.ts` regenerado con los nuevos campos
- [ ] `Configuracion` incluye `mp_qr_access_token`, `mp_qr_user_id`, `mp_qr_external_pos_id`, `mp_qr_webhook_secret`, `mp_qr_habilitado`
- [ ] `Comprobante` incluye `mp_qr_order_id`, `mp_qr_payment_id`
- [ ] Tipos `MpQrOrder`, `MpQrMerchantOrder`, `MpQrPayment`, `MpQrWebhookPayload` creados manualmente en `src/types/mp-qr.ts`
- [ ] `npm run build` compila sin errores de TypeScript

**Notas técnicas:** Crear `src/types/mp-qr.ts` con los tipos de respuesta de la API de MP que no vienen de Supabase:

```typescript
// src/types/mp-qr.ts

// Payload que se envía a MP para activar el QR con un monto
export interface MpQrCreateOrderPayload {
  external_reference: string;        // comprobante_id de Nexus
  title: string;                     // descripción visible al cliente, ej: "Venta #42"
  description?: string;
  notification_url?: string;         // override del webhook configurado a nivel app
  total_amount: number;              // total de la venta (no en centavos, en pesos)
  items: Array<{
    sku_number?: string;
    category?: string;
    title: string;
    description?: string;
    unit_price: number;
    quantity: number;
    unit_measure: 'unit';
    total_amount: number;
  }>;
}

// Respuesta de MP al crear la orden (200 OK)
export interface MpQrCreateOrderResponse {
  in_store_order_id: string;         // ID interno de MP
  qr: string;                        // datos crudos del QR (no se usa: el QR físico ya está impreso)
}

// Estructura de merchant_order que se consulta cuando llega el webhook
export interface MpQrMerchantOrder {
  id: number;
  status: 'opened' | 'closed' | 'expired';
  external_reference: string;        // nuestro comprobante_id
  preference_id?: string;
  payments: Array<{
    id: number;
    status: 'approved' | 'pending' | 'rejected' | 'cancelled' | 'refunded';
    status_detail: string;
    transaction_amount: number;
    payment_method_id: string;       // 'account_money', 'visa', 'master', etc.
    payment_type_id: string;         // 'account_money', 'credit_card', 'debit_card'
    date_approved?: string;
  }>;
  shipments: unknown[];
  total_amount: number;
  paid_amount: number;
  refunded_amount: number;
}

// Payload del webhook que envía MP (topic=merchant_order)
export interface MpQrWebhookPayload {
  resource: string;                  // URL completa del merchant_order, ej: https://api.mercadopago.com/merchant_orders/123
  topic: 'merchant_order' | 'payment';
}
```

---

## FASE 2 — Cliente HTTP

---

## V100-MPQR-003 — Servicio MP QR: cliente HTTP encapsulado

- Tipo: feature
- Módulo: mp-qr
- Prioridad: critical
- Estimación: 3
- Versión: v10.0
- Estado: todo
- Dependencias: V100-MPQR-002

**Descripción:** Crear el módulo `src/lib/mp-qr/client.ts` que encapsula todas las llamadas a la API de MP QR. Mismo patrón que `src/lib/mp-point/client.ts`: factory function que recibe credenciales y devuelve métodos.

**Criterios de aceptación:**
- [ ] Archivo `src/lib/mp-qr/client.ts` creado
- [ ] Función `getMpQrClient(accessToken: string, userId: string)` que devuelve un objeto con métodos:
  - `createOrder(externalPosId: string, payload: MpQrCreateOrderPayload): Promise<MpQrCreateOrderResponse>` — activa una orden en el QR estático (PUT a `/instore/orders/qr/seller/collectors/{user_id}/pos/{external_pos_id}/qrs`)
  - `getOrder(externalPosId: string): Promise<MpQrCreateOrderResponse>` — consulta la orden activa actual del QR (GET al mismo endpoint)
  - `cancelOrder(externalPosId: string): Promise<void>` — elimina la orden activa del QR (DELETE al mismo endpoint), liberando el QR para la próxima venta
  - `getMerchantOrder(merchantOrderId: number | string): Promise<MpQrMerchantOrder>` — consulta una merchant_order para obtener sus pagos (GET a `/merchant_orders/{id}`)
- [ ] Manejo de errores: si MP devuelve 4xx/5xx, lanzar `MpQrError` con `code`, `message` y `status` del body de MP
- [ ] Logs de cada llamada en `console.error` solo en caso de error (NO loguear el `access_token`)
- [ ] URL base: `https://api.mercadopago.com`
- [ ] Header `Authorization: Bearer {access_token}` en todas las llamadas
- [ ] Header `Content-Type: application/json` en PUT
- [ ] Tests unitarios del cliente con `fetch` mockeado: respuestas 200, errores 400 (datos mal formados), 404 (caja no existe), 401 (token inválido), 500 (MP caído)

**Notas técnicas:** Usar exactamente el mismo patrón que `src/lib/mp-point/client.ts`. El método `createOrder` usa **PUT** (no POST) — esto es importante porque PUT es idempotente y "reemplaza" la orden activa: si el cajero llama dos veces seguidas con el mismo `external_pos_id`, MP simplemente actualiza la orden, no crea dos. El total se envía como número decimal (no en centavos como Point), MP lo trata como pesos. Verificar que `Math.round(total * 100) / 100` no produzca punto flotante en montos típicos. El `external_pos_id` viene de la config del tenant, no se hardcodea.

```typescript
// Ejemplo de createOrder:
async createOrder(externalPosId: string, payload: MpQrCreateOrderPayload) {
  const url = `${BASE_URL}/instore/orders/qr/seller/collectors/${userId}/pos/${externalPosId}/qrs`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new MpQrError(body.message ?? 'Error al crear orden QR', body.error ?? 'unknown', res.status);
  }
  return res.json() as Promise<MpQrCreateOrderResponse>;
}
```

---

## FASE 3 — APIs core

---

## V100-MPQR-004 — API Route: iniciar cobro con QR

- Tipo: feature
- Módulo: mp-qr
- Prioridad: critical
- Estimación: 5
- Versión: v10.0
- Estado: todo
- Dependencias: V100-MPQR-003, V100-MPQR-001

**Descripción:** Endpoint que recibe el `comprobante_id` y el `total`, activa una orden con el monto exacto sobre el QR estático del tenant (vía `createOrder`), y actualiza el comprobante con el estado `pendiente_qr`. Es el disparador principal del flujo de cobro con QR.

**Criterios de aceptación:**
- [ ] `POST /api/pagos/mp-qr/iniciar` implementado
- [ ] Body: `{ comprobante_id: string, total: number }`
- [ ] Valida que el comprobante pertenece al tenant autenticado (vía RLS implícito + check explícito)
- [ ] Valida que el comprobante está en estado `borrador` o `emitido` (no ya pagado)
- [ ] Lee `mp_qr_access_token`, `mp_qr_user_id` y `mp_qr_external_pos_id` de `configuracion`
- [ ] Si alguno no está configurado: `400 { error: "Configuración de MP QR incompleta" }`
- [ ] Construye payload: `external_reference = comprobante_id`, `title = "Venta #{numero_orden}"`, `total_amount = total`, `items` con un único item agregado (no es necesario detallar cada producto al cliente)
- [ ] Llama a `client.createOrder(externalPosId, payload)`
- [ ] Actualiza `comprobante`: `estado = 'pendiente_qr'`. Nota: el `mp_qr_order_id` real (ID de merchant_order) llega después en el webhook — al iniciar solo guardamos el estado y el `external_reference` ya está implícito en el comprobante_id
- [ ] Responde `200 { estado: 'pendiente_qr' }`
- [ ] Si MP devuelve error: `503 { error: "...", mp_error_code: "..." }` — el comprobante NO cambia de estado
- [ ] Idempotencia: si el comprobante ya está en `pendiente_qr`, primero hace `cancelOrder` y luego crea la nueva — esto cubre el caso "el cajero clickeó dos veces" o "la venta anterior quedó colgada"
- [ ] Si el `external_pos_id` ya tiene una orden activa de **otro** comprobante (caso edge: dos cajeros en la misma caja): MP devuelve error y se devuelve `409 { error: "Hay una venta en curso en esta caja, esperá o cancelala" }`

**Notas técnicas:** Route en `src/app/api/pagos/mp-qr/iniciar/route.ts`. Reutilizar el helper de desencriptación de access_token de `src/lib/facturacion/arca/config.ts` (el mismo que usa Point). Loguear `comprobante_id` y `external_pos_id` para trazabilidad. El `numero_orden` para el `title` se lee del comprobante (es el correlativo interno que ya existe). **Importante:** en QR el monto va en pesos (decimal), no en centavos como Point — no multiplicar por 100.

---

## V100-MPQR-005 — API Route: webhook de confirmación MP QR

- Tipo: feature
- Módulo: mp-qr
- Prioridad: critical
- Estimación: 8
- Versión: v10.0
- Estado: todo
- Dependencias: V100-MPQR-004

**Descripción:** Endpoint público (sin sesión de usuario) que recibe las notificaciones de MP cuando el cliente paga, rechaza o cancela el cobro vía QR. Verifica la firma, consulta el estado real de la merchant_order, y cierra la venta actualizando el comprobante y notificando al frontend vía Realtime.

**Criterios de aceptación:**
- [ ] `POST /api/pagos/mp-qr/webhook` implementado como Route Handler público
- [ ] Acepta payloads con `topic: 'merchant_order'` (el principal) y opcionalmente `topic: 'payment'` (lo ignora si llega — el flujo de QR usa merchant_order como source of truth)
- [ ] Verificación de firma:
  - MP envía header `x-signature` con formato `ts={timestamp},v1={hash}`
  - Computar HMAC-SHA256 del template `id:{data.id};request-id:{x-request-id};ts:{timestamp};` con `mp_qr_webhook_secret` del tenant
  - Si la firma no coincide: `401 Unauthorized` y log de seguridad
  - Si no hay header `x-signature`: `401`
- [ ] Resolución del tenant: como el webhook no incluye tenant_id directamente, se resuelve buscando el comprobante por `external_reference` (que es nuestro comprobante_id) → tenant_id del comprobante → config del tenant para validar la firma
  - Como alternativa robusta: el endpoint puede recibir el `tenant_slug` como query param en la `notification_url` que se configuró al crear la orden, ej: `?tenant=acme`
- [ ] Llama a `client.getMerchantOrder(merchantOrderId)` para obtener el estado y los pagos
- [ ] Localiza el comprobante por `external_reference` de la merchant_order
- [ ] Si no se encuentra el comprobante: `200 OK` con log warning (puede ser un webhook duplicado o de otro sistema)
- [ ] Idempotencia: si el comprobante ya está `pagado` o `rechazado`, devolver `200 OK` sin reprocesar
- [ ] Lógica de actualización según estado de los pagos:
  - Si hay al menos un pago `approved` con `transaction_amount >= total_amount`: actualiza `comprobante` a estado `pagado` (o el equivalente final, según cómo el POS maneje el cierre tras MP Point — alinear con `V70-MP-006`), guarda `mp_qr_order_id` (merchant_order.id) y `mp_qr_payment_id`
  - Si todos los pagos están `rejected` o `cancelled`: vuelve `comprobante` a `borrador`, limpia `mp_qr_order_id`
  - Si los pagos siguen `pending` o no hay pagos aún: NO cambia el estado, devuelve `200 OK` (esperar siguiente webhook)
- [ ] Llama a `cancelOrder(externalPosId)` después de cerrar exitosamente para liberar el QR estático para la próxima venta
- [ ] Publica en Realtime al canal `comprobante-{id}` el evento `{ estado: 'aprobado' | 'rechazado' | 'cancelado', payment_type: 'qr' }`
- [ ] Responde `200 OK` SIEMPRE que el procesamiento haya sido exitoso (incluso si "no había nada que hacer"), `5xx` solo en errores graves para que MP reintente
- [ ] Loguea en una tabla `mp_qr_webhook_log` (opcional pero recomendado) cada notificación recibida con su resultado para debugging

**Notas técnicas:** Route en `src/app/api/pagos/mp-qr/webhook/route.ts`. Usar `createServiceRoleClient()` para tener acceso a todos los tenants sin sesión de usuario. **Diferencia importante con Point:** en Point, el webhook trae directamente el `payment_intent_id` y MP devuelve el estado en una sola llamada; en QR el webhook solo trae el `merchant_order_id` y hay que hacer GET a `/merchant_orders/{id}` para enterarse de qué pasó. Esto suma una llamada HTTP adicional pero es cómo funciona la API. **Crítico:** la `notification_url` que se configura al crear la orden (o a nivel app de MP) debe apuntar a este endpoint con HTTPS público — durante desarrollo usar ngrok como en `mp-point-webhook-ngrok.md`.

---

## V100-MPQR-006 — API Route: cancelar cobro QR

- Tipo: feature
- Módulo: mp-qr
- Prioridad: high
- Estimación: 3
- Versión: v10.0
- Estado: todo
- Dependencias: V100-MPQR-004

**Descripción:** Endpoint para que el cajero pueda cancelar una orden activa en el QR (antes de que el cliente pague). Llama a `cancelOrder` en MP, libera el QR estático y revierte el comprobante a `borrador`.

**Criterios de aceptación:**
- [ ] `POST /api/pagos/mp-qr/cancelar` implementado
- [ ] Body: `{ comprobante_id: string }`
- [ ] Requiere sesión autenticada y que el comprobante pertenezca al tenant
- [ ] Valida que el comprobante está en estado `pendiente_qr` — si no, `400`
- [ ] Llama a `client.cancelOrder(externalPosId)`
- [ ] Acepta que MP devuelva 404 si no había orden activa (idempotencia: el cliente ya pagó y MP la cerró sola, o nunca se llegó a crear)
- [ ] Actualiza `comprobante`: `estado = 'borrador'`, limpia `mp_qr_order_id`
- [ ] Publica en Realtime `{ estado: 'cancelado' }` para que el modal de espera lo detecte
- [ ] Responde `200 { mensaje: "Cobro cancelado" }`
- [ ] Si el cajero cancela mientras el cliente ya estaba pagando: hay race condition posible. El webhook puede llegar después con un pago `approved`. En ese caso el flujo del webhook debe **no sobrescribir** un comprobante en `borrador` post-cancelación si fue cancelado hace menos de X segundos — TODO: definir política (ver V100-MPQR-012)

**Notas técnicas:** Route en `src/app/api/pagos/mp-qr/cancelar/route.ts`. Después de cancelar, el carrito del POS queda intacto para reintentar con otro método. La diferencia con Point es que en QR el "cancelar" es siempre exitoso del lado de MP (es solo un DELETE de la orden), pero el pago puede haberse iniciado en el celular del cliente sin que MP nos haya notificado todavía. Por eso V100-MPQR-012 (robustez) tiene que cubrir este caso.

---

## V100-MPQR-007 — API Route: consultar estado del cobro QR

- Tipo: feature
- Módulo: mp-qr
- Prioridad: medium
- Estimación: 2
- Versión: v10.0
- Estado: todo
- Dependencias: V100-MPQR-004

**Descripción:** Endpoint de polling para casos donde el Realtime falla o el cajero quiere verificar manualmente el estado de un cobro en curso.

**Criterios de aceptación:**
- [ ] `GET /api/pagos/mp-qr/estado?comprobante_id=xxx` implementado
- [ ] Requiere sesión autenticada y que el comprobante pertenezca al tenant
- [ ] Lee el comprobante: si no está en `pendiente_qr`, devuelve directamente el estado actual (`pagado`, `rechazado`, `borrador`)
- [ ] Si está en `pendiente_qr`: llama a `client.getOrder(externalPosId)` para obtener la orden activa actual del QR
- [ ] Si la orden activa coincide con el comprobante (por `external_reference`): devuelve los datos crudos del QR (estado de la orden)
- [ ] Si no hay orden activa o es de otro comprobante: significa que el QR fue liberado (cliente pagó o expiró) — re-consulta merchant_orders del último minuto buscando `external_reference == comprobante_id` y devuelve su estado
- [ ] Responde `200 { estado, payment?, merchant_order? }`
- [ ] Si MP devuelve error: `503 { error: "..." }` — no marca el comprobante como problemático

**Notas técnicas:** Route en `src/app/api/pagos/mp-qr/estado/route.ts`. Este endpoint es idéntico en propósito a `V70-MP-012` pero adaptado al modelo de QR. Útil sobre todo en el caso "el cajero cierra el navegador y vuelve" (banner de cobro pendiente del POS). MP no tiene un endpoint directo "buscar merchant_orders por external_reference" — hay que filtrar por fecha + collector y buscar a mano. Si esto resulta caro, alternativa: guardar el `merchant_order_id` ni bien llega el primer webhook (aunque el pago aún esté pending), así sabemos a quién consultar después.

---

## FASE 4 — UI: Configuración por tenant

---

## V100-MPQR-008 — UI: Sección "Mercado Pago QR" en /configuracion

- Tipo: feature
- Módulo: mp-qr
- Prioridad: high
- Estimación: 5
- Versión: v10.0
- Estado: todo
- Dependencias: V100-MPQR-009

**Descripción:** Agregar una sección en `/configuracion` para que el dueño del negocio configure su integración con MP QR: ingresa el access token, el user_id de MP, el external_pos_id (caja) y activa/desactiva el módulo. La sección vive **al lado** de la sección de Mercado Pago Point (no la reemplaza).

**Criterios de aceptación:**
- [ ] Sección "Mercado Pago QR" visible en `/configuracion` (solo rol admin), separada visualmente de la sección de MP Point
- [ ] Toggle on/off `mp_qr_habilitado` con advertencia si se deshabilita en medio de una venta
- [ ] Campo de texto para `mp_qr_access_token` con tipo `password` (oculto por defecto, botón para mostrar)
- [ ] Botón "Verificar credenciales" que llama a `GET /api/pagos/mp-qr/verificar` (un endpoint trivial que solo valida que el access_token sea válido haciendo `GET /users/me` a MP)
  - Si el token es válido: muestra el `user_id` detectado y un toast verde "Credenciales válidas"
  - Si el token es inválido: toast rojo "Token inválido"
  - Loading state mientras valida
- [ ] Campo de texto para `mp_qr_user_id` (numérico) — autocompleta con el valor detectado por "Verificar credenciales" pero el admin puede sobreescribirlo
- [ ] Campo de texto para `mp_qr_external_pos_id` — texto libre, ej: `CAJA01`. Tooltip explicativo: "Es el ID de la caja en tu panel de Mercado Pago. Es el mismo identificador que está codificado en el QR físico que pegaste en el mostrador."
- [ ] Campo para `mp_qr_webhook_secret` — opcional, con tooltip: "Si ya configuraste webhooks para MP Point, podés usar el mismo secret aquí."
- [ ] Botón "Guardar" que llama a `PATCH /api/configuracion/mp-qr` con los valores
- [ ] Confirmación de guardado con toast verde
- [ ] Bloque de instrucciones expandible "¿Cómo configurar mi QR estático?" con los pasos:
  1. Crear caja en panel MP → Tu negocio → Cajas y sucursales → Crear caja
  2. Anotar el ID de la caja (ese es el `external_pos_id`)
  3. Imprimir el QR de la caja (PDF descargable desde el panel MP)
  4. Pegar el QR en el mostrador
  5. Volver a esta pantalla y completar los datos
- [ ] Link de ayuda externo: "¿Cómo obtener mi Access Token de MP?" → MP Developers
- [ ] Solo visible si el plan incluye `facturador_pos` (misma guard que el POS)

**Notas técnicas:** Componente en `src/components/configuracion/mp-qr-config.tsx`. El `access_token` nunca se devuelve completo desde el servidor — mostrar solo los últimos 4 caracteres si ya está guardado (mismo patrón que Point). La verificación de credenciales contra MP se hace server-side para no exponer el token al browser.

---

## V100-MPQR-009 — API Route: guardar y leer configuración MP QR

- Tipo: feature
- Módulo: mp-qr
- Prioridad: high
- Estimación: 2
- Versión: v10.0
- Estado: todo
- Dependencias: V100-MPQR-001

**Descripción:** Endpoints para persistir y recuperar la configuración de MP QR del tenant, con encriptación del access token en DB. Análogo a `V70-MP-009` para Point.

**Criterios de aceptación:**
- [ ] `PATCH /api/configuracion/mp-qr` — guarda los campos de MP QR
  - Body: `{ access_token?, user_id?, external_pos_id?, webhook_secret?, habilitado? }`
  - Encripta `access_token` con `pgp_sym_encrypt` antes de guardar (igual que ARCA y Point)
  - Solo admin puede llamarlo
  - Responde `200 { ok: true }`
- [ ] `GET /api/configuracion/mp-qr` — devuelve la config actual
  - NO devuelve el `access_token` completo — solo `access_token_configurado: boolean` + últimos 4 chars
  - Devuelve `user_id`, `external_pos_id`, `habilitado`, `webhook_secret_configurado: boolean`
  - Responde `200 { habilitado, user_id, external_pos_id, access_token_configurado, access_token_preview, webhook_secret_configurado }`
- [ ] `GET /api/pagos/mp-qr/verificar` — endpoint usado por el botón "Verificar credenciales"
  - Recibe el access_token candidato por body o query (NO lo persiste, solo lo prueba)
  - Hace `GET https://api.mercadopago.com/users/me` con `Authorization: Bearer {token}`
  - Si MP responde 200: devuelve `200 { ok: true, user_id, nickname, email }`
  - Si MP responde 401: devuelve `401 { ok: false, error: "Token inválido" }`
- [ ] Los tres endpoints requieren sesión autenticada y rol admin

**Notas técnicas:** Routes en `src/app/api/configuracion/mp-qr/route.ts` y `src/app/api/pagos/mp-qr/verificar/route.ts`. Reutilizar el helper de encriptación/desencriptación de `src/lib/facturacion/arca/config.ts`.

---

## FASE 5 — UI: Modal de cobro y pantalla de espera

---

## V100-MPQR-010 — UI: Botón "QR Mercado Pago" en modal de cobro

- Tipo: feature
- Módulo: mp-qr
- Prioridad: critical
- Estimación: 3
- Versión: v10.0
- Estado: todo
- Dependencias: V100-MPQR-004, V60-POS-021

**Descripción:** Agregar el botón "QR Mercado Pago" en el modal de cobro del POS (`cobro-modal.tsx`), visible únicamente si el tenant tiene MP QR habilitado. Convive con el botón "Posnet MP" del Bloque G — ambos pueden estar habilitados al mismo tiempo.

**Criterios de aceptación:**
- [ ] Botón "📱 QR Mercado Pago" visible en la grilla de métodos de pago del modal
- [ ] Solo se muestra si `mp_qr_habilitado === true` en la configuración del tenant (cargado en el contexto de configuración)
- [ ] Coexiste con "Posnet MP" sin conflicto — el cajero puede tener ambos métodos disponibles
- [ ] Al hacer click: deshabilita los demás métodos y muestra la pantalla de espera (ver V100-MPQR-011)
- [ ] El botón tiene ícono de QR y etiqueta clara
- [ ] En mobile/tablet: el botón tiene tamaño táctil adecuado (mínimo 48px de alto)
- [ ] Si MP QR está habilitado pero falta `external_pos_id` o `user_id` en config: el botón aparece pero al clickear muestra toast rojo "Configurá la caja en Configuración → Mercado Pago QR"

**Notas técnicas:** Se extiende `src/components/pos/cobro-modal.tsx`. Leer la config de MP QR desde el hook `useConfiguracion()` existente o un hook específico `useMpQrConfig()` análogo al de Point. No hacer fetch en este componente — el estado de habilitado debe venir del contexto.

---

## V100-MPQR-011 — UI: Pantalla de espera de pago QR

- Tipo: feature
- Módulo: mp-qr
- Prioridad: critical
- Estimación: 8
- Versión: v10.0
- Estado: todo
- Dependencias: V100-MPQR-010, V100-MPQR-005, V100-MPQR-006

**Descripción:** Implementar el estado de espera dentro del modal de cobro: al elegir "QR Mercado Pago", llama al endpoint de inicio, suscribe al canal de Realtime del comprobante, y actualiza la UI según el resultado (aprobado, rechazado, cancelado, error).

**Criterios de aceptación:**
- [ ] Al seleccionar "QR Mercado Pago", el modal transiciona a la pantalla de espera:
  - Ícono grande de QR (visual, no es el QR real — el QR real está en el mostrador)
  - Monto total grande y visible (ej: `$ 15.430,00`)
  - Texto principal: "Esperando que el cliente escanee el QR..."
  - Subtexto: "El monto ya está cargado en el QR del mostrador. Decile al cliente que abra Mercado Pago, Modo o cualquier billetera con QR y escanee."
  - Botón "Cancelar" visible
- [ ] Al montar la pantalla: llama automáticamente a `POST /api/pagos/mp-qr/iniciar`
  - Si falla (config incompleta, error de MP, caja ocupada): muestra error en pantalla con botón "Reintentar" y no cambia el estado del comprobante
- [ ] Suscripción a canal Supabase Realtime `comprobante-{id}` inmediatamente después del inicio exitoso
- [ ] Cuando llega evento `{ estado: 'aprobado' }` del canal:
  - Animación de éxito (check verde)
  - Texto: "¡Pago aprobado!" con el método de pago si está disponible (ej: "Mercado Pago — Saldo en cuenta", "Visa Crédito", etc.)
  - Avanza automáticamente a la pantalla final de éxito del modal (con número de comprobante, botones "Nueva venta" e "Imprimir")
- [ ] Cuando llega evento `{ estado: 'rechazado' }`:
  - Animación de error (X roja)
  - Texto: "Pago rechazado"
  - Botones: "Intentar de nuevo" (vuelve a la selección de método) y "Cancelar venta"
- [ ] Cuando llega evento `{ estado: 'cancelado' }`:
  - Vuelve a la selección de método sin mensaje de error (el cajero lo canceló)
- [ ] Botón "Cancelar" llama a `POST /api/pagos/mp-qr/cancelar`
  - Durante la cancelación: spinner en el botón, texto "Cancelando..."
  - Si el cliente ya está pagando (race condition): toast amarillo "El cliente puede estar pagando, esperá un momento"
- [ ] Timeout de seguridad: si pasan 5 minutos sin respuesta del Realtime, mostrar mensaje "El pago está tardando más de lo esperado." con opción de "Consultar estado" (llama a `GET /api/pagos/mp-qr/estado`)
- [ ] Cleanup: desuscribirse del canal de Realtime al desmontar el componente

**Notas técnicas:** Componente en `src/components/pos/mp-qr-espera.tsx`. Reutilizar la estructura de `mp-point-espera.tsx` (Bloque G) — el patrón es el mismo, solo cambian los textos y endpoints. La suscripción al canal debe hacerse ANTES de llamar al endpoint de inicio para no perder el evento si el webhook llega muy rápido (mismo cuidado que en Point). El timeout es más generoso que en Point (5 min vs 3 min) porque QR depende de que el cliente saque el celular, abra la app y escanee — más fricción que tap to pay.

---

## FASE 6 — Robustez y casos borde

---

## V100-MPQR-012 — Robustez: race conditions, reconexión y banner de cobro pendiente

- Tipo: feature
- Módulo: mp-qr
- Prioridad: high
- Estimación: 5
- Versión: v10.0
- Estado: todo
- Dependencias: V100-MPQR-005, V100-MPQR-006, V100-MPQR-011

**Descripción:** Cubrir los casos borde que diferencian QR de Point: el cliente paga desde su propio celular y eso introduce race conditions específicas (cancela el cajero / paga el cliente al mismo tiempo, expiración de la orden, navegador cerrado en medio del cobro).

**Criterios de aceptación:**
- [ ] **Race condition cancelar/pagar:** Si el cajero cancela y dentro de los 30 segundos siguientes llega un webhook con pago `approved` para ese mismo comprobante:
  - El webhook NO sobrescribe el estado `borrador` del comprobante a `pagado`
  - En su lugar, marca el comprobante con un flag `mp_qr_pago_huerfano = true` (columna nueva, opcional) y guarda el `mp_qr_payment_id`
  - Notifica al frontend (si está conectado) o queda como tarea pendiente: "Hay un pago de MP sin venta asociada — revisar"
  - El operador puede luego **reaplicar** ese pago a la venta o **devolverlo** desde una pantalla de gestión
- [ ] **Caja ocupada por otro flujo:** Si al iniciar un cobro QR, MP responde que ya hay una orden activa en esa caja (otro cajero o cobro colgado):
  - Mostrar mensaje claro "Esta caja tiene un cobro en curso. Esperá unos segundos o cancelalo desde la app de MP." con botón "Reintentar"
- [ ] **MP caído (5xx de la API):** Mensaje genérico de error con opción de usar otro método de pago
- [ ] **Pérdida de conexión del POS:** Si el POS pierde internet mientras espera el Realtime, mostrar banner "Sin conexión — el pago puede haberse completado. Verificá el estado." con botón "Verificar" que llama a `/api/pagos/mp-qr/estado` cuando se restaure la conexión
- [ ] **Reconexión del canal Realtime:** Si el canal se desconecta, reconectar automáticamente (Supabase Realtime tiene reconexión automática — verificar que el handler esté activo post-reconexión)
- [ ] **Comprobante en `pendiente_qr` al reabrir el POS:** Si el cajero cierra el navegador con un cobro pendiente y vuelve a abrir el POS, mostrar banner: "Hay un cobro QR pendiente de confirmación" con botón "Verificar estado" que llama a `/api/pagos/mp-qr/estado`
- [ ] **Doble click en "QR Mercado Pago":** bloquear el botón durante el proceso de inicio para evitar dos llamadas simultáneas (la idempotencia del backend lo cubre, pero la UI no debe permitirlo)
- [ ] **Expiración natural de la orden en MP:** Las órdenes QR expiran tras X minutos (definir según MP — en general 30 min). Si llega un webhook con `merchant_order.status == 'expired'` y el comprobante sigue en `pendiente_qr`: revertir a `borrador`

**Notas técnicas:** Las race conditions son lo más espinoso del flujo QR vs Point. En Point, el cajero tiene control físico de la terminal y puede ver lo que pasa; en QR, el cliente paga desde un dispositivo que el cajero no ve. La política de "pagos huérfanos" es la red de seguridad — preferimos guardar un pago descolgado que perderlo o aplicarlo a la venta equivocada. La pantalla de gestión de pagos huérfanos (que un admin pueda revisar) puede salir en una iteración posterior; por ahora alcanza con el flag y el log.

---

## FASE 7 — Tests

---

## V100-MPQR-013 — Tests unitarios y de integración MP QR

- Tipo: test
- Módulo: mp-qr
- Prioridad: high
- Estimación: 8
- Versión: v10.0
- Estado: todo
- Dependencias: V100-MPQR-005, V100-MPQR-006, V100-MPQR-004

**Descripción:** Suite completa de tests que cubren el cliente HTTP de MP QR, los endpoints de Nexus y el flujo end-to-end de cobro con QR estático con mocks de la API de MP.

**Criterios de aceptación:**
- [ ] **Cliente HTTP** (`src/lib/mp-qr/client.test.ts`):
  - `createOrder` con respuesta 200 → devuelve la orden parseada
  - `createOrder` con respuesta 401 → lanza `MpQrError` con `status=401`
  - `createOrder` con respuesta 400 (caja inexistente) → lanza error con mensaje claro
  - `cancelOrder` con respuesta 404 → no lanza (idempotencia)
  - `getMerchantOrder` parsea correctamente la lista de pagos
- [ ] **Endpoint iniciar** (`src/app/api/pagos/mp-qr/iniciar/route.test.ts`):
  - Comprobante de otro tenant → 404
  - Comprobante ya pagado → 400
  - Config incompleta → 400
  - Camino feliz → 200, comprobante pasa a `pendiente_qr`
  - MP devuelve 503 → 503, comprobante NO cambia
  - Idempotencia: dos llamadas seguidas → la segunda cancela la primera y crea nueva
- [ ] **Webhook** (`src/app/api/pagos/mp-qr/webhook/route.test.ts`):
  - Sin firma válida → 401
  - Firma válida + merchant_order con pago approved → comprobante pasa a `pagado`
  - Firma válida + merchant_order con pago rejected → comprobante vuelve a `borrador`
  - Webhook duplicado para comprobante ya `pagado` → 200, no reprocesa
  - merchant_order con pago `pending` → 200, no cambia estado, espera siguiente webhook
  - Race condition: comprobante en `borrador` post-cancelación + webhook con pago approved → marca como pago huérfano
- [ ] **Cancelar** (`src/app/api/pagos/mp-qr/cancelar/route.test.ts`):
  - Comprobante en `pendiente_qr` → cancela en MP, vuelve a `borrador`
  - Comprobante en otro estado → 400
  - MP devuelve 404 al cancelar → idempotencia, igual vuelve el comprobante a `borrador`
- [ ] **Estado** (`src/app/api/pagos/mp-qr/estado/route.test.ts`):
  - Comprobante en `pagado` → devuelve estado directo sin llamar a MP
  - Comprobante en `pendiente_qr` con orden activa → devuelve la orden
  - Comprobante en `pendiente_qr` sin orden activa (cliente ya pagó pero webhook no llegó) → consulta merchant_orders y devuelve

**Notas técnicas:** Reutilizar los helpers de mock de fetch usados en los tests de MP Point (`V70-MP-014`). Los tests de webhook deben cubrir explícitamente el caso de la firma — se construye el HMAC con un secret de test conocido y se verifica que el endpoint lo acepta. Los tests de race condition son los más importantes: el escenario "cajero cancela + cliente paga" debe estar cubierto sí o sí.

---

## Apéndice — Cómo configurar MP QR en producción

Pasos que tiene que seguir el dueño del comercio (no el dev):

1. **Acceder al panel de Mercado Pago Developers** — https://www.mercadopago.com.ar/developers
2. **Usar app existente o crear nueva** — si ya hay una app para Checkout API o MP Point, sirve. Verificar que tenga permisos de **"Pagos presenciales con QR"** habilitados.
3. **Obtener Access Token de producción** — desde el panel de la app → Credenciales de producción → `access_token`.
4. **Crear caja en MP** — desde el panel principal de MP (no developers): Tu negocio → Cajas y sucursales → Crear caja. Anotar el **ID de la caja** (es el `external_pos_id`).
5. **Imprimir el QR estático** — en la misma sección de cajas, descargar el PDF del QR (en general un PDF tamaño A5 con el QR + nombre del comercio). Imprimirlo y plastificarlo. Pegarlo en el mostrador a la vista del cliente.
6. **Configurar webhook en MP Developers** — en el panel de la app → Webhooks → agregar la URL: `https://tudominio.com/api/pagos/mp-qr/webhook`. Anotar el `webhook_secret` que MP genera.
7. **Configurar en Nexus** — ir a Configuración → Mercado Pago QR, completar:
   - Access Token (lo del paso 3)
   - User ID (se autocompleta con "Verificar credenciales", o se copia del panel MP)
   - External POS ID (lo del paso 4)
   - Webhook Secret (lo del paso 6)
8. **Probar** — abrir el POS, agregar un producto, presionar COBRAR, elegir "QR Mercado Pago". El cajero pide al cliente que escanee el QR del mostrador con su app de MP. Verificar que el monto aparece prefijado en la app del cliente y que tras pagar, el POS confirma la venta.

---

## Apéndice — ngrok para desarrollo local

El webhook de MP necesita una URL pública HTTPS. Para desarrollar local, usar el mismo flujo que `mp-point-webhook-ngrok.md`:

```bash
ngrok http 3000
```

URL del webhook a registrar en MP Developers:
```
https://<SUBDOMINIO_NGROK>/api/pagos/mp-qr/webhook
```

**Importante:** si ya tenés un webhook configurado para MP Point en la misma app, podés tener **dos webhooks distintos** (uno para `topic=point_integration_wh` y otro para `topic=merchant_order`) o **un único webhook** que demultiplexa por topic — esto es decisión de implementación. Lo más simple para mantener separados los flujos es webhook separado por endpoint, como se planteó en este plan.