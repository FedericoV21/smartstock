---
estado: 🔵 Planificado
version: v7.0
ultima_actualizacion: 2026-04-20
---

# BLOQUE G — v7.0 (MP Point — Terminal física Mercado Pago)

---

## Contexto y objetivo

Integrar el POS de Nexus con las terminales físicas de **Mercado Pago Point** (Smart, Plus, Pro, Mini NFC) mediante la API oficial de cobros presenciales. El cajero presiona "Cobrar con Posnet" en el modal de cobro, la terminal recibe la orden automáticamente, el cliente paga con lo que quiera (tarjeta débito/crédito, NFC, QR interoperable, etc.) y el POS registra la confirmación sin intervención manual.

**Requisito de negocio:** El comercio debe tener al menos una terminal MP Point asociada a su cuenta de Mercado Pago. La integración usa la misma lógica de `access_token` que Checkout API/Pro — no requiere certificados ni configuración especial de MP.

**Stack de integración:**
- API MP Point: `https://api.mercadopago.com/point/integration-api/`
- Notificación: webhooks de MP → `/api/pagos/mp-point/webhook`
- Tiempo real en el POS: Supabase Realtime (canal por `comprobante_id`)

---

## Fases del bloque

| Fase | Contenido | Tickets |
|------|-----------|---------|
| 1 | Migraciones y tipos | MP-001 → MP-003 |
| 2 | APIs core (iniciar, webhook, cancelar) | MP-004 → MP-007 |
| 3 | UI — Configuración por tenant | MP-008 → MP-009 |
| 4 | UI — Modal de cobro + pantalla de espera | MP-010 → MP-011 |
| 5 | Robustez y casos borde | MP-012 → MP-013 |
| 6 | Tests | MP-014 |

---

## FASE 1 — Migraciones y tipos

---

## V70-MP-001 — Migración: columnas MP Point en configuracion y estado en comprobante

- Tipo: migration
- Módulo: mp-point
- Prioridad: critical
- Estimación: 3
- Versión: v7.0
- Estado: todo
- Dependencias: V60-POS-015

**Descripción:** Agregar las columnas necesarias para almacenar la configuración de MP Point por tenant y el estado del payment intent en el comprobante. También agrega el valor `posnet_mp` al enum de métodos de pago y `pendiente_posnet` al enum de estados del comprobante.

**Criterios de aceptación:**
- [ ] Archivo `supabase/migrations/028_mp_point.sql` creado
- [ ] Columnas en `configuracion`:
  - `mp_point_access_token text` — token de producción de la cuenta MP del tenant (encriptado con `pgp_sym_encrypt` igual que `arca_config.clave_privada_pem`)
  - `mp_point_device_id text` — ID de la terminal seleccionada (ej: `PAX_A910__SMARTPOS123456`)
  - `mp_point_webhook_secret text` — secret para verificar firma de webhooks de MP
  - `mp_point_habilitado boolean DEFAULT false`
- [ ] Columnas en `comprobante`:
  - `mp_point_intent_id text` — ID del payment intent creado en MP (para correlacionar webhook)
  - `mp_point_payment_id bigint` — ID del pago aprobado en MP (llega en el webhook)
- [ ] Valor `posnet_mp` agregado al ENUM `metodo_pago` (o columna si es text)
- [ ] Estado `pendiente_posnet` agregado al ENUM `estado_comprobante`
- [ ] RLS: las nuevas columnas de `configuracion` respetan la policy existente de `tenant_isolation`
- [ ] `supabase db push` ejecuta sin errores
- [ ] `supabase gen types typescript` actualizado

**Notas técnicas:** El `access_token` debe encriptarse en DB igual que las claves de ARCA. Usar `pgp_sym_encrypt(token, current_setting('app.encryption_key'))`. El `mp_point_intent_id` se usa como clave de correlación entre el webhook y el comprobante — agregar índice `idx_comprobante_mp_intent` sobre `(tenant_id, mp_point_intent_id)`.

---

## V70-MP-002 — Regenerar tipos TypeScript post-migración

- Tipo: chore
- Módulo: mp-point
- Prioridad: critical
- Estimación: 1
- Versión: v7.0
- Estado: todo
- Dependencias: V70-MP-001

**Descripción:** Ejecutar `supabase gen types typescript` para que los nuevos campos de `configuracion` y `comprobante` sean tipados correctamente en todo el proyecto.

