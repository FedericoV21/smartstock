# Runbook — WhatsApp Agéntico (v14)

## Objetivo

Operar el canal WhatsApp agéntico de forma segura por tenant, con activación gradual y trazabilidad.

Indice y mapa de documentacion del chatbot: [`whatsapp-chatbot.md`](./whatsapp-chatbot.md).

## Alcance actual

- Consultas read-only por texto (catalogo ampliado: ver [`whatsapp-chatbot-reportes.md`](./whatsapp-chatbot-reportes.md)).
- Audio/nota de voz con STT y enrutado al mismo text-handler.
- Acciones con doble confirmación (ver `docs/whatsapp-chatbot-acciones.md`):
  - pago a proveedor (`registrar_pago_cuenta_proveedor`)
  - cobro a cliente (`registrar_pago_cliente_desde_cuenta_corriente`)
  - cobro imputado a factura/ticket (`registrar_pago_cobranza`)
  - ajuste de stock (`registrar_movimiento`)

## Feature flag por tenant

Tabla: `whatsapp_agent_feature_flag`

- `enabled=false`: no se ejecuta motor agéntico (texto/audio/acciones).
- `enabled=true`: se habilita flujo agéntico para ese tenant.
- `rollout_stage`: usar `pilot` durante pruebas controladas.

API interna:

- `GET /api/whatsapp/feature-flag`
- `PATCH /api/whatsapp/feature-flag` (solo owner/admin)

UI:

- `/whatsapp` → sección "Rollout agente WhatsApp" para activar/desactivar piloto.

## Procedimiento de activación (piloto)

1. Verificar canal WhatsApp activo (`whatsapp_channel`) para el tenant.
2. Activar feature flag del tenant en `/whatsapp`.
3. Vincular al menos un usuario con OTP (`whatsapp_actor` + `whatsapp_auth_challenge`).
4. Probar consultas read-only:
   - deuda proveedor
   - deuda cliente
   - stock producto
   - reporte deuda/stock bajo
5. Probar audio:
   - enviar nota de voz
   - validar transcripción y respuesta
6. Probar acciones (frases alternativas aceptadas):
   - Pago: `registrar pago proveedor X 12345` o `pague 10 lucas al proveedor X`
   - Cobro: `registrar cobro cliente X 5000` o `cobre 5000 al cliente X`
   - Stock: `ajustar stock Producto +10`
   - Confirmar cada una con `SI <token>` y validar `whatsapp_action_log` en `executed`.
7. Probar reportes nuevos en sandbox: `resumen del mes`, `vencimientos`, `ventas POS hoy`, `recibos del mes`, `libro IVA del mes`, `gasto por proveedor del mes`.
8. Probar facturas en sandbox (ver [`whatsapp-chatbot-facturas.md`](./whatsapp-chatbot-facturas.md)):
   - subir PDF o imagen de factura de proveedor;
   - si hay item pendiente: `buscar 1 <texto>` → `enlazar 1 <opcion>`;
   - confirmar con `SI <token>` del resumen;
   - opcional: `cerrar` sin aplicar para validar cancelacion.

Evals automatizados antes de release: [`whatsapp-agent-evals.md`](./whatsapp-agent-evals.md) (`npx vitest run src/test/whatsapp-agent-evals.test.ts`).

## Procedimiento de rollback

1. Desactivar feature flag del tenant (`enabled=false`).
2. Mantener webhook activo (no afecta otros flujos de adjuntos ya existentes).
3. Revisar `whatsapp_processing_job` para jobs de audio en `review_required`.

## Monitoreo recomendado

- Jobs:
  - `whatsapp_processing_job.status`
  - `whatsapp_job_event.event_type`
- OTP:
  - expirados/bloqueados en `whatsapp_auth_challenge`
- Acciones:
  - `whatsapp_action_log.action_status`
  - deduplicación por `action_signature`
- Outbound:
  - `whatsapp_outbound_message.status`, `retry_count`, `last_error`

## Checklist pre-producción

