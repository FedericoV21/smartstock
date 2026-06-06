# Probar la API Nest sin frontend

## Requisitos

- Node 20+
- PostgreSQL accesible (`DB_*` en `apps/backend/.env`)
- Proyecto Supabase (solo para **emitir JWT** de prueba)

## 1. Base de datos

```bash
cd apps/backend
npm run build
npm run migration:run
npm run seed:demo
npm run start:dev
```

- Swagger: http://localhost:4000/api/docs
- Health: `GET http://localhost:4000/api/v1/health`

## 2. Alinear JWT

En `apps/backend/.env`:

```env
JWT_SECRET=<mismo valor que JWT Secret del proyecto Supabase>
```

En el JWT (hook o `app_metadata` / `user_metadata`):

- `tenant_id`: `00000000-0000-4000-8000-000000000001` (seed demo)
- `rol` o `app_role`: `admin` | `operador` | `visor`

## 3. Obtener `access_token`

1. Login en el front o Supabase Auth (email/password).
2. DevTools ÔåÆ Application ÔåÆ cookies, o respuesta de `signInWithPassword`.
3. Copiar `access_token` del session JSON.

Alternativa: Supabase Dashboard ÔåÆ Authentication ÔåÆ Users ÔåÆ impersonate (si est├í habilitado).

## 4. Postman / Thunder Client

Importar:

- `apps/backend/docs/postman/smartstock-nest-api.postman_collection.json`
- `apps/backend/docs/postman/smartstock-nest-local.postman_environment.json`

Variables de entorno:

| Variable | Ejemplo |
|----------|---------|
| `baseUrl` | `http://localhost:4000` |
| `accessToken` | eyJhbG... |
| `idempotencyKey` | uuid v4 por request de import |
| `branchId` | `d0000001-0001-4001-8001-000000000001` (seed CASA) |
| `comprobanteId` | `c0000001-...000003` pendiente_arca |
| `comprobanteEmitidoId` | `c0000001-...000002` emitido con CAE |
| `arcaWorkerSecret` | valor de `ARCA_WORKER_SECRET` en `.env` |

├ìndice de carpetas y variables: `docs/postman/README.md`.

En cada request: **Authorization ÔåÆ Bearer Token ÔåÆ `{{accessToken}}`**.

## 5. Flujo feliz sugerido

1. `GET /api/v1/auth/me` (crea/sincroniza fila `usuario` si falta)
2. `GET /api/v1/categories`
3. `GET /api/v1/products?pageSize=5`
4. `POST /api/v1/products` (crear SKU de prueba)
5. `POST /api/v1/inventory/movimientos` (entrada)
6. `GET /api/v1/facturacion/comprobantes` (listado)
7. `GET /api/v1/facturacion/comprobantes/:id` (detalle + ├¡tems)
8. `GET /api/v1/config/tenant` y `GET /api/v1/config/modules`
9. `GET /api/v1/branches` ÔåÆ `POST /api/v1/branches/active` (persiste sucursal en perfil)
10. `GET /api/v1/inventory/branch-stock` (con header `X-Sucursal-Id`)
11. `GET /api/v1/products/:id/branch-stock`
12. `GET/PATCH /api/v1/products/:id/branch-pricing` y `branch-plu` (override por dep├│sito)
13. `POST /api/v1/inventory/branch-transfers` ÔåÆ `POST .../:id/receive` (transferencia entre dep├│sitos)
14. `GET /api/v1/facturacion/comprobantes/:id/pdf` (descarga PDF) y `POST .../pdf/regenerate` (sube a S3 si est├í configurado)
15. `POST /api/v1/facturacion/comprobantes` (ticket con ├¡tem)
16. `GET /api/v1/pricing/historial?producto_id=...` (m├│dulo `ia_precios`)
17. `GET /api/v1/pedidos/workflow-estados` ÔåÆ `PATCH /api/v1/pedidos/:id/estado`
18. `GET/PATCH /api/v1/customers/:id/cuenta-corriente` y `GET .../extracto`
19. `GET/PATCH /api/v1/suppliers/:id/cuenta-corriente` ÔåÆ `POST .../pago-cuenta` o `pago-multiple`
20. `GET /api/v1/arca/config` ÔåÆ `PUT /api/v1/arca/wsaa/ticket` ÔåÆ `PUT /api/v1/arca/wsfe/cae` (homologaci├│n; ver `homologacion-arca-e2e.md`)

Header recomendado para operaciones por dep├│sito: `X-Sucursal-Id: d0000001-0001-4001-8001-000000000001` (sucursal demo CASA).

## 6. Errores frecuentes

| HTTP | Causa |
|------|--------|
| 401 | `JWT_SECRET` distinto o token vencido |
| 403 | Falta `rol` en JWT o rol insuficiente |
| 400 | `tenant_id` ausente en token |
| 0 / red | Nest no levantado o puerto incorrecto |