**Criterios de aceptación:**
- [ ] `src/types/supabase.ts` regenerado con los nuevos campos
- [ ] `Configuracion` incluye `mp_point_access_token`, `mp_point_device_id`, `mp_point_habilitado`, etc.
- [ ] `Comprobante` incluye `mp_point_intent_id`, `mp_point_payment_id`
- [ ] Tipos `MpPointDevice` y `MpPointPaymentIntent` creados manualmente en `src/types/mp-point.ts`
- [ ] `npm run build` compila sin errores de TypeScript

**Notas técnicas:** Crear `src/types/mp-point.ts` con los tipos de respuesta de la API de MP que no vienen de Supabase:

```typescript
// src/types/mp-point.ts

export interface MpPointDevice {
  id: string;                    // "PAX_A910__SMARTPOS123456"
  operating_mode: 'PDV' | 'STANDALONE';
  pos_id: number;
  store_id: string;
  external_pos_id: string;
  name?: string;
}

export interface MpPointPaymentIntent {
  id: string;
  state: 'OPEN' | 'ON_TERMINAL' | 'PROCESSING' | 'FINISHED' | 'CANCELED' | 'ERROR';
  amount: number;
  payment?: {
    id: number;
    state: 'approved' | 'rejected' | 'cancelled' | 'error';
    type: string;                // "credit_card", "debit_card", "qr", etc.
  };
  additional_info: {
    external_reference: string;  // nuestro comprobante_id
    print_on_terminal: boolean;
  };
}

export interface MpPointWebhookPayload {
  type: 'point_integration_wh';
  action: string;                // "payment_intent.state_update"
  data: {
    id: string;                  // payment_intent_id
  };
}
```

---

## V70-MP-003 — Servicio MP Point: cliente HTTP encapsulado

- Tipo: feature
- Módulo: mp-point
- Prioridad: critical
- Estimación: 3
- Versión: v7.0
- Estado: todo
- Dependencias: V70-MP-002

**Descripción:** Crear el módulo `src/lib/mp-point/client.ts` que encapsula todas las llamadas a la API de MP Point. Centraliza la URL base, el `Authorization` header y el manejo de errores de MP.

**Criterios de aceptación:**
- [ ] Archivo `src/lib/mp-point/client.ts` creado
- [ ] Función `getMpPointClient(accessToken: string)` que devuelve un objeto con métodos:
  - `listDevices(): Promise<MpPointDevice[]>` — lista los posnet de la cuenta
  - `setDeviceMode(deviceId: string, mode: 'PDV' | 'STANDALONE'): Promise<void>` — cambia el modo operativo
  - `createPaymentIntent(deviceId: string, payload: CreateIntentPayload): Promise<MpPointPaymentIntent>` — crea la orden en el posnet
  - `getPaymentIntent(deviceId: string, intentId: string): Promise<MpPointPaymentIntent>` — consulta el estado
  - `cancelPaymentIntent(deviceId: string, intentId: string): Promise<void>` — cancela la orden
- [ ] Manejo de errores: si MP devuelve 4xx/5xx, lanzar `MpPointError` con `code` y `message` del body de MP
- [ ] Logs de cada llamada en `console.error` solo en caso de error (no loguear el `access_token`)
- [ ] URL base: `https://api.mercadopago.com/point/integration-api`
- [ ] Tests unitarios del cliente con fetch mockeado (respuestas 200 y errores 400/500)

**Notas técnicas:** Usar el mismo patrón que `src/lib/facturacion/arca/wsaa.ts` — un factory function que recibe credenciales y devuelve métodos. Nunca hardcodear el token. El payload de `createPaymentIntent`:

```typescript
interface CreateIntentPayload {
  amount: number;          // en centavos (total * 100, sin decimales)
  additional_info: {
    external_reference: string;   // comprobante_id de Nexus
    print_on_terminal: boolean;   // true → MP imprime ticket en el posnet
    tip_amount?: number;
  };
}
```

---

## FASE 2 — APIs core

---

## V70-MP-004 — API Route: listar devices del tenant

- Tipo: feature
- Módulo: mp-point
- Prioridad: high
- Estimación: 2
- Versión: v7.0
- Estado: todo
- Dependencias: V70-MP-003

**Descripción:** Endpoint que consulta la API de MP con el `access_token` del tenant y devuelve la lista de terminales asociadas a su cuenta. Se usa desde la pantalla de configuración para que el usuario pueda seleccionar su posnet.

