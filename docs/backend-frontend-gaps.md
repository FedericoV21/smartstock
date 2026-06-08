# SmartStock — Brechas Backend Nest vs Frontend (cutover)

**Objetivo:** inventario **ruta a ruta** de lo que el frontend Next (`apps/frontend/src/app/api/**`) consume hoy y qué falta (o difiere) en Nest (`apps/backend`, prefijo `/api/v1`).

**Uso:** planificar tickets post–Fase 7, priorizar cutover por módulo (`frontend-nest-migration-tickets.md`) y evitar sorpresas al reemplazar BFF Next.

**Última revisión:** 2026-06-08 (post NB-TUR-001 — turnos 12 rutas)

---

## Resumen ejecutivo

| Categoría | Rutas front (~254) | Notas |
|-----------|-------------------|--------|
| ✅ **Paridad** | **~229** | Existe handler Nest equivalente (path puede diferir) |
| 🟡 **Parcial** | **~25** | Lógica incompleta, contrato distinto o consolidado en otro endpoint |
| ❌ **Falta (core cutover)** | **~0** | Bloquea migrar UI sin mantener BFF Next en ese dominio |
| ⏭️ **Diferido Fase 8** | **~15** | WhatsApp Phase B/sandbox, nexus, public *(despiece + lector done)* |
| 🔐 **Auth Supabase** | **0** | NB-AUTH-010: auth completa también en Nest |
| 🟡 **Cron / jobs** | **6 de 8** | Solo ARCA worker portado; resto pendiente o vía scheduler externo |

**Backlog tickets Fases 0–7:** 69/70 done — queda **NB-ARC-106** (homologación).  
**Este doc** lista trabajo **adicional** para paridad HTTP literal con el front (Fase 7b+).

---

## Leyenda

| Símbolo | Significado |
|---------|-------------|
| ✅ | Paridad funcional en Nest |
| 🟡 | Parcial — ver notas |
| ❌ | Sin implementar en Nest |
| ⏭️ | Vertical / opcional (Fase 8) |
| 🔐 | Permanece en Supabase Auth (opción A) |
| 🔀 | Nest consolida varias rutas front en un handler |

---

## Mapa de paths (convención cutover)

El front usa `/api/<dominio>/...`. Nest expone `/api/v1/<dominio>/...` con nombres en inglés en varios módulos:

| Front | Nest (ejemplo) |
|-------|----------------|
| `/api/categorias` | `/api/v1/categories` |
| `/api/clientes` | `/api/v1/customers` |
| `/api/proveedores` | `/api/v1/suppliers` |
| `/api/productos` | `/api/v1/products` |
| `/api/movimientos` | `/api/v1/inventory/movimientos` |
| `/api/alertas/*` | `/api/v1/inventory/alertas/*` |
| `/api/stock/transferencia-sucursal` | `/api/v1/inventory/branch-transfers` |
| `/api/importar/*` | `/api/v1/importaciones/*` |
| `/api/ia/*` | `/api/v1/ai/*` |
| `/api/precios/historial` | `/api/v1/pricing/historial` |
| `/api/reportes/*` | `/api/v1/reports/*` |
| `/api/dashboard/metricas` | `/api/v1/dashboard/metrics` |
| `/api/configuracion/tenant` | `/api/v1/config/tenant` |
| `/api/configuracion/sucursales` | `/api/v1/branches` |
| `/api/configuracion/sucursal-activa` | `/api/v1/branches/active` |
| `/api/configuracion/medios-de-pago` | `/api/v1/config/payment-methods` |
| `/api/configuracion/mp-point` | `/api/v1/config/mp-point` |
| `/api/configuracion/mp-qr` | `/api/v1/config/mp-qr` |
| `/api/promociones` | `/api/v1/promotions` |

Al cutover, el cliente Nest o un proxy BFF debe traducir paths si se quiere compatibilidad 1:1.

---

## Por dominio

### ✅ Cubierto (core POS/ERP)

