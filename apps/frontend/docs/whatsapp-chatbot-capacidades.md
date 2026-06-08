# SmartStock — Capacidades del chatbot WhatsApp

**Documento de referencia** · Generado para exportación a PDF  
**Proyecto:** SmartStock · **Ámbito:** Agente conversacional WhatsApp + sandbox `/whatsapp`

**Roadmap en desarrollo (v14.4):** [`whatsapp-chatbot-roadmap-v14.4.md`](./whatsapp-chatbot-roadmap-v14.4.md) · Tickets: [`TICKETS.md`](./TICKETS.md) (`V144-WA-001` … `011`)

---

## 1. Resumen ejecutivo

El chatbot de SmartStock es un agente conversacional por tenant que permite:

- **Consultas de solo lectura** sobre ventas, stock, deudas, contactos y reportes.
- **Acciones transaccionales** con doble confirmación (pagos, cobros, ajustes de stock).
- **Carga de facturas de proveedor** con IA, matching de catálogo y confirmación antes de impactar datos.

No inventa datos: consulta la base de datos del negocio o repregunta cuando falta información.

---

## 2. Canales disponibles

| Canal | Uso | Consultas | Acciones | Facturas |
|-------|-----|-----------|----------|----------|
| **Sandbox** (`/whatsapp`) | Pruebas en la aplicación web | Texto → mismo motor que producción | Modo `simulate` (sin modificar datos) | Upload + ticket conversacional |
| **WhatsApp live** (Meta Cloud API) | Producción con clientes reales | Texto + audio (transcripción STT) | Ejecuta RPC con `SI <token>` | Adjunto PDF/imagen → job + ticket |
| **API pública** | Integradores externos | No aplica al chatbot | No aplica | Jobs async + `POST .../confirmar` |

---

## 3. Requisitos y seguridad

### 3.1 Requisitos transversales

| Requisito | Detalle |
|-----------|---------|
| Actor WhatsApp | Vinculación OTP (`whatsapp_actor` + `whatsapp_auth_challenge`) |
| Feature flag | `whatsapp_agent_feature_flag.enabled = true` por tenant |
| Módulos | Cada intent exige el módulo activo en `modulo_config` |
| Rol — consultas | Cualquier actor verificado |
| Rol — acciones y facturas | No `readonly` ni `visor` |
| Rol — ajuste de stock | Solo `admin` u `owner` |

### 3.2 Principios de seguridad

- Solo responde a actores WhatsApp verificados asociados a un tenant.
- Todas las consultas se ejecutan con `tenantId` explícito.
- Las consultas read-only **no crean, modifican ni eliminan** datos.
- Si falta un módulo requerido, informa que el módulo no está habilitado.

---

## 4. Flujo de procesamiento de mensajes

Cada mensaje de texto (o audio transcrito) sigue este orden:

1. **Autenticación** del actor y verificación del feature flag.
2. Si hay un **ticket de factura activo** y el texto coincide con un comando de ticket → manejo de factura (revisar, buscar, enlazar, confirmar).
3. Si el texto es **confirmación o cancelación** de una acción pendiente → `action-handler`.
4. Si no aplica lo anterior → **agente read-only** (reglas + LLM + herramientas a la base de datos).

En WhatsApp live, los mensajes de **voz** se transcriben mediante STT (OpenAI) y se procesan como texto.

---

## 5. Consultas de solo lectura

### 5.1 Periodos soportados

Los reportes comerciales aceptan:

- `hoy`
- `ayer`
- `esta semana`
- `este mes` / `mes`
- `mes anterior` / `mes pasado`
- Meses por nombre: `enero`, `febrero`, `marzo`, etc.

Si el usuario nombra un mes sin año, se usa el año actual; si ese mes aún no ocurrió en el año corriente, se usa el año anterior.

---

### 5.2 Catálogo de reportes