**Criterios de aceptación:**
- [ ] `GET /api/pagos/mp-point/devices` implementado
- [ ] Requiere sesión autenticada (guard de auth)
- [ ] Lee `mp_point_access_token` de `configuracion` del tenant actual (desencriptando)
- [ ] Si el token no está configurado: responde `400 { error: "Token de MP no configurado" }`
- [ ] Llama a `client.listDevices()` y devuelve el array de `MpPointDevice`
- [ ] Transforma la respuesta para exponer solo: `id`, `name`, `operating_mode`, `external_pos_id`
- [ ] Si MP devuelve error de autenticación (401): responde `400 { error: "Token de MP inválido o vencido" }`
- [ ] Guard de módulo: requiere `mp_point_habilitado` (o rol admin para configurarlo)

**Notas técnicas:** Route en `src/app/api/pagos/mp-point/devices/route.ts`. El desencriptado del token sigue el mismo patrón que `src/lib/facturacion/arca/config.ts`.

---

## V70-MP-005 — API Route: iniciar cobro en terminal

- Tipo: feature
- Módulo: mp-point
- Prioridad: critical
- Estimación: 5
- Versión: v7.0
- Estado: todo
- Dependencias: V70-MP-003, V70-MP-001

**Descripción:** Endpoint que recibe el `comprobante_id` y el `total`, crea un payment intent en MP y actualiza el comprobante en DB con el `intent_id` y el estado `pendiente_posnet`. Es el disparador principal del flujo de cobro presencial.

**Criterios de aceptación:**
- [ ] `POST /api/pagos/mp-point/iniciar` implementado
- [ ] Body: `{ comprobante_id: string, total: number }`
- [ ] Valida que el comprobante pertenece al tenant autenticado
- [ ] Valida que el comprobante está en estado `borrador` o `emitido` (no ya pagado)
- [ ] Lee `mp_point_access_token` y `mp_point_device_id` de `configuracion`
- [ ] Si alguno no está configurado: `400 { error: "Configuración de MP Point incompleta" }`
- [ ] Llama a `client.createPaymentIntent(deviceId, { amount: total * 100, additional_info: { external_reference: comprobante_id, print_on_terminal: true } })`
- [ ] Actualiza `comprobante` con `mp_point_intent_id = intent.id` y `estado = 'pendiente_posnet'`
- [ ] Responde `200 { intent_id, estado: 'pendiente_posnet' }`
- [ ] Si MP devuelve error (device offline, device ocupado, etc.): `503 { error: "...", mp_error_code: "..." }` — el comprobante NO cambia de estado
- [ ] Si el device está en modo `STANDALONE` (no `PDV`): error descriptivo indicando que hay que cambiar el modo en la configuración
- [ ] Idempotencia: si el comprobante ya tiene un `intent_id` activo (`OPEN` o `ON_TERMINAL`), cancelarlo primero antes de crear uno nuevo

**Notas técnicas:** Route en `src/app/api/pagos/mp-point/iniciar/route.ts`. El monto se envía en centavos enteros — verificar que `Math.round(total * 100)` no produzca punto flotante. Loguear `intent_id` y `comprobante_id` para trazabilidad.

---

## V70-MP-006 — API Route: webhook de confirmación MP

- Tipo: feature
- Módulo: mp-point
- Prioridad: critical
- Estimación: 8
- Versión: v7.0
- Estado: todo
- Dependencias: V70-MP-005

**Descripción:** Endpoint público (sin sesión de usuario) que recibe las notificaciones de MP cuando el cliente paga, rechaza o cancela en el posnet. Verifica la firma, consulta el estado real del intent, y cierra la venta actualizando el comprobante y notificando al frontend.

**Criterios de aceptación:**
- [ ] `POST /api/pagos/mp-point/webhook` implementado — sin guard de auth (es llamado por MP)
- [ ] Verificación de firma HMAC-SHA256: header `x-signature` de MP comparado con `mp_point_webhook_secret` del tenant
  - El tenant se identifica por `external_reference` (= `comprobante_id`) extraído del body
  - Si la firma no matchea: responde `401` sin procesar nada
