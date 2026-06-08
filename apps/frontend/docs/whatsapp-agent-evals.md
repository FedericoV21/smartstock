# WhatsApp Agent Evals (v2)

Este documento define la evaluacion continua del agente conversacional de WhatsApp para SmartStock.

Indice del chatbot: [`whatsapp-chatbot.md`](./whatsapp-chatbot.md).

## Objetivo

Validar, antes de cada release, que el agente:

- entienda consultas exactas y genericas;
- elija la tool correcta;
- repregunte bien ante ambiguedad;
- mantenga utilidad conversacional en follow-ups.

## Dataset versionado

- Fixture principal: `src/test/fixtures/whatsapp-agent-evals.v141.json`
- Cantidad de casos: **192** (v14.4, `V144-WA-010`)
- El runner fija reloj en `2026-06-01` (`vi.useFakeTimers`) y comprobantes de mayo/abril para totales deterministas.
- Cobertura detallada por categoria en la tabla siguiente.

### Categorias del fixture (v14.9)

| Categoria | Que valida | Ejemplos de mensaje |
|-----------|------------|---------------------|
| `proveedor_*` / `cliente_*` | Deuda puntual, ambiguedad, saldo a favor, no encontrado | `cuanto le debo a proveedor arcor` |
| `deuda_ambigua` | Repregunta cliente vs proveedor | `pasame la deuda de juan` |
| `cliente_contacto_*` | Telefono, email, direccion, datos completos | `mail de cliente juan perez` |
| `proveedor_contacto_*` | Contacto proveedor (V143-WA-008, `WAE-164`…`170`) | `telefono del proveedor arcor`, `telefono del primero` (con `lastOptions` en contexto) |
| `reporte_comparativo_ventas` | vs mes anterior (`WAE-171`…`174`) | `como venimos vs mes pasado`, `comparativo ventas mayo` |
| `stock_producto_*` / `stock_generico` | Stock puntual vs inventario general | `stock de coca`, `inventario` |
| `stock_mas_bajo` | Producto con menor stock | `producto con menos stock` |
| `reporte_stock_*` / `reporte_deuda_*` | Reportes paginados de stock y deuda | `deuda proveedores`, `stock bajo` |
| `reporte_ventas*` | Ventas, ranking productos/clientes, ganancias, medios | `ventas hoy`, `productos mas vendidos en mayo` |
| `reporte_resumen` / `reporte_vencimientos` | P1 v14.2 | `resumen del mes`, `vencimientos` |
| `reporte_ventas_pos` / `reporte_recibos` | P2 v14.2; POS por caja/operador v14.16 (`WAE-161`…`163`) | `ventas pos hoy`, `ventas pos caja mostrador`, `tickets pos operador Maria Lopez` |
| `reporte_libro_iva` / `reporte_gasto_proveedores` | P3 v14.2 (rentabilidad) | `libro iva del mes` |
| `accion_hint` | Read-only orienta frase de accion | `registrar pago proveedor arcor` |
| `accion_no_soportada` | No ejecuta fuera de catalogo read-only | `emitir factura ahora` |
| `assistant_*` (v14.4, `V144-WA-010`) | Saludo, ayuda, menu por rol | `hola`, `que podes hacer`, `menu` |
| `memoria_anaphora` (v14.4) | Follow-ups unificados | `y su saldo`, `de nuevo` |
| `fuera_catalogo` / `reporte_sin_scope` | Saludo o reporte sin tipo | `hola`, `pasame un informe` |
| `continuidad_contexto` | Probes de sesion multi-turno (`continuityProbe`) | `y ahora stock de yerba...` |
| `seleccion_ambigua` | Evita elegir opcion sin contexto | `el primero` |
| `nlu_reglas_*` | Sinónimos locales v14.3 (V143-WA-002) | `como venimos`, `me deben`, `facturacion del mes` |
| `reporte_cierre_caja` | Arqueo / cierre Z read-only (V143-WA-003) | `cierre de caja hoy`, `arqueo ayer` |
| `cliente_extracto_cc*` | Extracto / movimientos CC por cliente (V143-WA-005) | `extracto cuenta corriente Juan Perez`, `historial cc Juan mayo` |
| `accion_hint_cobranza_factura` | Hint read-only hacia cobro por factura (V143-WA-006) | `cobrar factura del cliente juan` |
| `intent_context_*` | Clasificador con slots de memoria (V143-WA-001) | `y ayer?` con `lastIntent` |

