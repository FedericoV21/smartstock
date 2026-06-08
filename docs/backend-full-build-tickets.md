# SmartStock — Backlog backend completo (PostgreSQL + Nest)

**Estrategia:** terminar el backend contra **PostgreSQL**, probado con **Postman / Thunder / Swagger**. El frontend Next es **especificación de producto** (254 rutas API); la integración UI viene **después**.

**Convención ID:** `NB-<BLOQUE>-<NNN>` (mismo que `backend-nest-tickets.md`). Los tickets **ya hechos** no se repiten; este doc ordena lo **pendiente** por fases.

**Fuente de verdad de dominio:** rutas en `apps/frontend/src/app/api/**` + SQL en `apps/frontend/supabase/migrations`.

---

## Fase 0 — Cerrar MVP actual (ya construido, falta validar)

| ID | Título | Estado | Acción |
|----|--------|--------|--------|
| NB-ARC-106 | Homologación ARCA e2e | toolkit + runner + evidence API listos; **pendiente** corrida manual AFIP |
| NB-QA-001 | CI unit + e2e Postgres | **done** | `.github/workflows/backend-ci.yml` |
| **NB-TOOL-001** | Colección Postman/Thunder + env | **done** | Ver abajo |
| **NB-TOOL-002** | Guía “probar API sin frontend” | **done** | Ver abajo |

### NB-TOOL-001 — Colección Postman/Thunder Client
- Prioridad: critical | Est: 3 | Dep: NB-SEC-001 | **Estado: done**
- Criterios:
  - [x] Carpeta `apps/backend/docs/postman/` con colección v2.1 o Thunder import JSON.
  - [x] Variables: `baseUrl`, `accessToken`, `idempotencyKey` + IDs demo (branch, comprobante, pedido, ARCA worker).
  - [x] Requests por módulo implementado (health, auth, catalog, CC cliente/proveedor, products, inventory, import, AI, pricing, facturación, pedidos workflow, ARCA).
  - [x] Ejemplos de body alineados a Swagger. Índice: `apps/backend/docs/postman/README.md`.

### NB-TOOL-002 — Runbook pruebas manuales API
- Prioridad: high | Est: 1 | Dep: NB-TOOL-001 | **Estado: done**
- Criterios:
  - [x] Doc: obtener JWT desde Supabase Auth, alinear `JWT_SECRET`, correr seed demo.
  - [x] Flujo feliz documentado: crear producto → movimiento → emitir comprobante (+ CC, workflow, ARCA).

---

## Fase 1 — Esquema base de negocio (paridad Supabase 001–012)

Portar a Postgres Nest las tablas que el producto da por sentadas y que hoy **no existen** en baseline.

| ID | Título | Est | Dep |
|----|--------|-----|-----|
| **NB-SCH-001** | Migración `tenant` extendido + `modulo_config` | 5 | NB baseline | **done** |
| **NB-SCH-002** | Migración `usuario` (perfil app, no auth credentials) | 3 | NB-SCH-001 | **done** |
| **NB-SCH-003** | Migración `categoria`, `proveedor`, `cliente` | 5 | NB-SCH-001 | **done** |
| **NB-CAT-001** | API categorías CRUD | 3 | NB-SCH-003 | **done** |
| **NB-PROV-001** | API proveedores CRUD + listado | 5 | NB-SCH-003 | **done** |
| **NB-CLI-001** | API clientes CRUD + búsqueda | 5 | NB-SCH-003 | **done** |
| **NB-TEN-001** | Tenant efectivo super-admin | 5 | NB-SEC-002 | **done** |
| **NB-TEN-002** | Admin tenants-access + switch-tenant | 3 | NB-TEN-001 | **done** |
| **NB-CFG-001** | `GET/PATCH` tenant profile + `modulo_config` lectura | 5 | NB-SCH-001 | **done** (GET tenant + modules) |
| **NB-CFG-002** | PATCH tenant, usuarios CRUD, business-prefs, logo | 8 | NB-CFG-001 | **done** |

**Referencia front:** `/api/categorias`, `/api/proveedores`, `/api/clientes`, `/api/configuracion/tenant`, `/api/configuracion/plan`.

---

## Fase 2 — Completar core stock y catálogo (productos 22 rutas)

Nest tiene CRUD básico; el front agrega sucursales, variantes, promociones, bulk, etc.