- [ ] Responde `200` inmediatamente antes de procesar (MP espera respuesta rápida para no reintentar)
- [ ] Procesamiento asíncrono post-respuesta:
  1. Buscar `comprobante` por `mp_point_intent_id` que coincida con `data.id` del webhook
  2. Consultar estado real: `client.getPaymentIntent(deviceId, intentId)`
  3. Si `state === 'FINISHED' && payment.state === 'approved'`:
     - Actualizar `comprobante`: `estado = 'emitido'`, `mp_point_payment_id = payment.id`, `metodo_pago = 'posnet_mp'`
     - Emitir ticket (llamar internamente a la lógica de `emitir-comprobante.ts` si el comprobante era `borrador`)
     - Descontar stock si no se hizo antes
     - Publicar en canal Supabase Realtime: `comprobantes:${comprobante_id}` con payload `{ estado: 'aprobado', payment_id }`
  4. Si `state === 'FINISHED' && payment.state !== 'approved'` (rechazado):
     - Actualizar `comprobante`: `estado = 'borrador'`, limpiar `mp_point_intent_id`
     - Publicar en Realtime: `{ estado: 'rechazado', motivo: payment.state }`
  5. Si `state === 'CANCELED'`:
     - Revertir a `borrador`, limpiar intent
     - Publicar en Realtime: `{ estado: 'cancelado' }`
  6. Si `state === 'ERROR'`:
     - Log del error, revertir a `borrador`
     - Publicar en Realtime: `{ estado: 'error' }`
- [ ] Idempotencia: si el webhook llega duplicado (MP reintenta), detectar por `mp_point_payment_id` ya guardado y responder 200 sin reprocesar
- [ ] Errores internos NO deben hacer que MP reintente — siempre responder 200 al webhook; los errores internos se loguean

**Notas técnicas:** Route en `src/app/api/pagos/mp-point/webhook/route.ts`. Usar `NextResponse` con `{ status: 200 }` antes de iniciar el procesamiento. Para el procesamiento asíncrono usar `waitUntil` de Vercel si está disponible, o simplemente no awaitar el bloque de procesamiento. El canal de Realtime sigue el patrón `supabase.channel('comprobante-{id}').send(...)`.

---

## V70-MP-007 — API Route: cancelar payment intent

- Tipo: feature
- Módulo: mp-point
- Prioridad: high
- Estimación: 3
- Versión: v7.0
- Estado: todo
- Dependencias: V70-MP-005

**Descripción:** Endpoint para que el cajero pueda cancelar una orden que ya fue enviada al posnet (antes de que el cliente pague). Cancela el intent en MP y revierte el comprobante a `borrador`.

**Criterios de aceptación:**
- [ ] `POST /api/pagos/mp-point/cancelar` implementado
- [ ] Body: `{ comprobante_id: string }`
- [ ] Requiere sesión autenticada y que el comprobante pertenezca al tenant
- [ ] Valida que el comprobante está en estado `pendiente_posnet` — si no, `400`
- [ ] Llama a `client.cancelPaymentIntent(deviceId, intentId)`
- [ ] Acepta que MP devuelva 422 si el intent ya estaba cancelado o terminado (idempotencia)
- [ ] Actualiza `comprobante`: `estado = 'borrador'`, limpia `mp_point_intent_id`
- [ ] Publica en Realtime `{ estado: 'cancelado' }` para que el modal de espera lo detecte
- [ ] Responde `200 { mensaje: "Cobro cancelado" }`
- [ ] Si el cajero cancela mientras el cliente ya estaba pagando: MP puede rechazar la cancelación — en ese caso devolver `409 { error: "El pago ya está siendo procesado" }` y el cajero debe esperar el resultado

**Notas técnicas:** Route en `src/app/api/pagos/mp-point/cancelar/route.ts`. Después de cancelar, el carrito del POS queda intacto para reintentar con otro método.

---

## FASE 3 — UI: Configuración por tenant

---

## V70-MP-008 — UI: Sección "Mercado Pago Point" en /configuracion

- Tipo: feature
- Módulo: mp-point
- Prioridad: high
- Estimación: 5
- Versión: v7.0
- Estado: todo
- Dependencias: V70-MP-004

**Descripción:** Agregar una sección en `/configuracion` para que el dueño del negocio configure su integración con MP Point: ingresa el access token, activa/desactiva el módulo, y selecciona la terminal activa desde una lista cargada desde la API de MP.

**Criterios de aceptación:**
- [ ] Sección "Mercado Pago Point" visible en `/configuracion` (solo rol admin)
- [ ] Toggle on/off `mp_point_habilitado` con advertencia si se deshabilita en medio de una venta
- [ ] Campo de texto para `mp_point_access_token` con tipo `password` (oculto por defecto, botón para mostrar)
- [ ] Botón "Verificar y cargar terminales" que llama a `GET /api/pagos/mp-point/devices`
  - Si el token es válido: muestra la lista de terminales como selector dropdown
  - Si el token es inválido: toast rojo "Token inválido o sin permisos de Point"
  - Loading state mientras carga
