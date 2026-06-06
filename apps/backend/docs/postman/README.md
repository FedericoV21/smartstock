# Postman / Thunder Client ÔÇö SmartStock Nest API

## Importar

1. `smartstock-nest-api.postman_collection.json` ÔÇö colecci├│n v2.1
2. `smartstock-nest-local.postman_environment.json` ÔÇö variables locales

Tambi├®n compatible con **Thunder Client** (VS Code): importar los mismos JSON.

## Variables obligatorias

| Variable | Uso |
|----------|-----|
| `baseUrl` | `http://localhost:4000` |
| `accessToken` | JWT Supabase (Bearer) |
| `idempotencyKey` | UUID por request de importaci├│n |

## Variables demo (seed)

Tras `npm run seed:demo`, los UUIDs del environment apuntan al tenant `00000000-0000-4000-8000-000000000001`.

| Variable | Descripci├│n |
|----------|-------------|
| `branchId` | Sucursal CASA |
| `productId` | Yerba mate demo |
| `customerId` / `supplierId` | Cliente y proveedor demo |
| `comprobanteId` | Factura A `pendiente_arca` (ARCA / retry) |
| `comprobanteEmitidoId` | Factura B emitida (PDF) |
| `comprobanteVoidId` | Ticket `error_arca` (void) |
| `pedidoId` | Pedido confirmado |
| `arcaWorkerSecret` | Igual a `ARCA_WORKER_SECRET` en `.env` |

Algunas variables (`workflowEstadoId`, `obligacionProveedorId`, `supplierLoserId`) se completan despu├®s de crear datos en la API.

## Carpetas de la colecci├│n

| Carpeta | M├│dulo Nest |
|---------|-------------|
| Health & Auth | health, auth/me |
| Catalog | categories, suppliers, customers, merge |
| Cuenta corriente cliente / proveedor | `customers/.../cuenta-corriente`, `suppliers/...` |
| Promotions | promociones |
| Products | CRUD, lotes, imagen, merge, variantes |
| Inventory | movimientos, alertas, transferencias |
| Importaciones | preview, drafts, logs, obligaciones |
| AI | l├¡mites, extract, preview |
| Config / Branches | tenant, m├│dulos, sucursales |
| Branch stock / pricing / PLU | stock y precios por dep├│sito |
| Facturaci├│n & Pedidos | comprobantes, ARCA tray, compra manual |
| Pedidos workflow | estados configurables y transiciones |
| Pricing | historial, sugerencias |
| Reports | resumen, libro IVA, ventas por per├¡odo/art├¡culo, POS consumidor |
| ARCA | config, WSAA, WSFE, worker interno |

## Auth

La colecci├│n usa **Bearer Token** a nivel ra├¡z (`{{accessToken}}`). Excepciones:

- `GET /health` ÔÇö sin auth
- `POST /internal/arca-jobs/run` ÔÇö header `x-arca-worker-secret`

## M├ís contexto

- Runbook: `../probar-api-sin-frontend.md`
- Homologaci├│n AFIP: `../homologacion-arca-e2e.md` ÔÇö empezar por `GET /arca/homologation-readiness`
- Swagger: http://localhost:4000/api/docs
