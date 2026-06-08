# WhatsApp Chatbot — Facturas (sandbox y API)

Carga de facturas de proveedor con IA, matching de catalogo y confirmacion de impacto antes de aplicar stock, costos y cuenta corriente.

Indice del chatbot: [`whatsapp-chatbot.md`](./whatsapp-chatbot.md).

## Donde aplica cada flujo

| Superficie | Flujo | Conversacion por texto |
|------------|-------|------------------------|
| Sandbox `/whatsapp` | Upload → ticket `whatsapp_sandbox_invoice_ticket` | Si: comandos de revision y confirmacion |
| WhatsApp live (adjunto) | Webhook → cola → `lector_factura_job` → ticket + outbound | Si: mismos comandos que sandbox (`revisar`, `buscar`, `enlazar`, `SI token`) |
| API publica | `POST /jobs` → worker → `GET` → `POST .../confirmar` | El integrador implementa su propia UX |

Motor compartido de impacto y aplicacion: [`src/lib/lector-facturas/confirmacion-chatbot.ts`](../src/lib/lector-facturas/confirmacion-chatbot.ts). Tests: [`confirmacion-chatbot.test.ts`](../src/lib/lector-facturas/confirmacion-chatbot.test.ts).

API para integradores: [`lector-facturas-api.md`](./lector-facturas-api.md) (seccion Confirmar y aplicar job).

## Requisitos (sandbox)

- Modulo `lector_facturas` o `facturador_simple` activo.
- Usuario con rol de sandbox distinto de `readonly` / `visor` para cargar y enlazar productos.
- Sucursal seleccionada en la UI del sandbox (igual que el lector en app).

Implementacion upload: [`src/lib/whatsapp/sandbox-invoice.ts`](../src/lib/whatsapp/sandbox-invoice.ts). API: `POST /api/whatsapp/sandbox/facturas`.

## Etapas del ticket (sandbox)

| Etapa | Que pasa | Codigo |
|-------|----------|--------|
| Subida | PDF o imagen → IA + matching → fila en `lector_factura_job` + ticket | `processWhatsAppSandboxInvoiceUpload` |
| Preview | Resumen proveedor, items, advertencias, bloqueantes, token de 4 digitos | `buildWhatsAppInvoiceTicketChatSummary`, `prepararConfirmacionLectorFacturaDesdeResultado` |
| Revision | Listar pendientes, buscar producto, enlazar opcion | `parseTicketChatCommand` en [`sandbox.ts`](../src/lib/whatsapp/sandbox.ts) |
| Confirmar | Aplica comprobante importado si no hay bloqueantes | `continueWhatsAppSandboxInvoiceTicket` |
| Cerrar | Descarta el ticket sin aplicar | `closeWhatsAppSandboxInvoiceTicket` |

El `text-handler` intercepta comandos de ticket **antes** del agente read-only y de acciones transaccionales ([`text-handler.ts`](../src/lib/whatsapp/text-handler.ts)).

Estados tipicos del ticket: `pending_review` → `ready` → `applied` (o cerrado sin aplicar).

## Comandos de chat

Parser: `parseTicketChatCommand` (texto normalizado, minusculas, sin tildes).

### Confirmar / aplicar

| Frase (ejemplos) | Efecto |
|------------------|--------|
| `SI 1234` | Confirma con token de 4 digitos |
| `ok`, `si`, `dale`, `confirmo` | Confirma usando token del resumen |
| `confirmar`, `cargar`, `continuar`, `aplicar` | Idem |
| `1234` | Solo el token |

### Revision de items pendientes

| Frase | Efecto |
|-------|--------|
| `revisar`, `pendientes`, `productos`, `ver pendientes`, `listar pendientes`, `detalle` | Lista items sin vincular o a revisar |

### Buscar y enlazar catalogo

| Frase | Efecto |
|-------|--------|
| `buscar 1 yerba playadito` | Busca productos para el item **1** (numero mostrado al usuario) |
| `busca 2 coca` | Variante |
| `enlazar 1 2` | Usa la opcion **2** de la ultima busqueda del item **1** |

Alias de busqueda: `producto`, `productos` en lugar de `buscar` / `busca`.  
Alias de enlace: `vincular`, `usar`, `elegir`.

Orden obligatorio para enlazar: primero `buscar N ...`, luego `enlazar N opcion`.

### Cerrar ticket

| Frase | Efecto |
|-------|--------|
| `cerrar`, `cancelar`, `cancelo`, `no` | Cierra el ticket activo |

## Rol readonly / visor

Puede `revisar` y ver pendientes. No puede `confirmar`, `cargar`, `buscar` para enlazar ni `enlazar`. El bot responde que el rol es solo lectura.

## Ejemplo de conversacion (sandbox)

```
Usuario: [sube factura-proveedor.pdf]
Bot: Proveedor Arcor SA — 12 items — 2 pendientes de vincular.
     Item 1: Yerba 1kg (sin match)
     Para confirmar: SI 4821 (vence en 15 min)

Usuario: buscar 1 yerba playadito
Bot: Item 1 — opciones:
     1) Yerba Playadito 1kg (SKU YER-1)
     2) Yerba Noble 1kg
     Responde: enlazar 1 1

Usuario: enlazar 1 1
Bot: Item 1 vinculado a Yerba Playadito 1kg. Queda 1 pendiente.

Usuario: revisar
Bot: Item 2: Gaseosa 2.25L — requiere revision manual en app.

Usuario: SI 4821
Bot: Factura aplicada. Comprobante #1234. Stock y CC actualizados segun impacto.
```