- [ ] Selector de terminal activa: muestra `name` o `external_pos_id` y el modo (`PDV` / `STANDALONE`)
- [ ] Si la terminal seleccionada está en modo `STANDALONE`: banner amarillo de advertencia con instrucción para cambiar el modo en la app de MP
- [ ] Campo para `mp_point_webhook_secret` (el secret que configura el tenant en el panel de MP para firmar webhooks)
- [ ] Botón "Guardar" que llama a `PATCH /api/configuracion/mp-point` con los valores
- [ ] Confirmación de guardado con toast verde
- [ ] Link de ayuda: "¿Cómo obtener mi Access Token de MP?" → documentación de MP Developers
- [ ] Solo visible si el plan incluye `facturador_pos` (misma guard que el POS)

**Notas técnicas:** Componente en `src/components/configuracion/mp-point-config.tsx`. El `access_token` nunca se devuelve completo desde el servidor — mostrar solo los últimos 4 caracteres si ya está guardado (como hace cualquier config de API key).

---

## V70-MP-009 — API Route: guardar y leer configuración MP Point

- Tipo: feature
- Módulo: mp-point
- Prioridad: high
- Estimación: 2
- Versión: v7.0
- Estado: todo
- Dependencias: V70-MP-001, V70-MP-008

**Descripción:** Endpoints para persistir y recuperar la configuración de MP Point del tenant, con encriptación del access token en DB.

**Criterios de aceptación:**
- [ ] `PATCH /api/configuracion/mp-point` — guarda los campos de MP Point
  - Body: `{ access_token?, device_id?, webhook_secret?, habilitado? }`
  - Encripta `access_token` con `pgp_sym_encrypt` antes de guardar (igual que ARCA)
  - Solo admin puede llamarlo
  - Responde `200 { ok: true }`
- [ ] `GET /api/configuracion/mp-point` — devuelve la config actual
  - NO devuelve el `access_token` completo — solo `access_token_configurado: boolean` + últimos 4 chars
  - Devuelve `device_id`, `habilitado`, `webhook_secret_configurado: boolean`
  - Responde `200 { habilitado, device_id, access_token_configurado, access_token_preview, webhook_secret_configurado }`
- [ ] Ambos endpoints requieren sesión autenticada y rol admin

**Notas técnicas:** Routes en `src/app/api/configuracion/mp-point/route.ts`. Reutilizar el helper de encriptación/desencriptación de `src/lib/facturacion/arca/config.ts`.

---

## FASE 4 — UI: Modal de cobro y pantalla de espera

---

## V70-MP-010 — UI: Botón "Posnet MP" en modal de cobro

- Tipo: feature
- Módulo: mp-point
- Prioridad: critical
- Estimación: 3
- Versión: v7.0
- Estado: todo
- Dependencias: V70-MP-005, V60-POS-021

**Descripción:** Agregar el botón "Posnet MP" en el modal de cobro del POS (`cobro-modal.tsx`), visible únicamente si el tenant tiene MP Point habilitado. Al seleccionarlo activa el flujo de cobro presencial.

**Criterios de aceptación:**
- [ ] Botón "💳 Posnet MP" visible en la grilla de métodos de pago del modal
- [ ] Solo se muestra si `mp_point_habilitado === true` en la configuración del tenant (cargado en el contexto de configuración)
- [ ] Al hacer click: deshabilita los demás métodos y muestra la pantalla de espera (ver V70-MP-011)
- [ ] El botón tiene ícono de terminal y etiqueta clara
- [ ] En mobile/tablet: el botón tiene tamaño táctil adecuado (mínimo 48px de alto)
- [ ] Si MP Point está habilitado pero no hay `device_id` configurado: el botón aparece pero al clickear muestra toast rojo "Configurá la terminal en Configuración → Mercado Pago Point"

**Notas técnicas:** Se extiende `src/components/pos/cobro-modal.tsx`. Leer la config de MP Point desde el hook `useConfiguracion()` existente o un hook específico `useMpPointConfig()`. No hacer fetch en este componente — el estado de habilitado debe venir del contexto.

---

## V70-MP-011 — UI: Pantalla de espera de pago en terminal

