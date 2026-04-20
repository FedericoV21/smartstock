---
estado: ✅ Completado
version: v6.0
ultima_actualizacion: 2026-04-16
---

# Nexus — Contexto activo

## Qué estamos construyendo ahora

**Versión v6.0 — Códigos de barra + POS con escáner — COMPLETADO**

Este bloque incorpora dos capacidades complementarias que conforman un facturador profesional con escáner láser:

1. **Gestión de códigos de barra en productos** — Cada producto puede tener código de barras (EAN-13), PLU para balanzas, y ser marcado como pesable. Incluye generación de códigos internos, validación, búsqueda por código e impresión de etiquetas.

2. **Terminal POS con escáner** — Pantalla tipo caja registradora optimizada para escaneo rápido con pistola láser. El operador escanea, se acumulan items, y al cobrar se emite ticket/factura reutilizando el motor de facturación existente.

3. **Módulo `facturador_pos`** — Nuevo feature flag en `modulo_config`, controlado como el resto de módulos, activable por plan.

**Criterio de cierre:** Un operador abre el POS, escanea 5 productos (incluyendo uno pesable con balanza), cobra en efectivo con vuelto, y se imprime un ticket térmico. El stock se descuenta correctamente.

---

## Resumen de implementación completada

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

---

## Última actualización

**Fecha:** 2026-04-16
**Último ticket completado:** V60-POS-029 — Tests unitarios y de integración del POS
**Bloque D (v4.0 ARCA):** Completado — 12/12 tickets
**Bloque E (v5.0 Analizador):** Completado — 25/25 tickets
**Bloque F (v6.0 POS):** Completado — 29/29 tickets (119 pts)
**Todos los bloques implementados hasta v6.0.**