| Reporte | Qué responde | Módulo requerido | Ejemplos de frase |
|---------|--------------|------------------|-------------------|
| **Ventas** | Ventas netas, cantidad de comprobantes, facturas, tickets POS, notas de crédito, ticket promedio | facturador_simple | `ventas hoy`, `cuanto vendimos en mayo` |
| **Productos más vendidos** | Ranking top 5 por unidades e importe (sin margen) | facturador_simple | `productos mas vendidos`, `ranking productos abril` |
| **Ventas por artículo** | Ranking top 10 por SKU con unidades, importe y margen; PDF si hay más de 40 artículos | facturador_simple + analizador_rentabilidad | `ventas por articulo hoy`, `top sku mayo` |
| **Ventas por cliente** | Ranking de clientes que más compraron | facturador_simple | `clientes que mas compraron`, `mejores clientes` |
| **Ganancias** | Ventas netas, costo de mercadería, margen bruto y % | facturador_simple | `ganancia del mes`, `rentabilidad mayo` |
| **Medios de pago** | Total vendido por medio de pago | facturador_simple | `medios de pago hoy`, `formas de pago en mayo` |
| **Resumen comercial** | Ingresos netos, facturas vs tickets, NC, deuda CC activa | facturador_simple | `resumen del mes`, `como venimos` |
| **Comparativo de ventas** | Ingresos actuales vs mes calendario anterior (delta $ y %) | facturador_simple | `ventas vs mes pasado`, `comparativo ventas mayo` |
| **Ventas POS** | Tickets POS: cantidad, total, ticket promedio, franja horaria pico; filtros opcionales por caja y/o operador | facturador_pos | `ventas POS hoy`, `tickets pos caja 2 operador Maria` |
| **Recibos** | Recibos emitidos con cliente y medio de pago | facturador_simple | `recibos del mes`, `recibos hoy` |
| **Libro IVA** | Neto gravado, IVA y total de comprobantes fiscales | facturador_simple + analizador_rentabilidad | `libro IVA`, `iva del mes` |
| **Gasto por proveedor** | Ranking de costo vendido por proveedor | facturador_simple + analizador_rentabilidad | `gasto por proveedor`, `ranking proveedores` |
| **Stock general** | Stock total por producto activo (paginado; PDF si es extenso) | stock | `reporte de stock`, `inventario general` |
| **Stock bajo** | Productos con stock ≤ stock mínimo | stock | `stock bajo`, `faltantes` |
| **Deuda clientes** | Clientes con saldo pendiente en cuenta corriente | facturador_simple | `me deben`, `deuda clientes` |
| **Deuda proveedores** | Proveedores con saldo pendiente (PDF si es extenso) | stock | `yo debo`, `deuda proveedores` |
| **Vencimientos** | Productos que vencen en 30 días | stock | `vencimientos`, `que vence` |
| **Cierre de caja** | Arqueo read-only: cierre Z del día o snapshot del turno abierto (`hoy` / `ayer`) | facturador_simple | `cierre de caja hoy`, `estado del turno` |

#### Limitaciones — cierre de caja (v1)

- Usa la **primera sucursal activa** del tenant (no se elige sucursal por chat).
- No filtra por caja individual en el listado: muestra todas las cajas con cierre en el día.
- Solo periodos `hoy` y `ayer` (no mes/semana nombrados).

#### Limitaciones — comparativo de ventas (v1)

- Solo **ingresos netos** agregados (no margen ni ranking de productos).
- Por defecto: este mes (parcial) vs mes anterior (calendario completo).
- Con mes nombrado (ej. `mayo`): compara ese mes vs el mes calendario inmediato anterior.

---

### 5.3 Consultas puntuales (no son reportes agregados)

| Consulta | Qué responde | Ejemplos |
|----------|--------------|----------|
| **Stock de un producto** | Stock actual de un producto específico | `stock de yerba playadito`, `cuanto stock tengo de coca` |
| **Producto con menor stock** | El producto con la menor cantidad | `producto con menos stock` |
| **Deuda de un cliente** | Saldo pendiente de un cliente puntual | `cuanto me debe Juan Perez`, `deuda cliente Kiosco Centro` |
| **Extracto cuenta corriente** | Movimientos CC del periodo (top 8 líneas; PDF si >40 movimientos) | `extracto cc Juan Perez`, `historial cc Kiosco mayo` |
| **Deuda de un proveedor** | Saldo pendiente con un proveedor puntual | `cuanto le debo a proveedor Arcor` |
| **Contacto de cliente** | Teléfono, email, dirección o datos generales | `telefono de Ana Garcia`, `mail de cliente Juan` |
| **Contacto de proveedor** | Teléfono, email, dirección o datos generales | `telefono del proveedor Arcor` |