- Tipo: feature
- Módulo: mp-point
- Prioridad: critical
- Estimación: 8
- Versión: v7.0
- Estado: todo
- Dependencias: V70-MP-010, V70-MP-006, V70-MP-007

**Descripción:** Implementar el estado de espera dentro del modal de cobro: al elegir "Posnet MP", llama al endpoint de inicio, suscribe al canal de Realtime del comprobante, y actualiza la UI según el resultado (aprobado, rechazado, cancelado, error).

**Criterios de aceptación:**
- [ ] Al seleccionar "Posnet MP", el modal transiciona a la pantalla de espera:
  - Spinner animado
  - Monto total grande y visible (ej: `$ 15.430,00`)
  - Texto: "Esperando pago en terminal..."
  - Subtexto: "El cliente puede pagar con tarjeta, débito, NFC o QR"
  - Botón "Cancelar" visible
- [ ] Al montar la pantalla: llama automáticamente a `POST /api/pagos/mp-point/iniciar`
  - Si falla (device offline, error de MP): muestra error en pantalla con botón "Reintentar" y no cambia el estado del comprobante
- [ ] Suscripción a canal Supabase Realtime `comprobante-{id}` inmediatamente después del inicio exitoso
- [ ] Cuando llega evento `{ estado: 'aprobado' }` del canal:
  - Animación de éxito (check verde)
  - Texto: "¡Pago aprobado!" con el tipo de pago si está disponible
  - Avanza automáticamente a la pantalla final de éxito del modal (con número de comprobante, botones "Nueva venta" e "Imprimir")
- [ ] Cuando llega evento `{ estado: 'rechazado' }`:
  - Animación de error (X roja)
  - Texto: "Pago rechazado en la terminal"
  - Botones: "Intentar de nuevo" (vuelve a la selección de método) y "Cancelar venta"
- [ ] Cuando llega evento `{ estado: 'cancelado' }`:
  - Vuelve a la selección de método sin mensaje de error (el cajero lo canceló)
- [ ] Botón "Cancelar" llama a `POST /api/pagos/mp-point/cancelar`
  - Durante la cancelación: spinner en el botón, texto "Cancelando..."
  - Si MP rechaza la cancelación (pago en proceso): toast amarillo "El cliente está pagando, esperá el resultado"
- [ ] Timeout de seguridad: si pasan 3 minutos sin respuesta del Realtime, mostrar mensaje "El pago está tardando más de lo esperado. Verificá la terminal." con opción de "Consultar estado" (llama a `GET /api/pagos/mp-point/estado`)
- [ ] Cleanup: desuscribirse del canal de Realtime al desmontar el componente

**Notas técnicas:** Componente en `src/components/pos/mp-point-espera.tsx`. El canal de Realtime se crea con `supabase.channel('comprobante-${comprobanteId}')`. Manejar el caso donde el comprobante todavía no existe en DB al iniciar (si el modal de cobro crea el comprobante en este paso). La suscripción al canal debe hacerse ANTES de llamar al endpoint de inicio para no perder el evento si el webhook llega muy rápido.

---

## FASE 5 — Robustez y casos borde

---

## V70-MP-012 — API Route: consultar estado del payment intent

- Tipo: feature
- Módulo: mp-point
- Prioridad: medium
- Estimación: 2
- Versión: v7.0
- Estado: todo
- Dependencias: V70-MP-005

**Descripción:** Endpoint de polling para casos donde el Realtime falla o el cajero quiere verificar manualmente el estado de un cobro en curso.

**Criterios de aceptación:**
- [ ] `GET /api/pagos/mp-point/estado?comprobante_id=xxx` implementado
- [ ] Requiere sesión autenticada y ownership del comprobante
- [ ] Si el comprobante no tiene `mp_point_intent_id`: `400 { error: "No hay cobro pendiente para este comprobante" }`
- [ ] Consulta estado real a MP: `client.getPaymentIntent(deviceId, intentId)`
- [ ] Devuelve `{ estado_mp, estado_nexus, payment_type? }` — un estado normalizado para el frontend
- [ ] Si el estado en MP ya es `FINISHED/approved` pero el comprobante en DB todavía está `pendiente_posnet` (el webhook no llegó): procesa el cierre igual que lo haría el webhook (idempotente)
- [ ] Rate limit: máximo 1 consulta por comprobante cada 5 segundos (evitar hammering a la API de MP)

**Notas técnicas:** Route en `src/app/api/pagos/mp-point/estado/route.ts`. Esta ruta también sirve como mecanismo de recuperación ante fallos del webhook — puede convertirse en un cron si es necesario.