| ID | Título | Est | Dep |
|----|--------|-----|-----|
| **NB-PRD-010** | `GET` listados extendidos (filtros alineados a front) | 3 | NB-PRD-001 | **done** |
| **NB-PRD-011** | Generar código interno / EAN (`generar-codigo`) | 3 | NB-BAR-003 | **done** |
| **NB-PRD-012** | Imagen producto (storage S3/R2) | 5 | NB-PRD-001 | **done** |
| **NB-PRD-013** | Bulk ganancia / bulk por filtro | 5 | NB-PRD-001 | **done** |
| **NB-PRD-014** | Fusión de productos | 5 | NB-PRD-001 | **done** |
| **NB-SUC-001** | Migración `sucursal` + sucursal activa contexto | 5 | NB-SCH-001 | **done** |
| **NB-SUC-002** | Stock por sucursal (`producto_stock_sucursal`) | 8 | NB-SUC-001, NB-INV-001 | **done** |
| **NB-SUC-003** | Precio/PLU por sucursal | 5 | NB-SUC-001 | **done** |
| **NB-VAR-001** | Producto variantes + stock variante | 8 | NB-SUC-002 | **done** |
| **NB-STK-001** | Transferencias entre sucursales | 8 | NB-SUC-002 | **done** |
| **NB-STK-002** | Export balanza / materializar stock | 3 | NB-SUC-002 | **done** |
| **NB-PROM-001** | Promociones + mapa vigente | 8 | NB-PRD-001 | **done** |
| **NB-LOT-001** | Lotes y vencimientos por producto | 5 | NB-PRD-001 | **done** |

**Referencia front:** `/api/productos/*`, `/api/stock/*`, `/api/promociones/*`.

---

## Fase 3 — Importador, precios e IA (14 rutas importar + ia)

| ID | Título | Est | Dep |
|----|--------|-----|-----|
| **NB-IMP-010** | Borradores importación (metadata + chunks) | 8 | NB-IMP-002 | **done** |
| **NB-IMP-011** | Logs importación + revertir | 5 | NB-IMP-002 | **done** |
| **NB-IMP-012** | Obligación proveedor / productos enlazables | 3 | NB-PROV-001 | **done** |
| **NB-IMP-013** | Convertir PDF lista (si aplica en Nest) | 5 | NB-IMP-010 | **done** |
| **NB-IA-001** | Límite y extracción IA precios (Gemini/OpenRouter) | 8 | NB-IMP-002 | **done** |
| **NB-PRC-010** | API `/precios/historial` paridad front | 2 | NB-PRC-001 | **done** |

**Referencia front:** `/api/importar/*`, `/api/ia/*`, `/api/precios/historial`.

---

## Fase 4 — Facturación, presupuestos, cobranza, caja (13+ rutas)

| ID | Título | Est | Dep |
|----|--------|-----|-----|
| **NB-FAC-010** | `GET` listado y detalle comprobantes | 5 | NB-FAC-001 | **done** |
| **NB-FAC-011** | PDF download + regeneración | 3 | NB-FAC-003 | **done** |
| **NB-FAC-012** | Anular sin CAE / revertir importada | 5 | NB-FAC-001 | **done** |
| **NB-FAC-013** | Bandeja ARCA + alertas | 3 | NB-ARC-104 | **done** |
| **NB-FAC-014** | Reintentar CAE comprobante existente | 5 | NB-ARC-103 | **done** |
| **NB-FAC-015** | Compra proveedor manual | 5 | NB-PROV-001 | **done** |
| **NB-PAY-001** | Migración medios de pago + opciones | 5 | NB-FAC-001 | **done** |
| **NB-PAY-002** | API medios de pago + atajos rápidos | 5 | NB-PAY-001 | **done** |
| **NB-FAC-004** | Emisión con financiación y pago mixto | 8 | NB-PAY-002 | **done** |
| **NB-PRE-001** | Presupuestos CRUD + conversiones | 8 | NB-FAC-001, NB-PED-001 | **done** |
| **NB-COB-001** | Cobranza pendientes + pagos | 8 | NB-CLI-001, NB-FAC-010 | **done** |
| **NB-COB-002** | Cobranza campaña completa + recibo + GET list | 5 | NB-COB-001 | **done** |
| **NB-CAJA-001** | Turnos caja abrir/cerrar + historial | 8 | NB-FAC-004 | **done** |
| **NB-POS-001** | Endpoints POS catálogo/borrador (read-heavy) | 5 | NB-PRD-010, NB-PROM-001 | **done** |

**Referencia front:** `/api/facturacion/*`, `/api/presupuestos/*`, `/api/cobranza/*`, `/api/caja/*`, `/api/pos/*`, `/api/configuracion/medios-de-pago/*`.

---

## Fase 5 — Pedidos, cuenta corriente, proveedores avanzado