- [ ] `CRON_SECRET` configurado para `process-queued`, `lector-facturas/process-jobs`, `send-outbound`, `expire-otp`.
- [ ] `WHATSAPP_AUTO_FLUSH_OUTBOUND` y `WHATSAPP_OTP_AUTO_FLUSH_OUTBOUND` no están en `0` salvo que `send-outbound` corra de forma confiable. El default intenta enviar el mensaje live/OTP apenas se encola.
- [ ] `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` válidos.
- [ ] STT configurado (`OPENAI_API_KEY`, modelo endpoint STT).
- [ ] LLM de intents: `OPEN_ROUTER_API_KEY` y `OPEN_ROUTER_MODELS` (cadena separada por comas). Opcional: `WHATSAPP_AGENT_INTENT_LLM_PROVIDER=openrouter` para no usar Gemini.
- [ ] RLS/policies aplicadas en migraciones `156`, `157`, `158`.
- [ ] Actor de prueba verificado por OTP.
- [ ] Confirmación doble de acción piloto validada (incluye cancelación y token inválido).
- [ ] Validado comportamiento con feature flag desactivado.
- [ ] Costos estimados de LLM/STT revisados para volumen esperado.

## v14.4 — Adjuntos y sucursal

Tickets: `V144-WA-001` … `V144-WA-004`. Roadmap: [`whatsapp-chatbot-roadmap-v14.4.md`](./whatsapp-chatbot-roadmap-v14.4.md).

### Checklist piloto adjuntos

1. Tenant con varias sucursales: configurar `whatsapp_branch_rule` (post `V144-WA-002`) o verificar fallback sucursal principal (`V144-WA-001`).
2. Enviar **imagen JPEG** de factura por WhatsApp live.
3. Si el bot pide sucursal: responder `1` (o número correcto) y confirmar outbound «Procesando…».
4. Panel `/whatsapp` → job pasa de `awaiting_branch_confirmation` a `processing` / `lector_factura_job`.
5. Enviar **nota de voz** con feature flag ON y `OPENAI_API_KEY` configurada.
6. Validar transcripción y respuesta del agente (mismo motor que texto).

### Síntomas en panel de jobs

| Estado UI | `branch_resolution_reason` | Acción inmediata |
|-----------|----------------------------|------------------|
| Esperando sucursal | `multiple_active_branches_without_rule` | Usuario responde 1/2/3 por WA; configurar regla sucursal |
| Esperando sucursal (audio legacy) | idem en jobs viejos | Reparación `V144-WA-004` o reprocess tras fix |
| `review_required` + audio | `feature_disabled` / STT | Activar flag; revisar `OPENAI_API_KEY` |

**Nota:** «Reintentar» en UI sin `branch_id` no procesa facturas; esperar `V144-WA-004`.

## v14.4 — Pulido LLM de respuesta (`V144-WA-011`)

Opcional. Reformula **solo** plantillas cortas ya generadas (saludo, ayuda, ejemplos, catálogo `unknown`). **No** aplica a reportes ni respuestas con varias cifras.

| Variable | Valor | Notas |
|----------|--------|--------|
| `WHATSAPP_AGENT_REPLY_POLISH` | `1` / `true` para activar | **Off por default** en prod y CI |
| `WHATSAPP_AGENT_REPLY_POLISH_MODEL` | opcional | Modelo OpenRouter; si falta, usa `WHATSAPP_AGENT_INTENT_LLM_MODEL` o `OPEN_ROUTER_MODELS` |
| `OPEN_ROUTER_API_KEY` + `OPEN_ROUTER_MODELS` | recomendado | Proveedor principal (~6 s timeout, ~450 tokens salida) |
| `GEMINI_API_KEY` | fallback | Solo si OpenRouter no está; respuesta vía JSON `{"reply":"..."}` |

**Costo / latencia estimados (por mensaje pulido):**

- +1 llamada LLM después de la plantilla (no reemplaza clasificador de intents).
- Latencia típica: **0,8–6 s** según proveedor y cola; si falla o la validación rechaza el texto, se envía la **plantilla original** sin error visible.
- Tokens: ~400–800 entrada + hasta 450 salida (menú de ayuda es el caso más largo).

**Seguridad:** el validador exige conservar montos presentes en la plantilla y **prohíbe** agregar `$` o totales nuevos. No usar en cuerpos de reporte (límite ~2000 caracteres / 2 líneas con `$`).

Código: `src/lib/whatsapp/reply-llm-polish.ts` → `composeReplyWithLlmPolish`.

## Respuesta ante incidentes

- Job atascado en sucursal:
  - verificar outbound encolado (`whatsapp_outbound_message.status`)
  - confirmar `send-outbound` cron
  - usuario debe haber respondido número de sucursal en ventana 45 min
- Error STT recurrente:
  - revisar credenciales/config STT
  - fallback a instrucción de texto al usuario
- OTP bloqueado:
  - esperar ventana `blocked_until` o solicitar nuevo challenge luego del cooldown
- Acción no ejecutada:
  - revisar `whatsapp_action_log.error_detail`
  - verificar permisos de actor y módulo del tenant