---

## V70-MP-013 — Manejo de casos borde: device offline, MP caído, reconexión

- Tipo: feature
- Módulo: mp-point
- Prioridad: medium
- Estimación: 5
- Versión: v7.0
- Estado: todo
- Dependencias: V70-MP-011, V70-MP-012

**Descripción:** Implementar el manejo explícito de todos los casos borde del flujo de cobro presencial: terminal desconectada, app de MP caída, pérdida de conexión del POS, reconexión del Realtime.

**Criterios de aceptación:**
- [ ] **Device offline:** cuando MP devuelve error de device no disponible al crear el intent, mensaje claro: "La terminal no está disponible. Verificá que esté encendida y conectada." Con botón "Reintentar" sin salir del modal
- [ ] **Device en modo STANDALONE:** MP devuelve error específico. Mensaje: "La terminal está en modo autónomo. Cambiala a modo PDV desde la app de Mercado Pago." Con link a instrucciones
- [ ] **MP caído (5xx de la API):** Mensaje genérico de error con opción de usar otro método de pago
- [ ] **Pérdida de conexión del POS:** Si el POS pierde internet mientras espera el Realtime, mostrar banner "Sin conexión — el pago puede haberse completado en la terminal. Verificá el estado." con botón "Verificar" que llama a `/api/pagos/mp-point/estado` cuando se restaure la conexión
- [ ] **Reconexión del canal Realtime:** Si el canal se desconecta, reconectar automáticamente (Supabase Realtime tiene reconexión automática — verificar que el handler esté activo post-reconexión)
- [ ] **Comprobante en `pendiente_posnet` al reabrir el POS:** Si el cajero cierra el navegador con un cobro pendiente y vuelve a abrir el POS, mostrar banner: "Hay un cobro pendiente de confirmación" con botón "Verificar estado"
- [ ] **Doble click en "Cobrar con Posnet":** bloquear el botón durante el proceso de inicio para evitar crear dos intents simultáneos

**Notas técnicas:** El estado de `pendiente_posnet` en el comprobante sirve como indicador de cobro en curso. Al cargar el POS, verificar si el último comprobante del turno tiene ese estado y activar el banner de recuperación.

---

## FASE 6 — Tests

---

## V70-MP-014 — Tests unitarios y de integración MP Point

- Tipo: test
- Módulo: mp-point
- Prioridad: high
- Estimación: 8
- Versión: v7.0
- Estado: todo
- Dependencias: V70-MP-006, V70-MP-007, V70-MP-005

**Descripción:** Suite completa de tests que cubren el cliente HTTP de MP Point, los endpoints de Nexus y el flujo end-to-end de cobro presencial con mocks de la API de MP.

**Criterios de aceptación:**
- [ ] **Unit tests del cliente HTTP** (`src/test/mp-point-client.test.ts`):
  - `listDevices` con respuesta exitosa y con error 401
  - `createPaymentIntent` con respuesta exitosa, device offline (503) y device en modo STANDALONE (422)
  - `cancelPaymentIntent` con éxito, con 422 (ya cancelado) y con 409 (en proceso)
  - `getPaymentIntent` con cada posible `state` de MP
- [ ] **Unit tests de la lógica del webhook** (`src/test/mp-point-webhook.test.ts`):
  - Verificación de firma HMAC correcta e incorrecta
  - Estado `FINISHED/approved` → cierra la venta correctamente
  - Estado `FINISHED/rejected` → revierte a borrador
  - Estado `CANCELED` → revierte a borrador
  - Webhook duplicado → idempotente, no reprocesa
  - `external_reference` inválido (comprobante no encontrado) → log sin error
- [ ] **Integration tests** (`src/test/mp-point-integration.test.ts`):
  - Flujo completo mock: iniciar cobro → simular webhook aprobado → verificar comprobante actualizado
  - Flujo de cancelación: iniciar → cancelar → verificar estado borrador
  - Error de configuración: intent sin token configurado → 400
  - Ownership: intent de tenant A no accesible por tenant B
- [ ] Todos los tests usan mocks de fetch para no llamar a la API real de MP
- [ ] `npm test` pasa con todos los tests en verde

**Notas técnicas:** Usar Vitest igual que los tests del POS. El mock de fetch puede reutilizar el helper ya existente en `src/test/setup.ts`. Para simular el webhook, crear un helper `simulateMpWebhook(intentId, state)` que construya el payload con firma HMAC válida usando el `webhook_secret` de test.

