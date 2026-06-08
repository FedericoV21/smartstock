# Pasarelas externas POS

Esta guia es el contrato de implementacion para sumar pasarelas externas al POS. Un agente debe poder usar este documento junto con la documentacion oficial del proveedor para crear una integracion nueva sin tocar el flujo fiscal.

## Invariantes obligatorios

- El adapter de una pasarela nunca implementa ARCA, AFIP, CAE, stock, movimientos ni numeracion fiscal.
- El adapter solo normaliza pagos: crea, cancela, sincroniza, valida webhooks y transforma estados externos a estados internos.
- ARCA corre solo despues de pago aprobado y verificado por webhook o sincronizacion.
- El cobro externo siempre parte de un comprobante borrador del POS.
- Un pago aprobado debe terminar en uno de estos resultados: `completa`, `fiscal_pendiente` o `fiscal_error`.
- Un webhook duplicado no puede duplicar factura, CAE, stock ni movimientos.
- Una integracion fisica compartida, como un QR fijo o una terminal, no puede tener dos cobros activos al mismo tiempo.
- Una integracion puede estar enlazada a varias cajas y una caja puede tener varias integraciones habilitadas.
- Los secretos nunca se devuelven al frontend. Las APIs solo exponen `secretos_configurados`.

## Modelo de datos

- `pasarela_integracion`: conexion unica con un proveedor en una sucursal. Campos clave: `proveedor`, `canal`, `tipo`, `nombre`, `estado`, `config_publica`, `secretos_cifrados`, `webhook_public_id`.
- `pasarela_caja`: relacion muchos-a-muchos entre `caja` e `pasarela_integracion`. Permite alias, orden y habilitado por caja.
- `pasarela_transaccion`: intento de cobro normalizado. Guarda caja, integracion, comprobante, monto, estado interno, IDs externos y auditoria. Tiene una restriccion unica para evitar cobros simultaneos activos sobre la misma integracion.
- `pasarela_webhook_log`: log de recepcion y trazabilidad de webhooks. Usar para idempotencia por evento cuando el proveedor trae ID estable.

## Estados internos

- Activos que bloquean la integracion: `creada`, `iniciada`, `pendiente`, `fiscalizando`.
- Finales no fiscales: `rechazada`, `cancelada`, `expirada`, `error`.
- Finales o semi-finales fiscales: `completa`, `fiscal_pendiente`, `fiscal_error`.
- `aprobada` se reserva para pago confirmado antes de fiscalizar o para casos especiales donde se necesita liberar el lock sin emitir, por ejemplo pago huerfano.

Mapeo recomendado:

| Externo | Interno |
| --- | --- |
| created/open/on_terminal/waiting_user | `pendiente` |
| processing | `pendiente` |
| approved/paid/finished con pago valido | `fiscalizando` y luego `completa` |
| rejected/declined | `rechazada` |
| cancelled/canceled | `cancelada` |
| expired | `expirada` |
| provider_error/config_error | `error` |
| approved + ARCA sin respuesta | `fiscal_pendiente` |
| approved + ARCA rechazo/error definitivo | `fiscal_error` |

## Ciclo completo

1. El POS crea un borrador con `/api/pos/comprobante-borrador`.
2. El POS inicia cobro con `POST /api/pagos/pasarela/iniciar`.
3. La ruta valida que la integracion este activa, pertenezca a la sucursal del comprobante y este habilitada para la caja.
4. La ruta crea una fila activa en `pasarela_transaccion`. Si ya hay una activa para esa integracion, responde 409.
5. La ruta llama al adapter `createPayment`.
6. El adapter envia el monto al proveedor y devuelve:
   - patch para el comprobante;
   - IDs externos normalizados;
   - respuesta minima para el POS.