| ID | Título | Est | Dep |
|----|--------|-----|-----|
| **NB-PED-010** | Workflow estados configurables | 5 | NB-PED-001 | **done** |
| **NB-PED-011** | Transiciones workflow | 3 | NB-PED-010 | **done** |
| **NB-CC-001** | Cuenta corriente cliente (movimientos, extracto, liquidar) | 8 | NB-CLI-001 | **done** |
| **NB-CC-002** | Cuenta corriente proveedor + pagos múltiples | 8 | NB-PROV-001 | **done** |
| **NB-PROV-010** | Fusionar proveedores + facturas importadas | 5 | NB-PROV-001 | **done** |

**Referencia front:** `/api/pedidos/*`, `/api/clientes/[id]/cuenta-corriente/*`, `/api/proveedores/[id]/*`.

---

## Fase 6 — Reportes, dashboard, analizador, tesorería

| ID | Título | Est | Dep |
|----|--------|-----|-----|
| **NB-RPT-001** | Reportes ventas/resumen/libro IVA (core) | 8 | NB-FAC-010 | **done** |
| **NB-RPT-002** | Reportes stock/reposición/ganancias | 8 | NB-INV-002 | **done** |
| **NB-DSH-001** | Dashboard métricas | 5 | NB-FAC-010, NB-INV-003 | **done** |
| **NB-ANL-001** | Módulo analizador rentabilidad (API) | 13 | NB-RPT-002 | **done** |
| **NB-LST-001** | Listas de precios analizador (confirm/matching/aplicar) | 8 | NB-ANL-001 | **done** |
| **NB-LST-002** | Preview upload Excel/PDF + matching IA | 5 | NB-LST-001 | **done** |
| **NB-LST-003** | Comparar / simular / clonar sucursal | 5 | NB-LST-002 | **done** |
| **NB-ANL-002** | Proveedores comparar/perfil + reporte IA + CC analizador | 8 | NB-LST-001 | **done** |
| **NB-TES-001** | Tesorería movimientos, cheques, obligaciones | 8 | NB-CAJA-001 | **done** |

**Referencia front:** `/api/reportes/*`, `/api/dashboard/*`, `/api/analizador/*`, `/api/tesoreria/*`.

---

## Fase 7 — Pasarelas y pagos (24 rutas)

Reutilizar diseño en `backend-nest-tickets.md` bloque K + ampliar:

| ID | Título | Est | Dep |
|----|--------|-----|-----|
| NB-MPP-001 … NB-MPP-006 | MP Point (ya definidos) | — | NB-FAC-004 | **001–006 done** |
| **NB-MPQ-001** | MP QR iniciar/estado/cancelar/webhook | 8 | NB-CFG-001 | **done** |
| **NB-MPT-001** | MP Transferencia verificar/confirmar | 5 | NB-CFG-001 | **done** |
| **NB-PAS-001** | Pasarelas unificadas + integraciones | 8 | NB-CAJA-001 | **done** |

**Referencia front:** `/api/pagos/*`, `/api/pasarelas/*`, `/api/configuracion/mp-*`.

---

## Fase 7b — Gaps cutover frontend (post core)

Rutas que el front **ya usa** pero Nest aún no expone (o expone distinto). Inventario completo: **`backend-frontend-gaps.md`**.

| ID | Título | Est | Dep |
|----|--------|-----|-----|
| **NB-CFG-003** | Config: CRUD cajas, plan, pos-prefs, ia-ilimitada, forzar-cierre | 8 | NB-CFG-002 | **done** |
| **NB-CFG-004** | Config: roles custom, pin, permisos-extra, sucursales usuario, local | 8 | NB-CFG-002 | **done** |
| **NB-PAS-002** | Cobros pasarela unificada + webhook genérico | 8 | NB-PAS-001 | **done** |
| **NB-MPT-002** | MP Transferencia diagnóstico + configurar-reportes | 3 | NB-MPT-001 | **done** |
| **NB-CAJA-002** | Gastos sesión, historial movimientos, resumen cierre Z | 5 | NB-CAJA-001 | **done** |
| **NB-FAC-016** | POST comprobante arca-encolar | 2 | NB-ARC-104 | **done** |
| **NB-RPT-003** | Reportes recibos + extractos CC agregados | 5 | NB-RPT-001 | **done** |
| **NB-CC-003** | CC liquidación comprobante, revertir pago, cargos-hoy | 5 | NB-CC-001/002 | **done** |
| **NB-CLI-002** | GET clientes/:id/comprobantes | 2 | NB-CLI-001 | **done** |
| **NB-PROV-011** | GET proveedores/:id/facturas-importadas | 3 | NB-PROV-001 | **done** |
| **NB-PRD-015** | Producto tramos, promos, PLU audit, clonar sucursal | 5 | NB-PRD-010 | **done** |
| **NB-IMP-014** | Import preflight | 2 | NB-IMP-002 | **done** |
| **NB-PF-001** | Pago proveedor por factura importada | 3 | NB-CC-002 | **done** |
| **NB-ORD-001** | Lookup orden externa | 2 | — | **done** |
| **NB-CRON-001** | Cron HTTP reintentar-arca (+ doc scheduler) | 2 | NB-ARC-104 | **done** |

