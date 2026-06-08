# WhatsApp Chatbot — Acciones transaccionales

Acciones con **doble confirmación** (`SI <token>` de 4 dígitos o `cancelar`). Implementación: [`src/lib/whatsapp/action-handler.ts`](../src/lib/whatsapp/action-handler.ts).

Indice del chatbot: [`whatsapp-chatbot.md`](./whatsapp-chatbot.md).

## Requisitos

- Actor WhatsApp verificado (OTP).
- Rol distinto de `readonly` (operador, admin u owner).
- Feature flag del agente activo para el tenant.
- Módulo habilitado según la acción.

## Acciones disponibles

| Acción | Tool RPC | Módulo | Ejemplos de frase |
|--------|----------|--------|-------------------|
| Pago a proveedor | `registrar_pago_cuenta_proveedor` | `stock` | `registrar pago proveedor Arcor 50000`, `pagar proveedor Ginkgo $12500`, `pague 10 lucas al proveedor Coca` |
| Cobro a cliente | `registrar_pago_cliente_desde_cuenta_corriente` | `facturador_simple` | `registrar cobro cliente Juan Perez 15000`, `cobrar a cliente Kiosco Centro 2500`, `cobre 5 lucas al cliente Maria` |
| Cobro por factura/ticket | `registrar_pago_cobranza` | `facturador_simple` | `cobrar factura 42 cliente Juan Perez 5000`, `cobrar ultima factura cliente Kiosco Centro 2500`, `cobrar 15000 factura 0001-00000012 de cliente Maria` |
| Ajuste de stock | `registrar_movimiento` | `stock` | `ajustar stock Yerba Playadito +10`, `ajustar stock Coca 2.25L -3`, `sumar stock producto ABC 5` |

## NLU y memoria (v14.2)

Deteccion hibrida en [`action-intent.ts`](../src/lib/whatsapp/action-intent.ts):

1. **Reglas** en [`action-parsers.ts`](../src/lib/whatsapp/action-parsers.ts) para frases frecuentes y sinonimos rioplatenses.
2. **LLM** cuando la regla no alcanza, extrayendo slots (`action_type`, entidad, monto/cantidad) sin saltar la confirmacion.

Si falta entidad o monto, el bot repregunta usando [`conversation-memory.ts`](../src/lib/whatsapp/conversation-memory.ts) (mismo patron que reportes y deudas puntuales). El read-only no responde `unsupported_action` cuando hay un intent de accion confiable; deriva al handler de acciones.

## Sinonimos y variantes (referencia)

Lista completa en `action-parsers.ts`. Ejemplos representativos:

| Accion | Variantes aceptadas |
|--------|---------------------|
| Pago proveedor | `pagar proveedor X 5000`, `pague 10 lucas al proveedor Coca`, `registrar pago proveedor Arcor $12500`, monto antes o despues del nombre |
| Cobro cliente | `cobrar a cliente Juan 2500`, `cobre 5 lucas al cliente Maria`, `registrar cobro cliente Kiosco Centro 15000` |
| Cobro por factura | `cobrar factura 42 cliente Juan 5000`, `cobrar ultima factura cliente Kiosco`, referencia `0001-00000012` o número corto |
| Stock | `ajustar stock Producto +10`, `sumar stock producto ABC 5`, cantidad con signo `+` / `-` |

Montos: numeros, `$`, y coloquialismos (`lucas`, `k`) segun parsers.

## Rol x accion

| Rol WhatsApp | Consultas read-only | Iniciar accion | Confirmar `SI <token>` |
|--------------|---------------------|----------------|-------------------------|
| `readonly` / `visor` | Si | No | No |
| `operador` | Si | Si | Si |
| `admin` / `owner` | Si | Si | Si |

En sandbox, las acciones usan `whatsapp_sandbox_pending_action` en lugar de `whatsapp_action_log`.

## Flujo

1. El usuario envía la frase con entidad y monto/cantidad.
2. El bot responde con un resumen y un código de 4 dígitos.
3. El usuario confirma con `SI 1234` o cancela con `cancelar`.
4. Se registra en `whatsapp_action_log` (canal real) o simulación en sandbox.

## Sandbox

En `/whatsapp` (sandbox), las acciones corren en modo `simulate`: validan parsing y confirmación sin ejecutar RPCs.

## Fuera de alcance actual

- Pedidos / presupuestos.
- Cierre de caja desde el chat (solo consulta read-only de arqueo).

Ver backlog v14.3 en `docs/TICKETS.md` (`V143-WA-*`).
