# SmartStock — Matriz de paridad Backend Nest vs Frontend (producto actual)

**Objetivo:** construir el backend completo en **PostgreSQL + Nest**, validado con **Postman / Thunder Client / Swagger** (`/api/docs`). **Sin integrar el frontend Next** hasta tener paridad por módulo.

**Fecha análisis:** 2026-06-05 (post NB-TEN-001/002, NB-PAS-001)

**Detalle ruta a ruta:** `backend-frontend-gaps.md` ← inventario para cutover front

---

## Resumen ejecutivo

| Métrica | Frontend (producto) | Backend Nest (hoy) | Avance |
|---------|---------------------|-------------------|--------|
| Rutas API | **254** `app/api/**/route.ts` | **~235** handlers HTTP (~214 requests Postman) | **~72–78%** superficie HTTP |
| Paridad funcional core | **~175** rutas ✅ | **~25** 🟡 parcial, **~30** ❌ core | ver `backend-frontend-gaps.md` |
| Backlog crítico (Fases 0–7) | **69 / 70** tickets | **~99%** |
| Módulos core POS/ERP | — | stock, facturación, CC, reportes, analizador, tesorería, pagos | **~96%** |
| Migraciones SQL | **206** en `apps/frontend/supabase/migrations` | **43** en `apps/backend/src/database/migrations` | **~19%** (por bloques de dominio, no copia 1:1) |
| Tests unitarios | — | **102** archivos `*.spec.ts` | suite amplia |
| Auth | Supabase Auth + JWT hook | Valida **mismo JWT** (HS256); opción A en Fase 9 | Postman OK |
| Cutover UI | — | diferido (`frontend-nest-migration-tickets.md`) | pendiente pasarelas + ARCA homo |

El Nest es **multi-tenant** (`tenant_id` en contexto). **Fases 0–7 casi cerradas** (solo NB-ARC-106). Para **cutover UI** faltan ~30 rutas core documentadas en `backend-frontend-gaps.md` (Fase 7b) + verticales Fase 8.

---

## Porcentajes de avance (cómo leerlos)

| Enfoque | % | Notas |
|---------|---|-------|
| Backlog producto crítico (Fases 0–7) | **~99%** | Solo NB-ARC-106 |
| Cutover front sin BFF (Fase 7b) | **~88%** | ~30 rutas core — ver gaps doc |
| Uso real POS/ERP vs front | **~96%** | Config cajas/roles, pasarela unificada, caja gastos |
| Incluyendo Fase 8 (verticales) | **~78–82%** | +50 rutas WhatsApp, turnos, despiece, lector, nexus, public |
| Conteo literal rutas HTTP | **~72–78%** | Nest consolida endpoints; no es 1:1 con `route.ts` |

---

## Dónde quedó el backend Nest (implementado)

### Infra y seguridad ✅
- Bootstrap, config, logging, error filter, Swagger, rate limit, CORS
- JWT guard, `tenant_id` en contexto, roles `admin` / `operador` / `visor`
- Health: `GET /api/v1/health`
- Auth smoke: `GET /api/v1/auth/me`, `tenant`, `admin-only`
- CI: `.github/workflows/backend-ci.yml` (`NB-QA-001`)
- Postman + runbook: `apps/backend/docs/postman/` (`NB-TOOL-001`, `NB-TOOL-002`)

### Dominio core ✅

| Módulo | Estado | Notas |
|--------|--------|-------|
| **Catálogo** | ✅ | categorías, proveedores, clientes CRUD + merge proveedor |
| **Config** | ✅ | tenant, módulos, usuarios, business-prefs, logo, super-admin TEN |
| **Productos** | ✅ | CRUD, listado extendido, variantes, lotes, barcode, imagen S3, bulk, merge, export balanza |
| **Sucursales** | ✅ | sucursal activa, stock/precio/PLU por sucursal, transferencias |
| **Promociones** | ✅ | CRUD + mapa vigente |
| **Inventario** | ✅ | movimientos, alertas stock bajo y vencimientos |
| **Importaciones** | ✅ | preview/ejecutar, drafts, logs/revert, obligaciones, linkable-products, convert-pdf |
| **IA precios** | ✅ | limits, extract, preview + `GET pricing/historial` |
| **Facturación** | ✅ | emitir, listado/detalle, PDF, anular, bandeja ARCA, retry CAE, compra proveedor manual, pago mixto |
| **Medios de pago** | ✅ | CRUD + atajos rápidos |
| **Presupuestos** | ✅ | CRUD + conversiones pedido/factura |
| **Cobranza** | ✅ | pendientes, pagos, campaña, recibo |
| **Caja / POS** | ✅ | turnos abrir/cerrar, historial, catálogo POS, borrador |
| **Pedidos** | ✅ | CRUD, facturar, workflow estados/transiciones |
| **Cuenta corriente** | ✅ | cliente y proveedor (movimientos, extracto, liquidar, pagos múltiples) |
| **Reportes** | ✅ | ventas, resumen, libro IVA, stock, reposición, ganancias, recibos |
| **Dashboard** | ✅ | métricas |
| **Analizador** | ✅ | rentabilidad, listas precios, matching IA, comparar/simular/clonar |
| **Tesorería** | ✅ | movimientos, cheques, obligaciones, cierres |
| **ARCA** | 🟡 | config, WSAA, WSFE, worker `arca_job`, PDF fiscal — homologación e2e pendiente (`NB-ARC-106`) |
| **MP Point** | ✅ | config, pagos, webhook, sincronizar (`NB-MPP-001` … `006`) |
| **MP QR / Transferencia / Pasarelas** | ✅ | Cobros legacy + flujo `pagos/pasarela/*` unificado (NB-PAS-002, NB-MPT-002) |