Si hay `bloqueantes` en el impacto (proveedor faltante, validacion fiscal, etc.), la confirmacion falla hasta resolverlos en app o en el preview.

## Resolucion en web (borrador automatico)

Cuando el ticket queda en estado **`needs_review`** (bloqueantes o productos pendientes de enlazar / `requires_review`), el sistema:

1. Persiste un **borrador** en `lector_factura_log` (`datos_extraidos.borrador_payload`, `origen_canal: whatsapp`).
2. Envia por WhatsApp un enlace absoluto: `/lector-facturas?borrador={log_id}` (requiere `NEXT_PUBLIC_SITE_URL` o `NEXT_PUBLIC_APP_URL`).
3. Al abrir el enlace, el lector retoma el preview editable igual que el panel **Borradores de facturas**.

Codigo: [`borradores-whatsapp.ts`](../src/lib/lector-facturas/borradores-whatsapp.ts), integrado en [`process-jobs/route.ts`](../src/app/api/cron/lector-facturas/process-jobs/route.ts) (`notifyWhatsapp`) y [`sandbox-invoice.ts`](../src/lib/whatsapp/sandbox-invoice.ts).

Si el usuario enlaza productos por chat (`buscar` / `enlazar`), el borrador se **re-sincroniza** con el `resultado` actualizado del job para que la web no quede desactualizada.

Camino feliz (`ready`): sin borrador automatico; solo resumen + token y confirmacion manual por WhatsApp (`OK {token}` / `cargar`).

## Relacion con la API publica

El mismo `impacto` y `impact_hash` que muestra el sandbox se obtienen en:

```http
GET /api/public/lector-facturas/jobs/:id
```

La aplicacion equivale a confirmar en sandbox, pero via HTTP:

```http
POST /api/public/lector-facturas/jobs/:id/confirmar
```

con `confirm: true` y `accepted_impact_hash`. Sin `confirm`/`accepted_impact_hash` la API responde `428` con el preview para mostrar al usuario final del integrador.

Un chatbot externo puede:

1. Crear job con la factura recibida por WhatsApp (otro servidor).
2. Mostrar `impacto.resumen` y pedir confirmacion en su UI.
3. Llamar `confirmar` con el hash aceptado.

No necesita replicar los comandos `buscar` / `enlazar` si resuelve matches en su propia UI; el sandbox los ofrece para probar el flujo conversacional dentro de SmartStock.

## WhatsApp live (adjuntos)

Cuando un usuario envia PDF/imagen por WhatsApp real:

1. [`process-queued`](../src/app/api/cron/whatsapp/process-queued/route.ts) enruta el adjunto a `lector_factura_job` ([`job-routing.ts`](../src/lib/whatsapp/job-routing.ts)).
2. Al completar el job, [`process-jobs`](../src/app/api/cron/lector-facturas/process-jobs/route.ts) prepara impacto (`confirmacion-chatbot`), crea fila en `whatsapp_sandbox_invoice_ticket` keyed por `from_wa_id` + `usuario_id`, y encola outbound con el mismo resumen/token que el sandbox (`buildWhatsAppInvoiceTicketChatSummary`).
3. Los mensajes de texto del usuario pasan por [`text-handler.ts`](../src/lib/whatsapp/text-handler.ts) → `handleWhatsAppInvoiceTicketChatCommand` (antes del agente read-only y de acciones transaccionales).

Requisitos live: actor `whatsapp_actor` activo para ese `from_wa_id`; `trust_level=verified` y rol distinto de `readonly`/`visor` para confirmar y enlazar; solo lectura puede `revisar` / `pendientes`.

Si el numero no tiene actor o no esta verificado, el outbound igual muestra el resumen pero indica que no puede confirmar desde el chat.

Piloto alternativo en UI: sandbox `/whatsapp`. Runbook: [`whatsapp-agentico-runbook.md`](./whatsapp-agentico-runbook.md).

## Tablas y migraciones

- `whatsapp_sandbox_invoice_ticket` — ticket conversacional (sandbox UI y WhatsApp live por `from_wa_id`)
- `lector_factura_job` — job async (sandbox, API y adjuntos WA)
- `whatsapp_sandbox_pending_action` — acciones simuladas (distinto de facturas)

Migracion referencia: `supabase/migrations/171_whatsapp_sandbox_invoice_ticket_chat_state.sql`.

## Evals y tests

- Upload y ticket: [`whatsapp-sandbox-invoice-upload.test.ts`](../src/test/whatsapp-sandbox-invoice-upload.test.ts)
- Chat de ticket (buscar/enlazar/confirmar): [`whatsapp-sandbox-real-invoice.test.ts`](../src/test/whatsapp-sandbox-real-invoice.test.ts) (incluye flujo `webhook_text` live y rol readonly)
- Borrador web desde WA: [`borradores-whatsapp.test.ts`](../src/lib/lector-facturas/borradores-whatsapp.test.ts)