7. El proveedor envia webhook a `/api/pagos/webhook/[proveedor]/[webhook_public_id]`.
8. La ruta publica registra `pasarela_webhook_log`, verifica firma si aplica y delega el procesamiento.
9. El procesador consulta el pago al proveedor con credenciales de la integracion.
10. Si el pago no esta aprobado, normaliza estado y libera la transaccion si corresponde.
11. Si el pago esta aprobado, marca `fiscalizando` y llama al motor central de emision.
12. El motor central emite ARCA, registra stock, movimientos, caja y comprobante.
13. El procesador marca `completa`, `fiscal_pendiente` o `fiscal_error` en `pasarela_transaccion`.
14. El POS recibe broadcast o consulta estado y muestra exito, pendiente fiscal o error recuperable.

## APIs y pantallas

- `GET/POST/PATCH/DELETE /api/pasarelas/integraciones`: administra conexiones por sucursal.
- `GET/PATCH /api/configuracion/cajas/[id]/pasarelas`: administra que integraciones puede usar cada caja.
- `POST /api/pagos/pasarela/iniciar`: inicia cobro generico desde el POS.
- `GET /api/pagos/pasarela/estado`: consulta estado normalizado por comprobante.
- `POST /api/pagos/pasarela/cancelar`: cancela el cobro activo y libera la transaccion.
- `POST /api/pagos/pasarela/sincronizar`: recupera pagos cuando el webhook se demora.
- `POST /api/pagos/webhook/[proveedor]/[webhook_public_id]`: entrada publica de webhooks.
- `/configuracion/pasarelas`: pantalla operativa para crear varias conexiones MP QR/Point y enlazarlas a cajas.

## Contrato del adapter

Los adapters viven en `src/lib/pasarelas`.

```ts
export type PasarelaAdapter = {
  proveedor: string;
  tipo: string;
  canal: 'qr' | 'terminal';
  validateConfig(integracion): { ok: true } | { ok: false; error: string };
  createPayment(params): Promise<PasarelaCreatePaymentResult>;
  cancelPayment?(params): Promise<{ ok: true } | { ok: false; status: number; error: string }>;
  syncPayment?(params): Promise<{ ok: true; response?: JsonRecord } | { ok: false; status: number; error: string }>;
  parseWebhook?(params): JsonRecord | null;
  verifyWebhook?(params): Promise<boolean> | boolean;
  listDevices?(params): Promise<{ ok: true; devices: JsonRecord[] } | { ok: false; status: number; error: string }>;
};
```

Reglas:

- `validateConfig` revisa presencia y forma de `config_publica` y secretos requeridos.
- `createPayment` nunca actualiza ARCA ni emite comprobantes. Solo llama al proveedor.
- `cancelPayment` debe ser idempotente: cancelar algo inexistente o ya cerrado debe ser exito si el proveedor lo permite.
- `syncPayment` debe consultar al proveedor y devolver datos normalizados, no fiscalizar por su cuenta.
- `verifyWebhook` debe validar firma/HMAC/secret cuando el proveedor lo soporte.
- `listDevices` aplica a terminales o dispositivos fisicos.

## Estructura esperada para una pasarela nueva

Para proveedor `modo`:

- `src/lib/pasarelas/adapters.ts`: registrar `modoAdapter` en `ADAPTERS`.
- `src/lib/pasarelas/types.ts`: agregar tipos comunes solo si son reutilizables.
- `src/lib/modo/client.ts`: cliente HTTP del proveedor, con errores tipados.
- `src/lib/modo/procesar-webhook.ts`: normalizacion de webhook/sync y llamada al motor central si el pago esta aprobado.
- `src/app/api/pagos/webhook/modo/[webhook_public_id]/route.ts`: no crear ruta especifica salvo que el proveedor exija path fijo. Preferir la ruta generica.
- Tests del client/adapter/procesador.

## Configuracion y secretos

`config_publica` contiene datos no sensibles necesarios para operar:

- QR: `user_id`, `external_pos_id`, `qr_label`, `store_id`.
- Terminal: `device_id`, `terminal_label`, `store_id`.
- Otros: IDs publicos, modo sandbox/produccion, nombres visibles.

`secretos_cifrados` contiene:

- `access_token`
- `client_secret`
- `webhook_secret`
- `private_key`
- cualquier credencial que permita operar o validar webhooks.

