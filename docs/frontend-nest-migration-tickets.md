# SmartStock — Tickets migración Frontend → API Nest

> **Estado:** **DIFERIDO.** Prioridad actual: construir y probar el backend completo en PostgreSQL (`backend-full-build-tickets.md`) con Postman/Thunder. Este backlog aplica cuando un módulo Nest tenga paridad probada.

## Contexto (estado abril 2026)

| Capa | Estado |
|------|--------|
| **Frontend Next** (`apps/frontend`) | Monolito completo: ~279 rutas `app/api/*`, datos en **Supabase Postgres** + Auth. Sin cliente Nest integrado en el clone actual. |
| **Backend Nest** (`apps/backend`) | Bloques **A–G** del backlog Nest implementados (productos, inventario, barcodes, importaciones, pricing, facturación, pedidos, ARCA, worker). Base **Postgres propia** (migraciones `NB-*`), no es la misma instancia que Supabase del front. |
| **Auth** | Supabase emite JWT; Nest valida el mismo secret (`JWT_SECRET` / `SUPABASE_JWT_SECRET`) y exige `tenant_id` + rol en claims. |
| **Hueco principal** | El front **no llama** al Nest; conviven **dos bases** hasta definir cutover de datos y módulos. |

**Referencias:** `backend-nest-tickets.md`, `backend-nest-api-contracts.md`, `backend-nest-implementation-roadmap.md` (etapas A–C).

**Convención ID:** `NF-<BLOQUE>-<NNN>` (Nest Frontend / cutover).

---

## BLOQUE 0 — Puente y observabilidad (primero)

### NF-ARC-001 — Variables de entorno y contrato JWT
- Prioridad: critical | Estimación: 2 | Estado: todo
- Dependencias: ninguna
- Criterios:
  - [ ] `NEXT_PUBLIC_NEST_API_URL` documentada en `.env.local.example`.
  - [ ] Checklist: `JWT_SECRET` Nest = JWT secret del proyecto Supabase.
  - [ ] `tenant_id` y `rol` en JWT (hook o metadata) alineados con `normalize-access-token-payload` del Nest.
  - [ ] Nota en docs: tenant en Supabase y fila `tenant` en Postgres Nest deben compartir **el mismo UUID** por negocio.

### NF-ARC-002 — Cliente HTTP Nest (server + browser)
- Prioridad: critical | Estimación: 3 | Estado: todo
- Dependencias: NF-ARC-001
- Criterios:
  - [ ] `lib/nest-api/client.ts`: base URL, `Authorization: Bearer`, timeout, parseo de errores Nest.
  - [ ] Variante server-only con `getSession()` / `getCachedServerAuth`.
  - [ ] Tipos mínimos `{ data, meta }` según contratos.

### NF-ARC-003 — Smoke test en dashboard
- Prioridad: high | Estimación: 2 | Estado: todo
- Dependencias: NF-ARC-002
- Criterios:
  - [ ] Tarjeta health Nest (`GET /api/v1/health`).
  - [ ] Tarjeta peek productos autenticada (`GET /api/v1/products?pageSize=5`).
  - [ ] Mensajes claros 401/403/0 (secret, rol, red).

### NF-ARC-004 — Feature flag por módulo (`api_source`)
- Prioridad: high | Estimación: 3 | Estado: todo
- Dependencias: NF-ARC-002
- Criterios:
  - [ ] Env o config: `NEST_API_MODULES=products,inventory` (lista permitida).
  - [ ] Helper `shouldUseNest('products')` para bifurcar sin big-bang.
  - [ ] Rollback = quitar módulo de la lista (vuelve a `/api/*` Next).

---

## BLOQUE 1 — Datos: una verdad por tenant (bloqueante para producción)

### NF-DATA-001 — ADR: estrategia de base única vs dual
- Prioridad: critical | Estimación: 3 | Estado: todo
- Dependencias: ninguna
- Criterios:
  - [ ] Documentar opciones: (A) Nest apunta al mismo Postgres que Supabase, (B) réplica/sync, (C) migración one-shot por tenant.
  - [ ] Decisión con pros/contras para ~50 tenants mes 1.
  - [ ] Impacto en RLS Supabase vs rol superuser Nest.