---

## Resumen de tickets y esfuerzo

| Fase | Ticket | Descripción | Pts |
|------|--------|-------------|-----|
| 1 | V70-MP-001 | Migración: columnas MP Point + estados | 3 |
| 1 | V70-MP-002 | Regenerar tipos TypeScript | 1 |
| 1 | V70-MP-003 | Servicio MP Point: cliente HTTP | 3 |
| 1 | **Subtotal Fase 1** | | **7** |
| 2 | V70-MP-004 | API: listar devices del tenant | 2 |
| 2 | V70-MP-005 | API: iniciar cobro en terminal | 5 |
| 2 | V70-MP-006 | API: webhook de confirmación MP | 8 |
| 2 | V70-MP-007 | API: cancelar payment intent | 3 |
| 2 | **Subtotal Fase 2** | | **18** |
| 3 | V70-MP-008 | UI: Sección configuración en /configuracion | 5 |
| 3 | V70-MP-009 | API: guardar y leer config MP Point | 2 |
| 3 | **Subtotal Fase 3** | | **7** |
| 4 | V70-MP-010 | UI: Botón "Posnet MP" en modal de cobro | 3 |
| 4 | V70-MP-011 | UI: Pantalla de espera + Realtime | 8 |
| 4 | **Subtotal Fase 4** | | **11** |
| 5 | V70-MP-012 | API: consultar estado del intent | 2 |
| 5 | V70-MP-013 | Casos borde: offline, reconexión, recovery | 5 |
| 5 | **Subtotal Fase 5** | | **7** |
| 6 | V70-MP-014 | Tests unitarios y de integración | 8 |
| 6 | **Subtotal Fase 6** | | **8** |
| | **TOTAL BLOQUE G** | **14 tickets** | **58 pts** |

---

## Grafo de dependencias

```text
V70-MP-001 (migración DB)
  └── V70-MP-002 (tipos TS)
        └── V70-MP-003 (cliente HTTP MP)
              ├── V70-MP-004 (API listar devices)
              │     └── V70-MP-008 (UI configuración)
              │           └── V70-MP-009 (API config guardar/leer)
              ├── V70-MP-005 (API iniciar cobro)
              │     ├── V70-MP-007 (API cancelar)
              │     └── V70-MP-012 (API consultar estado)
              └── V70-MP-006 (webhook)
                    └── V70-MP-005 (depende de intent_id en DB)

V70-MP-005 + V60-POS-021 (modal cobro existente)
  └── V70-MP-010 (botón Posnet MP en modal)
        └── V70-MP-011 (pantalla espera + Realtime)
              └── V70-MP-013 (casos borde)

V70-MP-006 + V70-MP-007 + V70-MP-005 + V70-MP-003
  └── V70-MP-014 (tests)
```

---

## Orden de implementación recomendado

**Sprint 1 (Fundacional):** MP-001 → MP-002 → MP-003

**Sprint 2 (APIs core):** MP-004 → MP-009 → MP-005 → MP-006 → MP-007

**Sprint 3 (Configuración UI):** MP-008

**Sprint 4 (UI POS):** MP-010 → MP-011

**Sprint 5 (Robustez):** MP-012 → MP-013

**Sprint 6 (Tests):** MP-014

---

## Setup inicial del comercio — paso a paso (para documentación de usuario)

1. **Crear o usar app existente en MP Developers** — si ya tenés una app para Checkout API, puede ser la misma. Verificar que tenga permisos de `point` habilitados en la app.

2. **Obtener Access Token de producción** — desde el panel de la app en MP Developers → Credenciales de producción → `access_token`.

3. **Configurar el webhook en MP** — en el panel de la app, agregar la URL: `https://tudominio.com/api/pagos/mp-point/webhook`. MP te dará el `webhook_secret` para firmar las notificaciones.

4. **Poner la terminal en modo PDV** — desde la app de Mercado Pago en el celular del comercio: Cobrar → Punto de venta → Modo integrado. Esto cambia el modo de `STANDALONE` a `PDV`.

5. **Configurar en Nexus** — ir a Configuración → Mercado Pago Point, pegar el `access_token` y el `webhook_secret`, hacer click en "Verificar y cargar terminales", seleccionar la terminal activa, guardar.

6. **Probar** — abrir el POS, agregar un producto, presionar COBRAR, elegir "Posnet MP" y verificar que la terminal recibe la orden.