Usar helpers:

- `encryptSecretsRecord` para guardar secrets.
- `getPasarelaSecret` para leer secrets en servidor.
- `sanitizeIntegracion` para responder APIs sin exponer secrets.

## Webhooks e idempotencia

- Siempre responder rapido al proveedor. Si hay trabajo largo, usar `after()`.
- Registrar todo webhook recibido en `pasarela_webhook_log`.
- Si el proveedor trae ID unico de evento, guardarlo como `event_id`.
- Antes de emitir, consultar al proveedor para verificar que el pago esta aprobado.
- No confiar solo en el body del webhook cuando el proveedor permite consultar estado.
- Si se recibe el mismo webhook dos veces, el procesador debe encontrar el comprobante ya emitido o la transaccion final y no repetir efectos.

## Cancelacion y sincronizacion

- Cancelar debe actualizar proveedor, comprobante y `pasarela_transaccion`.
- Sincronizar debe ser seguro para usar desde el POS cuando el webhook se demore.
- Si sincronizacion detecta pago aprobado, debe seguir el mismo camino central que el webhook.

## Checklist de implementacion

- Crear cliente HTTP tipado para el proveedor.
- Registrar adapter en `src/lib/pasarelas/adapters.ts`.
- Definir `validateConfig`.
- Implementar `createPayment`.
- Implementar `cancelPayment` si el proveedor lo permite.
- Implementar `syncPayment` si hay endpoint de consulta.
- Implementar `verifyWebhook` si el proveedor firma webhooks.
- Mapear estados externos a estados internos.
- Asegurar que el pago aprobado llama al motor central de emision, no al adapter.
- Actualizar `pasarela_transaccion` en todos los finales.
- Asegurar que `pasarela_webhook_log` se registre.
- Exponer dispositivos con `listDevices` si aplica.
- Confirmar que una caja puede tener varias integraciones y una integracion puede estar en varias cajas.
- Mantener compatibilidad con rutas legacy si ya hay comercios cobrando.

## Checklist de tests

- Config valida e invalida.
- Integracion activa enlazada a varias cajas.
- Caja con varias integraciones.
- POS lista solo integraciones habilitadas para la caja abierta.
- `createPayment` no llama ARCA.
- Webhook aprobado llama emision central una sola vez.
- Webhook duplicado no duplica comprobante, CAE, stock ni movimientos.
- Cancelacion libera `pasarela_transaccion`.
- Concurrencia: dos cajas sobre la misma integracion reciben un 409 en el segundo intento.
- ARCA caida deja `pendiente_arca` o `error_arca` y `pasarela_transaccion` en `fiscal_pendiente` o `fiscal_error`.
- Sync manual puede recuperar un pago aprobado si el webhook se demoro.

## Ejemplo Mercado Pago QR y Point

Backfill:

- `mp_qr_config` activa crea `pasarela_integracion` tipo `mp_qr`, canal `qr`, nombre `Mercado Pago QR`.
- `mp_point_config` activa crea `pasarela_integracion` tipo `mp_point`, canal `terminal`, nombre `Mercado Pago Point`.
- Cada integracion activa se enlaza a todas las cajas activas de su sucursal.

Inicio:

- Point usa `createPaymentIntent(device_id, amount, external_reference=comprobante.id)`.
- QR usa `createOrder(external_pos_id, total_amount, external_reference=comprobante.id, notification_url=/api/pagos/webhook/mercado_pago/[webhook_public_id])`.

Webhook:

- Point valida `x-signature` cuando hay `webhook_secret`.
- QR no trae firma equivalente; se valida consultando `merchant_orders/{id}` con token de la integracion.

Fiscal:

- Point y QR terminan usando `emitirComprobante` desde el borrador.
- Si ARCA autoriza, `pasarela_transaccion.estado = completa`.
- Si ARCA queda pendiente o falla, la venta queda recuperable en el comprobante y `pasarela_transaccion` refleja `fiscal_pendiente` o `fiscal_error`.