Cada caso define:

- `expectedIntent`
- `expectedTool`
- `expectedFallbackReason`
- `replyMustContain` (patron minimo de respuesta util)

## Clasificador LLM (opcional en evals y piloto)

En CI los evals desactivan el LLM (`WHATSAPP_AGENT_INTENT_LLM=false`) para medir reglas + tools de forma estable. En piloto/producción podés habilitarlo para mensajes ambiguos.

| Variable | Uso |
|----------|-----|
| `WHATSAPP_AGENT_INTENT_LLM` | `true` / `false` — activa `classifyIntentWithLlm` cuando las reglas no alcanzan. |
| `WHATSAPP_AGENT_INTENT_LLM_PROVIDER` | Proveedor (`openai`, `anthropic`, etc. según implementación). |
| `WHATSAPP_AGENT_INTENT_LLM_MODEL` | Modelo del proveedor (ej. `gpt-4o-mini`). |

Umbrales documentados en código (`src/lib/whatsapp/intent-classifier-examples.ts`):

- Reglas con `confidence >= 0.88` e intent distinto de `unknown` → **no** se llama al LLM.
- Se llama al LLM si `unknown` o `confidence` en **[0.4, 0.88)**.
- `unsupported_action` nunca dispara LLM.

Few-shots del prompt: misma lista exportada en `WHATSAPP_INTENT_CLASSIFIER_FEW_SHOTS`.

## Runner automatizado

- Test runner: `src/test/whatsapp-agent-evals.test.ts`
- Comando recomendado:

```bash
npx vitest run src/test/whatsapp-agent-evals.test.ts
```

Metricas emitidas en consola (`[wa-agent-evals]`):

- `intentAccuracy`
- `toolHitRate`
- `fallbackRate`
- `contextContinuityRate`
- `followupResolutionRate`
- `clarificationEfficiency`
- `actionConfirmationCompletionRate`
- `mismatches`

## Gate sugerido de release

- `intentAccuracy >= 0.90`
- `toolHitRate >= 0.90`
- `contextContinuityRate >= 0.85`
- `clarificationEfficiency >= 0.85`
- `actionConfirmationCompletionRate >= 0.80` (en ambiente real)
- `mismatches = 0`

Si no cumple, no liberar cambios conversacionales sin iteracion correctiva.

## Checklist QA manual (WhatsApp real)

- [ ] Vincular actor OTP y confirmar que el flujo inicia sin friccion.
- [ ] Probar consulta generica de stock y verificar repregunta/resumen util.
- [ ] Probar consulta exacta de producto y validar que responde con dato puntual.
- [ ] Probar deuda proveedor exacta y ambigua (`deuda de X`) y validar aclaracion.
- [ ] Probar deuda cliente exacta y ambigua y validar aclaracion.
- [ ] Probar reporte de ventas (`ventas hoy`, `cuanto vendi ayer`) y validar totales.
- [ ] Probar reportes v14.2: `resumen del mes`, `vencimientos`, `ventas POS hoy`, `recibos del mes`, `libro IVA del mes`, `gasto por proveedor del mes`.
- [ ] Probar follow-up corto (`y ayer?`, `y del mes anterior?`, `telefono de la primera`) y verificar continuidad.
- [ ] Probar reporte masivo (`reporte de stock`, `deuda proveedores`) y verificar PDF + texto resumen.
- [ ] Probar `hola` / `ayuda` / `menu` y validar catalogo por modulo (v14.4).
- [ ] Probar pregunta fuera de catalogo y validar respuesta orientada (sin inventar datos).
- [ ] Probar adjunto factura (imagen) y nota de voz (ver runbook v14.4 adjuntos).
- [ ] Probar accion `registrar pago proveedor` con doble confirmacion.
- [ ] Probar accion `registrar cobro cliente` con doble confirmacion.
- [ ] Probar accion `ajustar stock` con doble confirmacion y restriccion por rol.

## Cadencia

- Ejecutar en cada PR que toque:
  - `src/lib/whatsapp/read-only-agent.ts`
  - `src/lib/whatsapp/text-handler.ts`
  - rutas webhook/cron de WhatsApp
- Guardar resultado de metricas en la descripcion del PR.
