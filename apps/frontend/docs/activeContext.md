---
estado: 🚧 En curso
version: v13.1
ultima_actualizacion: 2026-05-19
---

# Nexus — Contexto activo

## Qué estamos construyendo ahora

**Versión v13.1 — Auditoría UX/UI** (informe `docs/auditoria-ux-ui-smart-stock.md`)

Objetivo: fundación visual (tokens + contraste) y primeros cambios visibles de lenguaje en navegación, sin romper flujos de v13.0/v14.

Próximos 3 tickets (orden de ejecución):

1. **V131-UXAUD-002** — Sitemap: reorganizar navegación. **(todo)**
2. **V131-UXAUD-004** — Prevención de errores: CUIT y prellenado IA. **(todo)**
3. **V131-UXAUD-007** — Journey 1: ingreso con lector IA y ajuste de margen. **(todo)**

**Completados en v13.1:** `V131-UXAUD-010`, `V131-UXAUD-014`, `V131-UXAUD-005`, `V131-UXAUD-011`, `V131-UXAUD-012`, `V131-UXAUD-001`, `V131-UXAUD-009`, `V131-UXAUD-013`, `V131-UXAUD-015`, `V131-UXAUD-016`.

**Pendientes v13.0 (no bloquean v13.1):** `V130-COMP-001`, `V130-FACT-001`, `V130-IMP-004`, `V130-SUC-001`.

**Completados en v13.2 — Mejoras POS post-auditoría:** `V132-POS-001` (multi-venta en POS con carritos en espera, scoped por tenant/caja/cajero; atajos `Alt+N`/`Alt+1..4`/`Alt+W`; badge en sidebar; guard de cierre de caja con ventas en espera). Tests automatizados quedan como follow-up.

**Versión v14.0 — WhatsApp agéntico — COMPLETADO** (tickets `V140-WA-*` / `V141-WA-*`).

**Tooling local/CI:** `npm run lint` (ESLint 9 + Next flat config + guard sin `confirm`/`alert` nativos); `npm run check` (TypeScript + mismo guard). Workflow GitHub Actions en `.github/workflows/ci.yml`.

Contexto del bloque: integración WhatsApp ya existente en webhook + colas (`src/app/api/whatsapp/webhook/route.ts`, `src/app/api/cron/whatsapp/*`); v14 agregó identidad por actor, OTP, motor conversacional read-only, audio/STT, acción piloto con doble confirmación e idempotencia, y rollout por tenant con runbook operativo. Tickets `V140-WA-001` a `V140-WA-007` completados.

**Catálogo chatbot v14.2 documentado** en `docs/whatsapp-chatbot.md` (reportes, acciones, facturas sandbox, evals v14.9 / 122 casos, API `confirmar` de lector-facturas). Bloque `V142-WA-*` cerrado en código y docs.

**Versión v14.3 — WhatsApp NLU y catálogo ampliado** (backlog en `docs/TICKETS.md`, bloque `V143-WA-*`).

Próximos 3 tickets (orden sugerido):

1. **V143-WA-011+** — Según backlog `V143-WA-*` en `docs/TICKETS.md`.

**Completado v14.3:** `V143-WA-001`…`010` — NLU, cierre caja, ventas por artículo/SKU, extracto CC, cobranza por factura, ventas POS por caja/operador, contacto proveedor, comparativo ventas vs mes anterior (evals v14.18), factura live con ticket post-job (`whatsapp-sandbox-real-invoice.test.ts` live + readonly).

Detalle funcional y criterios en `docs/TICKETS.md`.

---

**Versión v7.0 — Cobranza por factura, campana `wa.me` y recibos — COMPLETADO**

Incluye: `cobranza_factura` / `cobranza_pago`, RPC `registrar_pago_cobranza`, campana en el header con WhatsApp vía `wa.me`, snooze 24 h, emisión de **recibo** tras cobro (`tipo_comprobante` `recibo`), historial de facturas/tickets/recibos en ficha de cliente. Ticket **V70-COB-001** cerrado. Detalle en `docs/cobranza.md` y migraciones `044`, `045`.

**Bloque G (MP Point) — UI:** cerrados **V70-MP-008**, **V70-MP-010**, **V70-MP-011** (configuración, botón Posnet, pantalla de espera + Realtime). Detalle y **siguiente paso** en `docs/PLAN-G.md` (sección *Seguimiento*).