**Fase 7b completa.** Resto de gaps = Fase 8 (verticales).

---

## Fase 8 — Verticales y plataforma (opcional / tardío)

| ID | Título | Est | Notas |
|----|--------|-----|-------|
| **NB-TUR-001** | Turnos agendas/reservas | 13 | 12 rutas | **done** |
| **NB-WA-001** | WhatsApp jobs/webhook/sandbox | 13 | 15 rutas + 5 cron | **Phase C MVP done** (sandbox chat/facturas/tickets, read-only agent subset, report/download HMAC→S3; Phase D: agente completo + PDF + conversation_state) |
| **NB-LEC-001** | Lector facturas async + borradores | 8 | IA + storage | **done** (extraer/confirmar/cron/tabla-ocr; confirmar paridad completa; API pública jobs con API key) |
| **NB-DES-001** | Despiece carnicería | 8 | Vertical | **done** — 8 rutas `/api/v1/despiece/*`, motor + plantillas + ingresos |
| **NB-NEX-001** | Nexus dashboard (multi-tenant operador) | 5 | **done** — 4 rutas `/api/v1/nexus-dashboard/*` (cookie HMAC, sin JWT tenant) |
| **NB-PUB-001** | API pública invoice-extractor | 5 | **done** — `POST /public/invoice-extractor/extract` (API key `api_extractor_key`) |

---

## Fase 9 — Auth usuarios (decisión)

| Opción | Tickets |
|--------|---------|
| **A (recomendada corto plazo)** | Seguir usando **Supabase Auth** solo para emitir JWT; Nest valida. Tabla `usuario` en Postgres Nest sincronizada con perfil. **NB-SCH-002** + hook/sync. |
| **B (largo plazo)** | **NB-AUTH-010** login/register/refresh en Nest + tabla credentials. **done** |

Para Postman hoy: **opción A** (token de Supabase).

---

## Orden de ejecución recomendado

```text
Fase 0   NB-TOOL-001, NB-TOOL-002, cerrar NB-QA-001 / NB-ARC-106
Fase 1   NB-SCH-001 → NB-SCH-003 → NB-CAT/PROV/CLI → NB-CFG-001
Fase 2   NB-SUC-001 → NB-SUC-002 → NB-PRD-010+ (según uso clientes)
Fase 3   NB-IMP-010, NB-IMP-011
Fase 4   NB-FAC-010 → NB-PAY-* → NB-FAC-004 → NB-CAJA-001 → NB-POS-001
Fase 5   NB-CC-*, NB-PED-010
Fase 6–8 según prioridad comercial
```

---

## Métricas de avance (2026-06-05)

| Métrica | Valor | % |
|---------|-------|---|
| Backlog Fases 0–7 | 69 / 70 tickets | **~99%** |
| Fase 7b gaps cutover | 0 / 15 tickets | **0%** (doc en `backend-frontend-gaps.md`) |
| Rutas front / handlers Nest | 254 / ~235 | **~72–78%** |
| Rutas front con paridad funcional | ~175 / 254 | **~69%** |
| Módulos core POS/ERP | — | **~96%** |
| Migraciones Nest / Supabase | 43 / 206 | ~19% (por bloques, no 1:1) |
| Postman requests | ~214 | — |

Detalle por dominio: `backend-parity-matrix.md` · Brechas ruta a ruta: `backend-frontend-gaps.md` · Contexto activo: `activeContext.md`.

---

## Relación con otros docs

| Doc | Uso |
|-----|-----|
| `backend-frontend-gaps.md` | **Brechas ruta a ruta** front vs Nest + tickets Fase 7b |
| `backend-parity-matrix.md` | Estado actual y tabla dominios |
| `backend-nest-tickets.md` | Tickets A–K históricos (hechos + I–K pendientes) |
| `frontend-nest-migration-tickets.md` | **Diferido** — cutover UI cuando Fase 1–4 estén probadas |
| `base-de-datos.md` | Modelo conceptual Supabase |
| `backend-nest-api-contracts.md` | Convenciones `/api/v1` |
