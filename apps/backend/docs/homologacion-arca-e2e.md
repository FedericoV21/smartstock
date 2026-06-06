# Homologaci├│n ARCA (AFIP) ÔÇö gu├¡a NB-ARC-106

Validar el flujo **real contra homologaci├│n AFIP** (WSAA + WSFE) y archivar evidencia antes de producci├│n.

> **Modelo v9 (NB-ARC-108):** la emisi├│n fiscal crea el comprobante en `pendiente_arca` con `numero = null` y solicita CAE **inline** post-transacci├│n. Tambi├®n pod├®s reintentar con `retry-arca` o `PUT /arca/wsfe/cae` sobre un comprobante existente.

## 1. Pre-requisitos

### Entorno backend

```bash
cd apps/backend
cp .env.example .env
# Completar:
# JWT_SECRET=...
# ARCA_ENCRYPTION_KEY=...   # exactamente 32 caracteres
# ARCA_WORKER_SECRET=...      # opcional, para cola async
# ARCA_WORKER_STUB=false      # obligatorio para homo real

npm run migration:run
npm run seed:demo
npm run start:dev
```

### Sucursal activa

Los endpoints ARCA usan la **sucursal activa** del JWT/header. Antes de homologar:

```http
POST /api/v1/branches/active
Authorization: Bearer {{accessToken}}
Content-Type: application/json

{ "sucursalId": "d0000001-0001-4001-8001-000000000001" }
```

### Certificado AFIP

- Certificado digital del CUIT de prueba, asociado al **punto de venta** habilitado en homologaci├│n.
- Archivos PEM: certificado + clave privada (nunca commitear).

### JWT de prueba

- `tenant_id`: `00000000-0000-4000-8000-000000000001`
- `rol` / `app_role`: `admin`

## 2. Checklist automatizado (sin llamar AFIP)

```http
GET /api/v1/arca/homologation-readiness
Authorization: Bearer {{accessToken}}
```

Respuesta esperada: `listo_para_homologacion: true` y `bloqueantes: 0`.

Si hay bloqueantes, resolver en orden:

1. Variables de entorno (`ARCA_ENCRYPTION_KEY`, `JWT_SECRET`)
2. `POST /api/v1/branches/active` con sucursal demo
3. `PUT /api/v1/arca/config` con `sucursalId`, CUIT, PV, certificados
4. Comprobante en `pendiente_arca` (seed: `c0000001-0001-4001-8001-000000000003`, `numero = null`) **o** emitir uno nuevo (flujo A)

## 3. Flujo manual Postman

### Flujo A ÔÇö Emit v9 (recomendado, paridad POS)

| Paso | Request | Evidencia |
|------|---------|-----------|
| 0 | `GET /arca/homologation-readiness` | JSON checks |
| 1 | `PUT /arca/config` + `sucursalId` | cert cargado |
| 2 | `POST /arca/test-connection?sucursalId=...` | WSAA + WSFE OK |
| 3 | `POST /arca/sync-numeracion?sucursalId=...` | ├║ltimo nro AFIP |
| 4 | `POST /facturacion/comprobantes` `{ tipo: factura_b, items: [...] }` | `estado: emitido`, CAE, n├║mero AFIP |
| 5 | `GET /facturacion/comprobantes/:id/pdf` | bytes PDF |
| 6 | `GET /arca/logs?limit=20` | logs WSAA/WSFE |

Con `facturador_arca=true` y config completa, el paso 4 hace numeraci├│n pre-CAE + FECAESolicitar autom├íticamente.

### Flujo B ÔÇö Retry sobre comprobante pendiente (seed o bandeja)

| Paso | Request | Evidencia |
|------|---------|-----------|
| 0ÔÇô3 | Igual que flujo A | |
| 4 | `PUT /arca/wsaa/ticket` `{}` | ticket vigente |
| 5 | `POST /facturacion/comprobantes/:id/retry-arca` **o** `PUT /arca/wsfe/cae` | CAE + `emitido` |
| 6ÔÇô7 | Detalle + PDF + logs | |

Comprobante demo: `c0000001-0001-4001-8001-000000000003` (`pendiente_arca`, `numero = null`).

Alternativa async: `POST /internal/arca-jobs/run` con header `x-arca-worker-secret`.

## 4. Casos de prueba obligatorios

### 4.1 Ticket WSAA

- `POST /arca/test-connection` o `PUT /arca/wsaa/ticket`.
- Verificar en BD: `arca_log` con `servicio = WSAA`, `exitoso = true`.

### 4.2 CAE feliz (emit v9 o retry)

- Comprobante coherente (importes, tipo, receptor seg├║n reglas AFIP homo).
- Evidencia: `estado: emitido`, `numero` AFIP, `cae` y `cae_vencimiento` persistidos.

### 4.3 Rechazo controlado

- Forzar error (datos inv├ílidos seg├║n AFIP homo) o usar comprobante seed `error_arca`.
- Evidencia: `estado: error_arca`; c├│digos en `arca_log` / `ultimo_error_arca_codigo`.

### 4.4 Red / timeout (opcional)

- Simular fallo de red hacia WSFE.
- Evidencia: comprobante `pendiente_arca`, log con c├│digo `NETWORK`.

### 4.5 PDF post-CAE

- Tras CAE aprobado: PDF descargable o `pdf_url` si `PDF_STORAGE_ENABLED=true`.

## 5. Verificaci├│n SQL

```bash
psql "$DATABASE_URL" -f apps/backend/scripts/verify-arca-homologacion.sql
```

O ejecutar las consultas del script en tu cliente SQL.

## 6. Archivar evidencia

1. Copiar `docs/homologacion-evidencia/TEMPLATE.md` ÔåÆ `evidencia-YYYY-MM-DD.md` (en la misma carpeta).
2. Completar casos 1ÔÇô5 **sin** pegar certificados ni CAE completos (anonimizar).
3. No commitear evidencia con datos sensibles (ver `.gitignore`).

## 7. Stub de homologaci├│n (solo dev/CI)

Con `ARCA_WORKER_STUB=true` y `arca_config.ambiente = homologacion`, el worker asigna CAE ficticio **sin** AFIP.

- ├Ütil para CI y desarrollo local.
- **No cierra** NB-ARC-106: la homologaci├│n real sigue siendo manual.

## 8. Automatizaci├│n existente

- **CI:** `.github/workflows/backend-ci.yml` ÔÇö build, migraciones, tests, smoke health (sin AFIP).
- **Unit tests:** `arca-wsfe*.spec.ts`, `arca-wsaa.service.spec.ts` ÔÇö parsing XML mockeado.

## 9. Cierre del ticket

NB-ARC-106 se considera **done** cuando:

- [ ] Casos 4.1ÔÇô4.5 ejecutados contra AFIP homo
- [ ] Evidencia archivada seg├║n secci├│n 6
- [ ] `ARCA_WORKER_STUB=false` en el entorno usado para la prueba
- [ ] Al menos un CAE obtenido v├¡a **emit v9** (flujo A) documentado en evidencia