**Lector de facturas con IA (Plan H):** núcleo implementado — migración **`046_lector_facturas_fase1.sql`**, rutas `/lector-facturas` y `/lector-facturas/historial`, APIs `extraer` / `confirmar` / `limite` / `logs`, flujo UX alineado a IA Precios, menú en **Importar** y **Facturación**. Acceso en app: `lector_facturas` **o** `facturador_simple` (`MODULOS_ACCESO_LECTOR_FACTURAS`). Documentación operativa: **`docs/lector-facturas.md`**; plan y decisiones: **`docs/PLAN-H.md`**.

---

**Versión v6.0 — Códigos de barra + POS con escáner — COMPLETADO**

Este bloque incorpora dos capacidades complementarias que conforman un facturador profesional con escáner láser:

1. **Gestión de códigos de barra en productos** — Cada producto puede tener código de barras (EAN-13), PLU para balanzas, y ser marcado como pesable. Incluye generación de códigos internos, validación, búsqueda por código e impresión de etiquetas.

2. **Terminal POS con escáner** — Pantalla tipo caja registradora optimizada para escaneo rápido con pistola láser. El operador escanea, se acumulan items, y al cobrar se emite ticket/factura reutilizando el motor de facturación existente.

3. **Módulo `facturador_pos`** — Nuevo feature flag en `modulo_config`, controlado como el resto de módulos, activable por plan.

**Criterio de cierre:** Un operador abre el POS, escanea 5 productos (incluyendo uno pesable con balanza), cobra en efectivo con vuelto, y se imprime un ticket térmico. El stock se descuenta correctamente.

**Ajuste posterior — código de barras y proveedor (migración `047` + API):** La misma barra puede repetirse en productos activos del tenant solo si tienen **distinto** `proveedor_id`. Si `proveedor_id` es `NULL`, solo un producto activo puede llevar esa barra. `POST /api/productos` rechaza (400) alta con barra y sin proveedor cuando **ya existe** cualquier producto activo con ese `codigo_barras`. En el POS, `GET /api/productos/buscar-por-barcode` sin `proveedor_id` devuelve **409** con lista si hay varios candidatos; con filtro de proveedor en la pantalla se desambigua.

**Ajuste posterior — códigos de barras / SKU texto con espacios:** `parseBarcode` acepta cadenas alfanuméricas con **espacios internos** y comillas típicas (p. ej. medidas), con `trim` solo en extremos; el POS intenta siempre `buscar-por-barcode` antes que la búsqueda por nombre. `buscar-productos` no normaliza espacios consecutivos y filtra también por `codigo_barras` en consultas no numéricas. El valor en catálogo debe coincidir con lo leído si se depende del match exacto.

**Ajuste posterior — proveedor inactivo y catálogo (migración `069`):** Al marcar `proveedor.activo = false`, el trigger `proveedor_inactivo_desactiva_productos` desactiva los productos con ese `producto.proveedor_id` (mismo tenant); no afecta vínculos solo por `producto_proveedor`. Documentado en `docs/stock.md` y `docs/base-de-datos.md`.

---

## Resumen de implementación completada

### Bloque G — Cobranza v7.0 (V70-COB-001)
- Migraciones 044–045, APIs cobranza y cliente/comprobantes, campana, recibo PDF, tests `cobranza-logic`

### Bloque D — ARCA v4.0 (V40-ARCA-001 a V40-TEST-002)
- Configuración de certificados y datos fiscales (WSAA + WSFE)
- Flujo de emisión con CAE post-emisión
- Cola de reintentos con Edge Function cron
- Regeneración de PDF con CAE, alerta de vencimiento de certificado
- Tests de integración contra homologación y cola de reintentos

### Fase 1 — Migraciones y tipos (V60-POS-001 a V60-POS-005)
- 4 migraciones SQL (024-027): barcode columns, NUMERIC quantities, facturador_pos flag, ticket comprobante type
- TypeScript types regenerated

### Fase 2 — APIs de producto (V60-POS-006 a V60-POS-012)
- EAN-13 library and barcode parser
- APIs: assign barcode, generate internal EAN-13, extend PATCH, search by barcode

### Fase 3 — Etiquetas (V60-POS-013 a V60-POS-014)
- Individual and batch label printing with bwip-js

### Fase 4 — Motor de emisión (V60-POS-015 a V60-POS-018)
- Migration for ticket type and metodo_pago
- BarcodeInput component, barcode search API
- Extended emission API (ticket type, metodo_pago, decimal quantities)