### Pendiente (backlog activo)

| ID | Fase | Prioridad |
|----|------|-----------|
| **NB-ARC-106** | 0 | Homologación ARCA — **toolkit listo**; pendiente ejecución manual AFIP + evidencia |
| **NB-CFG-003 … NB-CRON-001** | 7b | Gaps cutover — ver `backend-frontend-gaps.md` |
| **NB-TUR-001** … **NB-PUB-001** | 8 | Verticales opcionales |
| **NB-OBS-001**, **NB-REL-001** | H | Observabilidad y deploy |

### Seed y prueba manual
- `npm run seed:demo` → tenant `00000000-0000-4000-8000-000000000001`, sucursal `d0000001-0001-4001-8001-000000000001`
- Probar con Bearer token (login Supabase → copiar `access_token` a Postman)
- Guía: `apps/backend/docs/probar-api-sin-frontend.md`

---

## Inventario del frontend por dominio (254 rutas)

Conteo por carpeta raíz de `app/api` (2026-06-05):

| Dominio | Rutas | Nest | Prioridad |
|---------|-------|------|-----------|
| configuracion | 28 | ✅ 28/28 | — |
| pagos | 24 | ✅ 24/24 | — |
| productos | 19 | ✅ 19/19 | — |
| whatsapp | 15 | ❌ | Baja (Fase 8) |
| importar | 14 | ✅ 14/14 | — |
| reportes | 12 | ✅ 12/12 | — |
| turnos | 12 | ❌ | Media (Fase 8) |
| facturacion | 10 | ✅ 10/10 | — |
| caja | 10 | ✅ 10/10 | — |
| clientes | 9 | ✅ 9/9 | — |
| proveedores | 9 | ✅ 9/9 | — |
| tesoreria | 8 | ✅ | — |
| despiece | 8 | ❌ | Baja (vertical) |
| cron | 8 | 🟡 3/8 | reintentar-arca + arca-procesar OK; resto Fase 8 |
| lector-facturas | 7 | ❌ | Media (Fase 8) |
| pedidos | 7 | ✅ | — |
| pasarelas | 5 | ✅ | config integraciones OK |
| presupuestos | 5 | ✅ | — |
| pos | 5 | ✅ | — |
| auth | 4 | 🔐 | Supabase; Nest solo me/tenant |
| cobranza | 4 | ✅ | — |
| nexus-dashboard | 4 | ❌ | Interno (Fase 8) |
| public | 4 | ❌ | API pública (Fase 8) |
| analizador | 3+ | ✅ | Nest tiene más superficie que el conteo raíz |
| ia | 3 | ✅ | — |
| promociones | 3 | ✅ | — |
| stock | 2 | ✅ | transferencias sucursal |
| admin | 2 | ✅ | NB-TEN-001/002 |
| alertas | 2 | ✅ | vía inventory (path distinto) |
| categorias | 2 | ✅ | módulo catalog |
| movimientos | 1 | ✅ | inventory |
| precios | 1 | ✅ | pricing/historial |
| dashboard | 1 | ✅ | — |
| cuenta-corriente | 1 | ✅ 1/1 | cargos-hoy (NB-CC-003) |
| ordenes | 1 | ✅ | — |
| pago-proveedor-factura | 1 | ✅ | — |

---

## Brecha de esquema PostgreSQL

**Supabase (front):** ~206 migraciones — incluye tablas incrementales, RLS, funciones RPC.

**Nest (hoy):** **49** migraciones — baseline core + sucursales, variantes, promociones, facturación extendida, import drafts, analizador, tesorería, medios de pago, caja/POS, MP Point/QR/transfer, pasarelas, super-admin, caja gastos, CC RPCs, ganancia tramos, clonar productos, etc.

**Estrategia:** portar por **bloques de dominio** desde `apps/frontend/supabase/migrations`, adaptando RLS → guards Nest + `tenant_id` en queries. No copiar las 206 migraciones literalmente.

---

## Cómo testear sin frontend

1. Levantar Postgres + `npm run migration:run` + `npm run seed:demo` en `apps/backend`.
2. Obtener JWT: login en Supabase con `tenant_id` y `rol` en claims.
3. **Swagger:** `http://localhost:4000/api/docs`
4. **Postman:** `apps/backend/docs/postman/smartstock-nest-api.postman_collection.json`

Endpoints de humo sugeridos:
- `GET /api/v1/health`
- `GET /api/v1/auth/me`
- `GET /api/v1/products?pageSize=5`
- `POST /api/v1/inventory/movimientos`
- `POST /api/v1/facturacion/comprobantes`
- `POST /api/v1/pagos/mp-point/webhook` (con firma MP en homo)

---

## Referencias

- **Brechas ruta a ruta (cutover):** `backend-frontend-gaps.md`
- Backlog detallado: `backend-full-build-tickets.md`
- Tickets Nest originales (A–K): `backend-nest-tickets.md`
- Cutover frontend (diferido): `frontend-nest-migration-tickets.md`
- Contexto activo: `activeContext.md`
