# SmartStock — Tickets backend NestJS completos

## Convenciones de este backlog

- **Formato ID:** `NB-<BLOQUE>-<NNN>`
- **Prioridad:** `critical`, `high`, `medium`
- **Estado inicial:** `todo`
- **Estimación:** puntos relativos (1, 2, 3, 5, 8)
- **Dependencias:** IDs previos obligatorios

---

## Workflow Git (obligatorio durante ejecución)

## Estrategia de ramas
- `main`: estable.
- `develop`: integración funcional del backend.
- `feature/<ticket-id>-<slug>`: implementación de un ticket.
- `hotfix/<ticket-id>-<slug>`: corrección urgente en producción.

## Ciclo estándar por ticket
1. Crear rama desde `develop`.
2. Implementar ticket + tests + docs.
3. Correr checks técnicos (incluye migraciones cuando aplique).
4. Commit con mensaje estructurado.
5. Push y PR contra `develop`.
6. Merge solo con CI en verde.

## Comandos guía
```bash
git checkout develop
git pull
git checkout -b feature/NB-ARC-001-app-bootstrap

# ... trabajo ...

git add .
git commit -m "feat(backend): NB-ARC-001 bootstrap Nest app"
git push -u origin feature/NB-ARC-001-app-bootstrap
```

## Momentos indicados para commit y push
- **Checkpoint 1:** estructura base compilando.
- **Checkpoint 2:** lógica principal + tests unitarios verdes.
- **Checkpoint 3:** integración/e2e + documentación actualizada.
- **Push mínimo:** al menos en Checkpoint 2 y Checkpoint 3.

## Convención de mensajes de commit
- `feat(backend): <ticket-id> <objetivo>`
- `fix(backend): <ticket-id> <ajuste>`
- `test(backend): <ticket-id> <cobertura>`
- `docs(backend): <ticket-id> <documentacion>`
- `chore(backend): <ticket-id> <infra>`

---

## Pipeline técnico preferido (DB changes)

Para todo ticket que modifique entidades/tablas:

```bash
# 1) Generar migración
npm run migration:generate

# 2) Validar compilación
npm run build

# 3) Ejecutar migraciones en entorno local
npm run migration:run
```

Regla: no se mergea ningún ticket de datos sin evidencia de estos 3 pasos.

---

# BLOQUE A — Fundaciones NestJS

## NB-ARC-001 — Bootstrap de backend NestJS
- Tipo: setup
- Prioridad: critical
- Estimación: 3
- Estado: todo
- Dependencias: ninguna
- Criterios:
  - Proyecto Nest creado con estructura modular acordada.
  - `npm run build` compila sin errores.
  - Health endpoint inicial operativo.
  - README interno del backend creado.

## NB-ARC-002 — ConfigModule + validación de entorno
- Tipo: setup
- Prioridad: critical
- Estimación: 2
- Estado: done
- Dependencias: NB-ARC-001
- Criterios:
  - Variables obligatorias validadas en arranque.
  - Soporte `dev/staging/prod`.
  - Error explícito si faltan secretos.
- Implementación:
  - Esquema **Joi** (`src/config/env.validation.ts`) + `ConfigModule.forRoot({ validationSchema })`.
  - `NODE_ENV`: `development`/`dev`, `staging`, `production`/`prod`, `test`.
  - CLI TypeORM (`src/database/data-source.ts`): `loadEnvFilesAndValidate()` carga `.env` + `.env.local` y aplica la misma validación.

## NB-ARC-003 — Logging estructurado + requestId
- Tipo: infra
- Prioridad: high
- Estimación: 2
- Estado: done
- Dependencias: NB-ARC-001
- Criterios:
  - Logger JSON consistente.
  - Correlation/request ID por request.
  - Logs de errores con contexto de tenant y usuario.