### Fase 5 — Pantalla POS (V60-POS-019 a V60-POS-022)
- Fullscreen POS layout, scan zone, cart management
- Cobro modal with cash/debit/credit/transfer/mixed payments
- Thermal ticket printing

### Fase 6 — Ergonomía y robustez (V60-POS-023 a V60-POS-026)
- Keyboard shortcuts (F1, F2, F4, F8, F12)
- Edge cases (offline, stock warnings)
- Cart persistence in localStorage
- POS configuration in /configuracion

### Fase 7 — Integración y tests (V60-POS-027 a V60-POS-029)
- Barcode column in importer
- Send to POS from orders
- 69 tests passing (unit + integration)

---

## Decisiones tomadas para v6.0

| Decisión | Resolución | Contexto |
|---|---|---|
| Integración del escáner | Teclado HID — sin drivers ni permisos | Cubre 99% de escáneres argentinos (Honeywell, Zebra, genéricos) |
| Variante de código de balanza | Peso embebido (no precio) | Estándar en almacenes/verdulerías argentinas; precio se mantiene en el sistema |
| Tres identificadores por producto | SKU + código_barras + PLU | Ortogonales: un producto puede tener cualquier combinación |
| Código de barras duplicado entre artículos | Permitido solo entre distintos `proveedor_id` (BD); sin proveedor, una sola fila activa por barra; alta vía API exige proveedor si la barra ya existe | Evita colisiones en POS y refuerza trazabilidad por proveedor |
| POS reutiliza motor de facturación | Llama al mismo `POST /api/facturacion/emitir` | Un solo motor fiscal, el POS es solo otra UI |
| Cantidad decimal vs campo peso | Migrar cantidad a NUMERIC(12,3) | Más limpio que un campo `peso` separado; una sola migración |
| Tipo de comprobante ticket | Nuevo valor en el ENUM | Numeración propia, PDF distinto (térmico), no fiscal |
| Impresión térmica | `window.print()` + CSS | Cubre 80% de los casos; qz-tray como opción futura documentada |

---

## Documentación completada

| Fase | Archivos | Estado |
|---|---|---|
| Fase 1 — Memory Bank base | `README.md`, `arquitectura.md`, `activeContext.md` | Completada |
| Fase 2 — DB y multi-tenancy | `base-de-datos.md`, `multi-tenancy.md`, `autenticacion.md` | Completada |
| Fase 3 — Módulos de negocio (par 1) | `modulos.md`, `stock.md` | Completada |
| Fase 3 — Módulos de negocio (par 2) | `importador.md`, `facturacion.md` | Completada |
| Fase 3 — Módulos de negocio (par 3) | `pedidos.md`, `ia-precios.md` | Completada |
| Fase 4 — ARCA y deploy | `arca.md`, `deploy.md` | Completada |
| Fase 5 — Analizador y rentabilidad | `analizador.md` | Completada |
| Fase 6 — Tickets bloques A-E | `TICKETS.md` | Completada (104 tickets) |
| Fase 7 — POS con escáner | `PLAN-BLOQUE-F.md`, `TICKETS.md` (bloque F) | Implementación completada (29/29 tickets, 119 pts) |
| WhatsApp chatbot v14.2 | `whatsapp-chatbot.md`, `whatsapp-chatbot-reportes.md`, `whatsapp-chatbot-acciones.md`, `whatsapp-chatbot-facturas.md` | Catálogo y runbook documentados (jun 2026) |
| Bloque G — Cobranza v7.0 | `TICKETS.md` (V70-COB-001), `cobranza.md` | Completado (1/1 ticket) |
| Plan H — Lector de facturas IA | `PLAN-H.md`, **`lector-facturas.md`**, migración `046` | Núcleo implementado (pendientes menores en PLAN-H) |

---

## Última actualización

**Fecha:** 2026-04-21
**Último ticket completado:** V70-COB-001 — Cuenta corriente por factura, recibos, campana de cobranza y enlace `wa.me`
**Bloque D (v4.0 ARCA):** Completado — 12/12 tickets
**Bloque E (v5.0 Analizador):** Completado — 25/25 tickets
**Bloque F (v6.0 POS):** Completado — 29/29 tickets (119 pts)
**Bloque G (v7.0 Cobranza):** Completado — 1/1 ticket
**Cobranza v7.0:** completada. **Lector de facturas (Plan H):** núcleo en producción de desarrollo; ver `docs/lector-facturas.md`.