---

### 5.4 Memoria conversacional y follow-ups

El bot guarda **memoria corta** de slots conversacionales (no historial permanente completo).

Puede resolver continuaciones como:

| Follow-up | Ejemplo de uso |
|-----------|----------------|
| Cambio de periodo | `y ayer?`, `y del mes anterior?`, `y de mayo?` |
| Referencia a resultado anterior | `la primera`, `telefono de la primera` |
| Continuación de tema | `y su correo`, `seguí` |

**Ejemplo de conversación:**

1. Usuario: `productos mas vendidos`
2. Bot: ranking del mes actual.
3. Usuario: `y del mes anterior?`
4. Bot: interpreta `productos mas vendidos mes anterior`.

---

### 5.5 Entrega de documentos PDF

Algunos reportes superan el límite práctico de texto en WhatsApp. En esos casos el bot envía un **resumen corto** y adjunta un **PDF** generado en servidor:

| Reporte | Comportamiento |
|---------|----------------|
| Stock general | Resumen primera página + PDF completo |
| Deuda proveedores | Igual cuando la lista es larga |
| Ventas por artículo | PDF si hay más de 40 artículos |
| Extracto CC cliente | PDF si hay más de 40 movimientos |

En el **sandbox**, el link del PDF aparece en el mismo hilo. En **WhatsApp live**, se encola un mensaje tipo `document`.

---

## 6. Acciones transaccionales

Todas las acciones requieren **doble confirmación** con un código de **4 dígitos** (`SI 1234`) o cancelación con `cancelar`. El código vence en **10 minutos**.

### 6.1 Acciones disponibles

| Acción | Descripción | Módulo | Rol mínimo |
|--------|-------------|--------|------------|
| **Pago a proveedor** | Registra pago en cuenta corriente del proveedor | stock | operador |
| **Cobro a cliente** | Registra cobro en cuenta corriente del cliente | facturador_simple | operador |
| **Cobro por factura/ticket** | Imputa cobro a una factura o ticket específico del cliente | facturador_simple | operador |
| **Ajuste de stock** | Suma, resta o fija cantidad de stock de un producto | stock | admin / owner |

### 6.2 Ejemplos de frases

**Pago a proveedor**

- `registrar pago proveedor Arcor 50000`
- `pagar proveedor Ginkgo $12500`
- `pague 10 lucas al proveedor Coca`

**Cobro a cliente**

- `registrar cobro cliente Juan Perez 15000`
- `cobrar a cliente Kiosco Centro 2500`
- `cobre 5 lucas al cliente Maria`

**Cobro por factura**

- `cobrar factura 42 cliente Juan Perez 5000`
- `cobrar ultima factura cliente Kiosco Centro 2500`
- `cobrar 15000 factura 0001-00000012 de cliente Maria`

**Ajuste de stock**

- `ajustar stock Yerba Playadito +10`
- `ajustar stock Coca 2.25L -3`
- `sumar stock producto ABC 5`
- `cambiar stock Yerba Playadito a 50` (fijar cantidad objetivo)

### 6.3 Formas de confirmar o cancelar

| Frase | Efecto |
|-------|--------|
| `SI 1234` | Confirma con el token indicado |
| `1234` | Solo el token (también confirma) |
| `cancelar`, `cancelo`, `no` | Cancela la acción pendiente |

### 6.4 Detección de intención (NLU)

- **Reglas** para frases frecuentes y sinónimos rioplatenses.
- **LLM** cuando las reglas no alcanzan, extrayendo entidad y monto/cantidad.
- Si faltan datos, **repregunta** usando memoria conversacional.
- Montos: números, `$`, y coloquialismos (`lucas`, `k`).
- **Idempotencia**: no duplica la misma acción para el mismo mensaje.

### 6.5 Modo sandbox

En `/whatsapp`, las acciones corren en modo **simulate**: validan parsing y confirmación **sin ejecutar** cambios en la base de datos.

### 6.6 Matriz de permisos por rol