- Implementación:
  - **`nestjs-pino`**: logs JSON en `staging`/`production`/`prod`; `pino-pretty` en `development`/`dev`.
  - **`genReqId`**: respeta `x-request-id` o `x-correlation-id` si vienen; si no, UUID. `pino-http` expone `X-Request-Id` en la respuesta.
  - **`customProps` / `customErrorObject`**: campos `requestId`, `correlationId`, `tenantId`, `userId` (últimos dos desde cabeceras opcionales `x-tenant-id` / `x-user-id` hasta que exista JWT + guard).
  - **`LoggerErrorInterceptor`** global para errores en handlers con el mismo contexto de request.
  - **`LOG_LEVEL`** en env (`trace`…`silent`, default `info`); redacción de `authorization` / `cookie`.

## NB-ARC-004 — Error filter global
- Tipo: infra
- Prioridad: high
- Estimación: 2
- Estado: done
- Dependencias: NB-ARC-001
- Criterios:
  - Formato estándar de error API.
  - Mapeo claro de errores de dominio a HTTP.
  - Stacktrace solo en desarrollo.
- Implementación:
  - `GlobalExceptionFilter` (`APP_FILTER`) con cuerpo `{ error: { code, message, details }, meta: { requestId, timestamp } }` según `backend-nest-api-contracts.md`.
  - `DomainException` para códigos de negocio estables + HTTP status explícito.
  - `HttpException` / arrays de validación → `VALIDATION_ERROR` + `details.fields`.
  - Postgres `23505` (unique) → `409` + `DUPLICATE_RESOURCE`.
  - Errores no HTTP: mensaje genérico en prod; en `development`/`dev` incluye mensaje y `details.stack`.

## NB-ARC-005 — Swagger/OpenAPI inicial
- Tipo: docs
- Prioridad: medium
- Estimación: 1
- Estado: todo
- Dependencias: NB-ARC-001
- Criterios:
  - `/api/docs` habilitado.
  - Seguridad bearer definida.
  - Primer módulo documentado.

---

# BLOQUE B — Auth, tenancy y seguridad base

## NB-SEC-001 — JWT auth + guard de autenticación
- Tipo: feature
- Prioridad: critical
- Estimación: 5
- Estado: todo
- Dependencias: NB-ARC-002
- Criterios:
  - Validación de JWT en guard.
  - Decorator `@CurrentUser`.
  - Rechazo 401 uniforme.

## NB-SEC-002 — Contexto tenant request-scoped
- Tipo: feature
- Prioridad: critical
- Estimación: 5
- Estado: todo
- Dependencias: NB-SEC-001
- Criterios:
  - Resolución de `tenant_id` desde token.
  - Tenant context accesible por use cases/repos.
  - Bloqueo si falta tenant.

## NB-SEC-003 — Guard de roles (`admin`, `operador`, `visor`)
- Tipo: feature
- Prioridad: high
- Estimación: 2
- Estado: todo
- Dependencias: NB-SEC-001
- Criterios:
  - Decorator `@Roles`.
  - Acceso por rol en endpoints críticos.
  - 403 consistente.

## NB-SEC-004 — Rate limit y hardening headers
- Tipo: security
- Prioridad: high
- Estimación: 2
- Estado: todo
- Dependencias: NB-ARC-001
- Criterios:
  - Rate limiting por IP y endpoint sensible.
  - Headers de seguridad aplicados.

---

# BLOQUE C — Productos e inventario

## NB-PRD-001 — Módulo products (CRUD base)
- Tipo: feature
- Prioridad: critical
- Estimación: 8
- Estado: todo
- Dependencias: NB-SEC-002, NB-SEC-003
- Criterios:
  - CRUD completo por tenant.
  - Búsqueda por nombre/código.
  - Soft-delete funcional.

## NB-INV-001 — Módulo inventory (movimientos)
- Tipo: feature
- Prioridad: critical
- Estimación: 8
- Estado: todo
- Dependencias: NB-PRD-001
- Criterios:
  - Entrada/salida/ajuste.
  - Transacción con lock de fila.
  - Rechazo de stock negativo.

## NB-INV-002 — Historial y filtros de movimientos
- Tipo: feature
- Prioridad: high
- Estimación: 3
- Estado: todo
- Dependencias: NB-INV-001
- Criterios:
  - Listado paginado.
  - Filtros por tipo, producto, fecha.