### NF-DATA-002 — Provisioning tenant en Postgres Nest al registrar negocio
- Prioridad: critical | Estimación: 5 | Estado: todo
- Dependencias: NF-DATA-001, NB-SEC-002
- Criterios:
  - [ ] Al `POST /api/auth/register` (o job async): crear fila `tenant` en Nest con **mismo UUID** que Supabase.
  - [ ] Idempotente si el tenant ya existe.
  - [ ] Log/alerta si falla sync (no bloquear registro Supabase sin política explícita).

### NF-DATA-003 — Script seed/sync piloto un tenant
- Prioridad: high | Estimación: 5 | Estado: todo
- Dependencias: NF-DATA-002
- Criterios:
  - [ ] Script que copia productos/movimientos de un `tenant_id` Supabase → Nest (o valida paridad).
  - [ ] Usable en dev con `npm run seed:demo` + tenant real.
  - [ ] README de operación.

### NF-DATA-004 — Tabla de seguimiento de cutover por tenant
- Prioridad: medium | Estimación: 2 | Estado: todo
- Dependencias: NF-DATA-001
- Criterios:
  - [ ] Campo en `tenant` o tabla `tenant_api_routing`: módulos en Nest vs Next.
  - [ ] Visible para super-admin (opcional v1: solo env global).

---

## BLOQUE 2 — Productos y stock (primer cutover de negocio)

### NF-PRD-001 — Listado y búsqueda de productos vía Nest
- Prioridad: critical | Estimación: 5 | Estado: todo
- Dependencias: NF-ARC-004, NF-DATA-002
- Criterios:
  - [ ] Pantallas que hoy usan `GET /api/productos` (listado principal) leen Nest cuando flag activo.
  - [ ] Paridad: `q`, paginación, `barcode` query.
  - [ ] Tests de regresión o checklist manual documentado.

### NF-PRD-002 — Alta/edición/detalle producto vía Nest
- Prioridad: critical | Estimación: 5 | Estado: todo
- Dependencias: NF-PRD-001
- Criterios:
  - [ ] `POST/PATCH/GET /api/v1/products/:id` reemplazan rutas Next equivalentes en flujo estándar (sin variantes/sucursales).
  - [ ] Manejo de errores de validación Nest en formularios.

### NF-PRD-003 — Barcodes y búsqueda POS
- Prioridad: high | Estimación: 5 | Estado: todo
- Dependencias: NF-PRD-002, NB-BAR-005
- Criterios:
  - [ ] `buscar-por-barcode` y POS escáner usan Nest (`?barcode=` o endpoints barcode).
  - [ ] Rutas Next de barcode quedan detrás del flag o deprecadas.

### NF-PRD-004 — Gap analysis: features solo en Next
- Prioridad: medium | Estimación: 2 | Estado: todo
- Dependencias: NF-PRD-001
- Criterios:
  - [ ] Inventario documentado de rutas **sin** equivalente Nest: `variantes`, `stock-sucursal`, `bulk-ganancia`, `fusionar`, `clonar-sucursal`, etc.
  - [ ] Tickets backend derivados (`NB-CAT-*`, `NB-SUC-*`) o decisión “permanecen en Next/Supabase”.

### NF-INV-001 — Movimientos de stock vía Nest
- Prioridad: critical | Estimación: 5 | Estado: todo
- Dependencias: NF-PRD-002, NB-INV-001
- Criterios:
  - [ ] `POST /api/movimientos` → `POST /api/v1/inventory/movements` con flag.
  - [ ] Historial listado Nest donde aplique.

### NF-INV-002 — Alertas dashboard (stock bajo / vencimientos)
- Prioridad: high | Estimación: 3 | Estado: todo
- Dependencias: NF-INV-001, NB-INV-003
- Criterios:
  - [ ] `StockBajoCard` / `VencimientosCard` consumen endpoints Nest de alertas.
  - [ ] Fallback a Supabase si flag off.

---

## BLOQUE 3 — Importador y precios

### NF-IMP-001 — Preview importación vía Nest
- Prioridad: high | Estimación: 5 | Estado: todo
- Dependencias: NF-PRD-003, NB-IMP-001
- Criterios:
  - [ ] `client-import` preflight → `POST /api/v1/imports/preview`.
  - [ ] Misma UX de errores por fila.