| Rol WhatsApp | Consultas | Iniciar acción | Confirmar `SI <token>` | Ajustar stock |
|--------------|-----------|----------------|------------------------|---------------|
| `readonly` / `visor` | Sí | No | No | No |
| `operador` | Sí | Sí | Sí | No |
| `admin` / `owner` | Sí | Sí | Sí | Sí |

---

## 7. Facturas de proveedor (IA)

Flujo de carga de facturas con extracción por IA, matching de catálogo y confirmación de impacto antes de aplicar stock, costos y cuenta corriente.

### 7.1 Superficies

| Superficie | Cómo se inicia | Conversación por texto |
|------------|----------------|------------------------|
| Sandbox `/whatsapp` | Upload de PDF o imagen en la UI | Sí: comandos de revisión y confirmación |
| WhatsApp live | Adjunto PDF o imagen | Sí: mismos comandos que sandbox |
| API pública | `POST /api/public/lector-facturas/jobs` | El integrador implementa su propia UX |

### 7.2 Requisitos

- Módulo `lector_facturas` o `facturador_simple` activo.
- Rol distinto de `readonly` / `visor` para cargar, enlazar y confirmar.
- En sandbox: sucursal seleccionada en la UI.

### 7.3 Etapas del ticket

| Etapa | Qué ocurre |
|-------|------------|
| **Subida** | PDF/imagen → IA + matching → job + ticket conversacional |
| **Preview** | Resumen proveedor, ítems, advertencias, bloqueantes, token de 4 dígitos |
| **Revisión** | Listar pendientes, buscar producto, enlazar opción |
| **Confirmar** | Aplica comprobante importado si no hay bloqueantes |
| **Cerrar** | Descarta el ticket sin aplicar |

Estados típicos: `pending_review` → `ready` → `applied` (o cerrado sin aplicar).

### 7.4 Comandos de chat

#### Confirmar / aplicar

| Frase (ejemplos) | Efecto |
|------------------|--------|
| `SI 1234` | Confirma con token de 4 dígitos |
| `ok`, `si`, `dale`, `confirmo` | Confirma usando token del resumen |
| `confirmar`, `cargar`, `continuar`, `aplicar` | Idem |
| `1234` | Solo el token |

#### Revisión de ítems pendientes

| Frase | Efecto |
|-------|--------|
| `revisar`, `pendientes`, `productos`, `ver pendientes`, `listar pendientes`, `detalle` | Lista ítems sin vincular o a revisar |

#### Buscar y enlazar catálogo

| Frase | Efecto |
|-------|--------|
| `buscar 1 yerba playadito` | Busca productos para el ítem **1** |
| `busca 2 coca` | Variante |
| `enlazar 1 2` | Usa la opción **2** de la última búsqueda del ítem **1** |

Alias de búsqueda: `producto`, `productos` en lugar de `buscar` / `busca`.  
Alias de enlace: `vincular`, `usar`, `elegir`.

**Orden obligatorio para enlazar:** primero `buscar N ...`, luego `enlazar N opción`.

#### Cerrar ticket

| Frase | Efecto |
|-------|--------|
| `cerrar`, `cancelar`, `cancelo`, `no` | Cierra el ticket activo sin aplicar |

### 7.5 Rol readonly en facturas

Puede usar `revisar` y ver pendientes. **No puede** confirmar, cargar, buscar para enlazar ni enlazar productos.

### 7.6 Ejemplo de conversación

```
Usuario: [sube factura-proveedor.pdf]
Bot:     Proveedor Arcor SA — 12 ítems — 2 pendientes de vincular.
         Ítem 1: Yerba 1kg (sin match)
         Para confirmar: SI 4821 (vence en 15 min)

Usuario: buscar 1 yerba playadito
Bot:     Ítem 1 — opciones:
         1) Yerba Playadito 1kg (SKU YER-1)
         2) Yerba Noble 1kg
         Responde: enlazar 1 1

Usuario: enlazar 1 1
Bot:     Ítem 1 vinculado a Yerba Playadito 1kg. Queda 1 pendiente.

Usuario: revisar
Bot:     Ítem 2: Gaseosa 2.25L — requiere revisión manual en app.

Usuario: SI 4821
Bot:     Factura aplicada. Comprobante #1234. Stock y CC actualizados.
```