## NB-INV-003 — Alertas stock bajo y vencimientos
- Tipo: feature
- Prioridad: high
- Estimación: 3
- Estado: todo
- Dependencias: NB-PRD-001
- Criterios:
  - Endpoints de alertas por tenant.
  - Índices/queries optimizados.

---

# BLOQUE D — Código de barras (producto)

## NB-BAR-001 — Diseño final del modelo barcode (decisión)
- Tipo: design
- Prioridad: critical
- Estimación: 2
- Estado: todo
- Dependencias: NB-PRD-001
- Criterios:
  - Decisión cerrada: campo principal vs tabla dedicada.
  - ADR breve documentado.

## NB-BAR-002 — Migración esquema barcode
- Tipo: migration
- Prioridad: critical
- Estimación: 3
- Estado: todo
- Dependencias: NB-BAR-001
- Criterios:
  - Esquema aplicado con constraints e índices.
  - Pipeline ejecutado:
    - `npm run migration:generate`
    - `npm run build`
    - `npm run migration:run`

## NB-BAR-003 — Validadores EAN/UPC + checksum
- Tipo: feature
- Prioridad: high
- Estimación: 3
- Estado: todo
- Dependencias: NB-BAR-002
- Criterios:
  - Validación por tipo.
  - Test unitario por variante.

## NB-BAR-004 — Endpoints CRUD de barcodes
- Tipo: feature
- Prioridad: high
- Estimación: 5
- Estado: todo
- Dependencias: NB-BAR-003
- Criterios:
  - Alta/edición/baja de barcode.
  - Unicidad por tenant.
  - Un principal por producto.

## NB-BAR-005 — Búsqueda por barcode en catálogo
- Tipo: feature
- Prioridad: high
- Estimación: 2
- Estado: todo
- Dependencias: NB-BAR-004
- Criterios:
  - Endpoint de búsqueda por barcode.
  - Integración con listado de productos.

---

# BLOQUE E — Importaciones y precios

## NB-IMP-001 — Preview server-side de importación
- Tipo: feature
- Prioridad: high
- Estimación: 5
- Estado: todo
- Dependencias: NB-PRD-001
- Criterios:
  - Endpoint preview con validaciones.
  - Errores por fila/campo.

## NB-IMP-002 — Ejecución importación con upsert robusto
- Tipo: feature
- Prioridad: critical
- Estimación: 8
- Estado: todo
- Dependencias: NB-IMP-001, NB-INV-001
- Criterios:
  - Upsert transaccional por tenant.
  - Registro de movimientos e historial de precio.
  - Idempotencia por request key.

## NB-IMP-003 — Integración aliases `ean/upc/barras`
- Tipo: feature
- Prioridad: critical
- Estimación: 5
- Estado: todo
- Dependencias: NB-BAR-004, NB-IMP-002
- Criterios:
  - Mapeo correcto a barcode.
  - Rechazos claros por checksum inválido.

## NB-PRC-001 — Módulo pricing historial y sugerencias
- Tipo: feature
- Prioridad: medium
- Estimación: 5
- Estado: todo
- Dependencias: NB-IMP-002
- Criterios:
  - Historial paginado.
  - Sugerencia de margen configurable.

---

# BLOQUE F — Facturación y pedidos

## NB-FAC-001 — Emisión de comprobantes (core)
- Tipo: feature
- Prioridad: critical
- Estimación: 8
- Estado: todo
- Dependencias: NB-INV-001, NB-SEC-003
- Criterios:
  - Emisión transaccional.
  - Descuento/devolución de stock por tipo.
  - Estados coherentes.

## NB-FAC-002 — Numeración segura por tipo
- Tipo: feature
- Prioridad: critical
- Estimación: 3
- Estado: todo
- Dependencias: NB-FAC-001
- Criterios:
  - Sin duplicados bajo concurrencia.
  - Retry controlado ante conflict.