### NF-IMP-002 — Ejecutar importación vía Nest
- Prioridad: critical | Estimación: 8 | Estado: todo
- Dependencias: NF-IMP-001, NB-IMP-002
- Criterios:
  - [ ] `POST /api/importar/ejecutar` → Nest execute con `Idempotency-Key`.
  - [ ] Borradores/chunks pueden quedar en Next hasta ticket NF-IMP-003.

### NF-IMP-003 — Borradores de importación (decisión)
- Prioridad: medium | Estimación: 3 | Estado: todo
- Dependencias: NF-IMP-001
- Criterios:
  - [ ] ADR: borradores siguen en Supabase storage/DB o se mueven a Nest.
  - [ ] Si quedan en Next: contrato claro (solo execute en Nest).

### NF-PRC-001 — Historial de precios vía Nest
- Prioridad: medium | Estimación: 3 | Estado: todo
- Dependencias: NF-IMP-002, NB-PRC-001
- Criterios:
  - [ ] Pantallas de historial/sugerencia usan `pricing` Nest.

---

## BLOQUE 4 — Facturación, POS y pedidos

### NF-FAC-001 — Emisión comprobante vía Nest
- Prioridad: critical | Estimación: 8 | Estado: todo
- Dependencias: NF-INV-001, NB-FAC-001
- Criterios:
  - [ ] `POST /api/facturacion/emitir` → Nest emit con flag.
  - [ ] Ticket/POS y facturación simple comparten cliente.

### NF-FAC-002 — Listado, detalle y PDF comprobante
- Prioridad: high | Estimación: 5 | Estado: todo
- Dependencias: NF-FAC-001, NB-FAC-003
- Criterios:
  - [ ] Lecturas y descarga PDF desde Nest.
  - [ ] Estados `borrador`, `emitido`, `pendiente_arca`, etc. visibles.

### NF-FAC-003 — Medios de pago / mixto (depende backend)
- Prioridad: critical | Estimación: 8 | Estado: todo
- Dependencias: NB-PAY-002, NB-FAC-004, NF-FAC-001
- Criterios:
  - [ ] POS cobro (efectivo, tarjeta, mixto) usa API Nest de medios de pago.
  - [ ] Hasta entonces: POS sigue en Next (documentado en NF-ARC-004).

### NF-PED-001 — Pedidos CRUD y conversión a factura
- Prioridad: high | Estimación: 5 | Estado: todo
- Dependencias: NF-FAC-001, NB-PED-001
- Criterios:
  - [ ] Rutas `/api/pedidos*` críticas detrás del flag Nest.

### NF-ARC-001 — Config ARCA y cola CAE vía Nest
- Prioridad: high | Estimación: 5 | Estado: todo
- Dependencias: NF-FAC-002, NB-ARC-104
- Criterios:
  - [ ] UI configuración ARCA escribe/lee Nest.
  - [ ] Desactivar cron Edge Supabase cuando worker Nest esté activo (checklist deploy).

---

## BLOQUE 5 — Auth, tenant y admin (paridad con front actual)

### NF-AUTH-001 — Mantener Supabase Auth; Nest solo valida JWT
- Prioridad: critical | Estimación: 1 | Estado: todo
- Dependencias: NF-ARC-001
- Criterios:
  - [ ] Documentado: no hay login en Nest; register/login siguen en Next + Supabase.
  - [ ] `apps/backend` sin duplicar flujo de registro salvo sync tenant (NF-DATA-002).

### NF-TEN-001 — Super-admin: tenant efectivo en llamadas Nest
- Prioridad: high | Estimación: 5 | Estado: todo
- Dependencias: NB-TEN-001, NB-TEN-002, NF-ARC-002
- Criterios:
  - [ ] `SuperAdminTenantSwitcher` propaga tenant efectivo (header/cookie) a Nest.
  - [ ] Cliente Nest usa tenant del contexto, no solo del JWT home.