Dominios con paridad alta; detalle menor en sección [Parcial](#parcial-y-faltante-core).

| Dominio | Rutas | Nest |
|---------|-------|------|
| `categorias` | 2 | catalog |
| `clientes` (+ CC mayoría) | 9 | catalog + `customers/:id/cuenta-corriente` |
| `proveedores` (+ CC mayoría) | 9 | catalog + merge + CC proveedor |
| `productos` (CRUD, variantes, lotes, bulk, merge, export) | 19 | products + branches nested |
| `promociones` | 3 | promotions |
| `stock` | 2 | inventory/branch-transfers |
| `movimientos` | 1 | inventory/movimientos |
| `alertas` | 2 | inventory/alertas (path distinto) |
| `importar` (preview, ejecutar, drafts, logs, revert, obligación, linkable, convert-pdf) | 12/14 | importaciones/* |
| `ia` | 3 | ai/* |
| `precios` | 1 | pricing/historial |
| `facturacion` (emitir, list, PDF, anular, bandeja, retry, compra manual) | 9/10 | facturacion/* |
| `pedidos` + workflow | 7 | pedidos/* |
| `presupuestos` | 5 | presupuestos/* (solo lectura + conversiones; front igual) |
| `cobranza` | 4 | cobranza/* |
| `pos` | 5 | pos/* |
| `caja` (turnos, cierre-z list, disponibles) | 6/10 | caja/* |
| `tesoreria` | 8 | tesoreria/* |
| `reportes` (KPIs principales) | 9/12 | reports/* |
| `dashboard` | 1 | dashboard/metrics |
| `analizador` | 3+ | analyzer/* (+ price-lists ampliado) |
| `pagos/mp-point` | 7 | pagos/mp-point/* |
| `pagos/mp-qr` | 6 | pagos/mp-qr/* |
| `pagos/mp-transferencia` (core) | 4/6 | pagos/mp-transferencia (iniciar/verificar/confirmar/cancelar) |
| `pasarelas` | 5 | pasarelas/* + config caja pasarelas |
| `admin` | 2 | admin/* (NB-TEN) |
| `auth/me` equivalente | — | GET auth/me |

---

### 🟡 Parcial y ❌ faltante (core cutover)

#### `configuracion` (28 rutas) — 🟡 ~16 OK, ❌ ~12 faltan

| Ruta front | Estado | Nest / notas | Ticket propuesto |
|------------|--------|--------------|------------------|
| `tenant`, `business-prefs`, `logo` | ✅ | `config/tenant`, `business-prefs`, `logo` | — |
| `usuarios`, `usuarios/[id]` | ✅ | `config/users` | — |
| `medios-de-pago`, `[id]`, `rapidos` | ✅ | `config/payment-methods` | — |
| `mp-point`, `mp-qr` | ✅ | `config/mp-point`, `config/mp-qr` | — |
| `sucursales`, `[id]`, `sucursal-activa` | ✅ | `branches`, `branches/active` | — |
| `cajas/[id]/pasarelas` | ✅ | `configuracion/cajas/:id/pasarelas` | — |
| `plan` | ✅ | `GET/POST config/plan` — **NB-CFG-003** |
| `cajas`, `cajas/[id]`, `forzar-cierre` | ✅ | `config/cajas/*` — **NB-CFG-003** |
| `pos-prefs`, `pos-prefs/balanza-sucursales` | ✅ | `config/pos-prefs/*` — **NB-CFG-003** |
| `ia-ilimitada` | ✅ | `GET/POST config/ia-ilimitada` — **NB-CFG-003** |
| `roles`, `roles/[id]` | ✅ | Roles custom por tenant — **NB-CFG-004** |
| `usuarios/[id]/sucursales` | ✅ | Asignación sucursales explícita — **NB-CFG-004** |
| `usuarios/[id]/pin` | ✅ | PIN POS local — **NB-CFG-004** |
| `usuarios/[id]/permisos-extra` | ✅ | Permisos granulares — **NB-CFG-004** |
| `usuarios/[id]/pedidos-workflow-estados` | ✅ | Restricción estados workflow por usuario — **NB-CFG-004** |
| `usuarios/local` | ✅ | Usuarios solo sucursal (modo local) — **NB-CFG-004** |

#### `pagos` (24 rutas) — ✅ 24 OK

| Ruta front | Estado | Notas | Ticket |
|------------|--------|-------|--------|
| `mp-point/*`, `mp-qr/*` (cobro) | ✅ | Paridad | — |
| `mp-transferencia/iniciar\|verificar\|confirmar\|cancelar` | ✅ | NB-MPT-001 | — |
| `pasarela/iniciar\|estado\|cancelar\|sincronizar` | ✅ | Flujo unificado `pagos/pasarela/*` — **NB-PAS-002** |
| `webhook/[proveedor]/[webhook_public_id]` | ✅ | Webhook genérico multi-pasarela — **NB-PAS-002** |
| `mp-transferencia/diagnostico` | ✅ | Debug conexión MP Reports API — **NB-MPT-002** |
| `mp-transferencia/configurar-reportes` | ✅ | Alta webhook/reportes MP transferencias — **NB-MPT-002** |

#### `caja` (10 rutas) — ✅ 10 OK

| Ruta front | Estado | Nest | Ticket |
|------------|--------|------|--------|
| `disponibles`, `turno/*`, `cierre-z` (list) | ✅ | caja/* | — |
| `turnos/historial` | ✅ | `caja/turnos/historial` (front: `historial-movimientos` distinto) | — |
| `apertura` | 🟡 | Alias de `turno/abrir` — solo naming | NF path map |
| `gastos`, `gastos/[id]` | ✅ | Gastos de sesión de caja (CRUD) — **NB-CAJA-002** |
| `historial-movimientos` | ✅ | Movimientos de caja por turno — **NB-CAJA-002** |
| `cierre-z/[id]/resumen` | ✅ | Detalle PDF/resumen cierre Z — **NB-CAJA-002** |

#### `clientes` — ✅ 9/9

| Ruta front | Estado | Ticket |
|------------|--------|--------|
| `.../cuenta-corriente/extracto`, `liquidar-items`, `movimientos-dia`, `pagos` POST | ✅ | — |
| `.../comprobantes` | ✅ | `GET customers/:id/comprobantes` — **NB-CLI-002** |
| `.../cuenta-corriente/comprobantes/[id]/liquidacion` | ✅ | **NB-CC-003** |
| `.../cuenta-corriente/pagos/[pagoId]` PATCH | ✅ | **NB-CC-003** |

#### `proveedores` — ✅ 9/9

| Ruta front | Estado | Ticket |
|------------|--------|--------|
| CC extracto, pago-cuenta, pago-multiple, fusionar | ✅ | — |
| `.../facturas-importadas` | ✅ | `GET suppliers/:id/facturas-importadas` — **NB-PROV-011** |
| `.../pagos/[pagoId]/revertir` | ✅ | `POST suppliers/:id/pagos/:pagoId/revertir` — **NB-CC-003** |

#### `productos` — ✅ 19/19

| Ruta front | Estado | Nest / ticket |
|------------|--------|---------------|
| CRUD, variantes, lotes, imagen, bulk, merge, export balanza, stock/precio/plu sucursal | ✅ | — |
| `ganancia-tramos` | ✅ | `GET/PUT products/:id/margin-tiers` — **NB-PRD-015** |
| `[id]/promociones` | ✅ | `GET products/:id/promotions` — **NB-PRD-015** |
| `plu-fuera-de-rango` | ✅ | `GET products/plu-out-of-range` — **NB-PRD-015** |
| `clonar-sucursal` | ✅ | `POST products/clone-branch` — **NB-PRD-015** |
| `materializar-stock-sucursales` | ✅ | `inventory/branch-stock/materialize` | — |

#### `importar` — ✅ 14/14

| Ruta front | Estado | Ticket |
|------------|--------|--------|
| preview, ejecutar, drafts, logs, revert, obligación, linkable, convert-pdf | ✅ | paths `importaciones/*` |
| `preflight` | ✅ | `POST importaciones/preflight` — **NB-IMP-014** |
| `archivo` | 🟡 | Cubierto por `drafts/:id/file` — documentar equivalencia | — |

#### `facturacion` — ✅ 10/10

| Ruta front | Estado | Ticket |
|------------|--------|--------|
| emitir → `POST comprobantes` | 🔀 | Consolidado | — |
| `GET facturacion` → `GET comprobantes` | 🔀 | — |
| `[id]/arca-encolar` | ✅ | `POST facturacion/comprobantes/:id/arca-encolar` — **NB-FAC-016** |

#### `reportes` — ✅ 12 OK

| Ruta front | Nest | Estado |
|------------|------|--------|
| resumen, libro-iva, resumen-venta-periodo, ventas-articulo, ventas-consumidor, reposicion, ganancias, proveedores-gasto, clientes-deuda | reports/* | ✅ |
| `recibos` | `GET reports/recibos` | ✅ **NB-RPT-003** |
| `extracto-cuenta-corriente` | `GET reports/extracto-cuenta-corriente` | ✅ **NB-RPT-003** |
| `extracto-cuenta-corriente-proveedor` | `GET reports/extracto-cuenta-corriente-proveedor` | ✅ **NB-RPT-003** |

#### Otros core sueltos

| Ruta front | Estado | Ticket |
|------------|--------|--------|
| `cuenta-corriente/cargos-hoy` | ✅ | `GET cuenta-corriente/cargos-hoy` — **NB-CC-003** |
| `pago-proveedor-factura/[id]/pago` | ✅ | `POST pago-proveedor-factura/:id/pago` — **NB-PF-001** |
| `ordenes/[numero_orden]` | ✅ | `GET ordenes/:numero_orden` — **NB-ORD-001** |
| `cron/arca-procesar` | ✅ | `POST cron/arca-procesar` (Bearer CRON_SECRET) |
| `cron/reintentar-arca` | ✅ | `GET cron/reintentar-arca` — **NB-CRON-001** |

---

### ⏭️ Diferido — Fase 8 (no bloquea POS estándar)

| Dominio | Rutas | Ticket backlog |
|---------|-------|----------------|
| `turnos/*` | 12 | **NB-TUR-001** ✅ |
| `whatsapp/*` (admin, webhook, actors, jobs reprocess) | 12/15 | **NB-WA-001 Phase B MVP** ✅ |
| `cron/whatsapp/*` | 5/5 | **NB-WA-001 Phase B MVP** ✅ (outbound + process-queued workers) |
| `whatsapp/sandbox/*`, `whatsapp/report/download` | 7/7 | **NB-WA-001 Phase C MVP** ✅ |
| `whatsapp/*` (agente LLM completo, action-handler, conversation_state, report-pdf) | — | NB-WA-001 Phase D (diferido) |
| `despiece/*` | 8/8 | **NB-DES-001** ✅ |
| `lector-facturas/limite`, `logs`, `borradores/*`, `extraer`, `confirmar`, `tabla-ocr` | 8/8 | **NB-LEC-001 Phase C** ✅ |
| `cron/lector-facturas/process-jobs` | 1/1 | **NB-LEC-001** ✅ |
| `public/lector-facturas/jobs` (create, status, confirmar) | 3/3 | **NB-LEC-001 Phase C** ✅ (parcial NB-PUB) |
| `nexus-dashboard/*` | 4/4 | **NB-NEX-001** ✅ |
| `public/invoice-extractor/extract` | 1/1 | **NB-PUB-001** ✅ |

---

### 🔐 Auth — permanece Supabase (Fase 9 opción A)

| Ruta front | Acción cutover |
|------------|----------------|
| `auth/register` | Supabase Auth + NF-DATA-002 sync tenant |
| `auth/callback` | OAuth Supabase |
| `auth/local-login` | Supabase |
| `auth/resend-signup-code` | Supabase |

Nest: `GET auth/me`, `GET auth/tenant`, admin super-admin. **Opción B implementada:** register/login/local/invite/refresh en Nest (**NB-AUTH-010** done).

---

## Tickets propuestos (Fase 7b — gaps cutover)

Prioridad sugerida para poder migrar UI **sin** mantener BFF Next en configuración, caja y pagos unificados:

| ID | Título | Est | Rutas / impacto |
|----|--------|-----|-----------------|
| **NB-CFG-003** | Config: cajas CRUD, plan, pos-prefs, ia-ilimitada, forzar-cierre | 8 | 7 rutas configuracion |
| **NB-CFG-004** | Config: roles custom, pin, permisos, sucursales usuario, local | 8 | 6 rutas configuracion | **done** |
| **NB-PAS-002** | Pasarela unificada cobros + webhook genérico | 8 | 5 rutas pagos | **done** |
| **NB-MPT-002** | MP Transferencia diagnóstico + configurar-reportes | 3 | 2 rutas pagos | **done** |
| **NB-CAJA-002** | Gastos sesión, historial movimientos, resumen cierre Z | 5 | 4 rutas caja | **done** |
| **NB-FAC-016** | POST comprobante arca-encolar | 2 | 1 ruta facturacion | **done** |
| **NB-RPT-003** | Reportes recibos + extractos CC agregados | 5 | 3 rutas reportes | **done** |
| **NB-CC-003** | CC: liquidación por comprobante, revertir pago, cargos-hoy | 5 | 4 rutas CC | **done** |
| **NB-CLI-002** | Cliente comprobantes list | 2 | 1 ruta | **done** |
| **NB-PROV-011** | Proveedor facturas importadas | 3 | 1 ruta | **done** |
| **NB-PRD-015** | Producto: tramos, promos, PLU audit, clonar sucursal | 5 | 4 rutas productos | **done** |
| **NB-IMP-014** | Import preflight | 2 | 1 ruta | **done** |
| **NB-PF-001** | Pago proveedor por factura importada | 3 | 1 ruta | **done** |
| **NB-ORD-001** | Lookup orden externa | 2 | 1 ruta | **done** |
| **NB-CRON-001** | Endpoints cron reintentar-arca (+ doc scheduler) | 2 | 1 ruta | **done** |

**Total estimado Fase 7b:** ~15 tickets, ~53 story points.

---

## ARCA y producción (fuera de paridad HTTP)

| Item | Estado |
|------|--------|
| **NB-ARC-106** | Homologación e2e AFIP — evidencia + runbook |
| **NB-OBS-001** | Métricas, tracing, alertas |
| **NB-REL-001** | Deploy Nest + Postgres prod |
| **NF-DATA-001/002** | Misma UUID tenant Supabase ↔ Nest al cutover |

---

## Cómo mantener este doc

1. Al cerrar un ticket Nest, marcar rutas ✅ en la tabla del dominio.
2. Al agregar ruta en front (`app/api`), añadir fila aquí antes del cutover.
3. Contadores del resumen: recalcular con script sobre `app/api/**/route.ts`.

```powershell
# Conteo por dominio (PowerShell)
Get-ChildItem apps/frontend/src/app/api -Recurse -Filter route.ts |
  ForEach-Object { $_.FullName -replace '.*\\app\\api\\','' -replace '\\route\.ts$','' -replace '\\','/' } |
  Group-Object { ($_ -split '/')[0] } | Sort-Object Count -Descending
```

---

## Referencias

- Matriz resumida: `backend-parity-matrix.md`
- Backlog tickets: `backend-full-build-tickets.md`
- Cutover UI: `frontend-nest-migration-tickets.md`
- Contexto activo: `activeContext.md`