## NB-FAC-003 — PDF generator backend desacoplado
- Tipo: feature
- Prioridad: high
- Estimación: 5
- Estado: todo
- Dependencias: NB-FAC-001
- Criterios:
  - Servicio PDF separado.
  - Plantilla extensible para bloque fiscal.

## NB-PED-001 — Pedidos con estado y conversión
- Tipo: feature
- Prioridad: high
- Estimación: 8
- Estado: todo
- Dependencias: NB-INV-001, NB-FAC-001
- Criterios:
  - Máquina de estados robusta.
  - Conversión a factura.
  - Stock comprometido/disponible.

---

# BLOQUE G — ARCA completo y barcode fiscal

## NB-ARC-101 — Configuración ARCA en backend
- Tipo: feature
- Prioridad: critical
- Estimación: 5
- Estado: todo
- Dependencias: NB-SEC-003
- Criterios:
  - Guardado seguro de certificados.
  - Cifrado con clave de entorno.

## NB-ARC-102 — WSAA real (ticket vigente)
- Tipo: feature
- Prioridad: critical
- Estimación: 8
- Estado: todo
- Dependencias: NB-ARC-101
- Criterios:
  - Obtención y renovación de ticket.
  - Logs auditables en tabla ARCA.

## NB-ARC-103 — WSFE real (solicitud CAE)
- Tipo: feature
- Prioridad: critical
- Estimación: 8
- Estado: todo
- Dependencias: NB-ARC-102
- Criterios:
  - Solicitud y parseo de respuesta ARCA.
  - Manejo de rechazo/timeout.

## NB-ARC-104 — Integración `arca_job` worker productivo
- Tipo: feature
- Prioridad: critical
- Estimación: 5
- Estado: todo
- Dependencias: NB-ARC-103
- Criterios:
  - Jobs encolados/procesados con idempotencia.
  - Reintentos + terminal state correctos.

## NB-ARC-105 — Código de barras fiscal en PDF
- Tipo: feature
- Prioridad: critical
- Estimación: 5
- Estado: todo
- Dependencias: NB-ARC-103, NB-FAC-003
- Criterios:
  - Generación cadena fiscal + DV.
  - Render en PDF junto a CAE y vencimiento.
  - Regeneración automática tras aprobación ARCA.

## NB-ARC-106 — Homologación ARCA e2e
- Tipo: test
- Prioridad: high
- Estimación: 8
- Estado: todo
- Dependencias: NB-ARC-105
- Criterios:
  - Casos felices y de error validados en homologación.
  - Evidencia documentada.

---

# BLOQUE H — Calidad, observabilidad y release

## NB-QA-001 — Test suite backend (unit + integration + e2e)
- Tipo: test
- Prioridad: critical
- Estimación: 8
- Estado: todo
- Dependencias: bloques C-G
- Criterios:
  - Cobertura en casos críticos.
  - Pipeline CI verde.

## NB-OBS-001 — Métricas, tracing y alertas
- Tipo: infra
- Prioridad: high
- Estimación: 5
- Estado: todo
- Dependencias: NB-ARC-003
- Criterios:
  - Dashboard de latencia/error.
  - Alertas de fallos ARCA y colas.

## NB-REL-001 — Estrategia de deploy y rollback
- Tipo: devops
- Prioridad: high
- Estimación: 3
- Estado: todo
- Dependencias: NB-QA-001
- Criterios:
  - Runbook de deploy.
  - Checklist rollback.
  - Smoke test post-deploy.

---

## Reglas de merge por ticket

- Sin PR sin tests.
- Sin PR de datos sin:
  - `npm run migration:generate`
  - `npm run build`
  - `npm run migration:run`
- Sin evidencia de endpoint/documentación en OpenAPI.
- Sin changelog breve del ticket.

---

## Próximo paso recomendado

Arrancar por este orden de ejecución inicial:
1. `NB-ARC-001`
2. `NB-ARC-002`
3. `NB-SEC-001`
4. `NB-SEC-002`
5. `NB-PRD-001`
6. `NB-BAR-001`