### NF-TEN-002 — Perfil, módulos y onboarding siguen en Supabase
- Prioridad: medium | Estimación: 2 | Estado: todo
- Dependencias: NF-AUTH-001
- Criterios:
  - [ ] `modulo_config`, `usuario`, onboarding: scope explícito “permanece Supabase hasta NB-CFG-*”.
  - [ ] Lista de tickets backend si se migran más adelante.

---

## BLOQUE 6 — Limpieza Next API (post-cutover)

### NF-CUT-001 — Deprecar rutas Next productos (core)
- Prioridad: medium | Estimación: 3 | Estado: todo
- Dependencias: NF-PRD-003, NF-INV-001
- Criterios:
  - [ ] Rutas `app/api/productos/route.ts`, `[id]/route.ts`, `buscar-por-barcode` devuelven 410 o proxy a Nest con warning header.
  - [ ] Sin referencias en `src/` al path legacy.

### NF-CUT-002 — Deprecar movimientos/importar/facturacion/pedidos core
- Prioridad: medium | Estimación: 5 | Estado: todo
- Dependencias: NF-FAC-002, NF-PED-001, NF-IMP-002
- Criterios:
  - [ ] Misma política que NF-CUT-001 por módulo.
  - [ ] Changelog interno.

### NF-CUT-003 — Inventario de rutas que **permanecen** en Next
- Prioridad: high | Estimación: 3 | Estado: todo
- Dependencias: NF-PRD-004
- Criterios:
  - [ ] Matriz publicada: WhatsApp, tesorería, turnos, reportes, sucursales, lector-facturas, analizador, promociones, etc.
  - [ ] Cada fila: “Nest futuro” / “permanece BFF Next” / “solo Supabase”.

---

## BLOQUE 7 — Backend Nest pendiente (complemento a `backend-nest-tickets.md`)

Tickets **nuevos** en backend para cerrar brecha con el front clonado:

### NB-CAT-001 — Módulo categorías (CRUD tenant)
- Prioridad: high | Estimación: 3 | Estado: todo
- Dependencias: NB-PRD-001
- Criterios: tabla + endpoints; FK producto validada.

### NB-PROV-001 — Módulo proveedores (CRUD tenant)
- Prioridad: high | Estimación: 5 | Estado: todo
- Dependencias: NB-PRD-001
- Criterios: paridad mínima con `GET/POST /api/proveedores` del front.

### NB-CLI-001 — Módulo clientes (CRUD tenant)
- Prioridad: high | Estimación: 5 | Estado: todo
- Dependencias: NB-FAC-001
- Criterios: necesario para facturación con `cliente_id` real.

### NB-CFG-001 — Lectura `modulo_config` / tenant profile (opcional v2)
- Prioridad: low | Estimación: 5 | Estado: todo
- Dependencias: NB-SEC-002
- Criterios: solo si se saca feature flags de Supabase; si no, cancelar ticket.

---

## Orden de ejecución recomendado

```text
1. NF-ARC-001 → NF-ARC-002 → NF-ARC-003 → NF-ARC-004
2. NF-DATA-001 → NF-DATA-002 → NF-DATA-003
3. NF-PRD-001 → NF-PRD-002 → NF-PRD-003 → NF-INV-001
4. NF-IMP-001 → NF-IMP-002
5. NF-FAC-001 → NF-FAC-002 → NF-ARC-001
6. NB-ARC-106 + NB-QA-001 (cerrar calidad backend)
7. NB-TEN-001/002 + NF-TEN-001 (super-admin)
8. NB-PAY-* + NF-FAC-003 (POS medios de pago)
9. NF-CUT-* + NB-CAT/PROV/CLI según NF-PRD-004
```

---

## Métrica de avance

| Área | Nest backend | Front usa Nest | Rutas Next deprecadas |
|------|--------------|----------------|------------------------|
| Productos core | ✅ | ❌ | ❌ |
| Inventario | ✅ | ❌ | ❌ |
| Import execute | ✅ | ❌ | ❌ |
| Facturación core | ✅ | ❌ | ❌ |
| Pedidos | ✅ | ❌ | ❌ |
| ARCA worker | ✅ | ❌ | ❌ |
| Proveedores/clientes/cat. | ❌ | — | — |
| Sucursales/variantes/POS+ | — | Next only | — |