---

## 8. Audio en WhatsApp live

- Los mensajes de **voz** se transcriben automáticamente (STT vía OpenAI).
- El texto transcrito entra al mismo flujo que un mensaje escrito.
- Requiere `OPENAI_API_KEY` y `WHATSAPP_STT_PROVIDER` habilitado.

---

## 9. Diagrama de flujo general

```
                    ┌─────────────────┐
                    │  Mensaje entrante │
                    └────────┬────────┘
                             │
              ┌──────────────▼──────────────┐
              │ ¿Ticket de factura activo?  │
              └──────┬──────────────┬───────┘
                  Sí │              │ No
         ┌──────────▼───┐          │
         │ Revisar /     │          │
         │ buscar /      │          │
         │ enlazar /     │          │
         │ confirmar     │          │
         └───────────────┘          │
                    ┌──────────────▼──────────────┐
                    │ ¿Acción pendiente de        │
                    │ confirmación?               │
                    └──────┬──────────────┬───────┘
                        Sí │              │ No
               ┌───────────▼───┐          │
               │ SI <token> /  │          │
               │ cancelar      │          │
               └───────────────┘          │
                          ┌─────────────▼─────────────┐
                          │ ¿Nueva acción transaccional?│
                          └──────┬──────────────┬─────┘
                              Sí │              │ No
                     ┌───────────▼───┐   ┌──────▼──────────┐
                     │ Pago / cobro /│   │ Reportes y      │
                     │ stock → pedir │   │ consultas         │
                     │ confirmación  │   │ read-only         │
                     └───────────────┘   └───────────────────┘
```

---

## 10. Lo que NO hace todavía

| Funcionalidad | Estado |
|---------------|--------|
| Pedidos / presupuestos desde el chat | No disponible |
| Reportes de compras / importaciones | No disponible |
| Exportación CSV desde WhatsApp | No disponible |
| Elegir sucursal dentro del chat | No disponible |
| Ventas por artículo con filtros avanzados de categoría/proveedor | Solo en la web |
| Comparativos semana vs semana u otros periodos custom | No disponible (solo comparativo mensual) |
| Cierre de caja ejecutado desde el chat | Solo consulta read-only de arqueo |

---

## 11. Troubleshooting — adjuntos y sucursal

Si en `/whatsapp` el job queda en **Esperando sucursal** con `multiple_active_branches_without_rule`:

1. El negocio tiene **varias sucursales activas** y no hay regla en `whatsapp_branch_rule`.
2. Por WhatsApp el bot debe pedir: «indicá la sucursal respondiendo con el número» — respondé `1`, `2`, etc.
3. Hasta confirmar sucursal, la **factura no se procesa** (no llega al lector IA).
4. **Reintentar** en el panel sin haber confirmado sucursal no alcanza (falta `branch_id`).

**Audio:** el flujo actual no exige sucursal; si un audio aparece en espera de sucursal, suele ser un job antiguo. Requiere feature flag del agente, `OPENAI_API_KEY` y crons `process-queued` / `send-outbound`.

Mejoras planificadas: tickets `V144-WA-001` … `V144-WA-004` en [`whatsapp-chatbot-roadmap-v14.4.md`](./whatsapp-chatbot-roadmap-v14.4.md).

---

## 12. Referencias técnicas

| Recurso | Ubicación |
|---------|-----------|
| Índice general del chatbot | `docs/whatsapp-chatbot.md` |
| Roadmap v14.4 (conversacional + adjuntos) | `docs/whatsapp-chatbot-roadmap-v14.4.md` |
| Catálogo de reportes | `docs/whatsapp-chatbot-reportes.md` |
| Acciones transaccionales | `docs/whatsapp-chatbot-acciones.md` |
| Facturas | `docs/whatsapp-chatbot-facturas.md` |
| Runbook operativo | `docs/whatsapp-agentico-runbook.md` |
| Motor de texto | `src/lib/whatsapp/text-handler.ts` |
| Agente read-only | `src/lib/whatsapp/read-only-agent.ts` |
| Acciones | `src/lib/whatsapp/action-handler.ts` |
| Evals automatizados | `src/test/whatsapp-agent-evals.test.ts` |

---

*Fin del documento.*
