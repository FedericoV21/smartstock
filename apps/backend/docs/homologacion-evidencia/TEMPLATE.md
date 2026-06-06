# Plantilla de evidencia ÔÇö NB-ARC-106

Copiar este archivo a `evidencia-YYYY-MM-DD.md` en esta misma carpeta (no commitear certificados ni CAE de producci├│n).

## Metadatos

| Campo | Valor |
|-------|--------|
| Fecha ejecuci├│n | |
| Ejecut├│ | |
| Commit backend | `git rev-parse --short HEAD` |
| Tenant ID | `00000000-0000-4000-8000-000000000001` |
| Sucursal ID | `d0000001-0001-4001-8001-000000000001` |
| CUIT homologaci├│n | |
| Punto de venta | |
| Flujo usado | ÔÿÉ A emit v9 ÔÿÉ B retry/wsfe |

## Pre-flight

- [ ] `POST /api/v1/branches/active` con sucursal demo
- [ ] `GET /api/v1/arca/homologation-readiness` ÔåÆ `listo_para_homologacion: true`
- [ ] `ARCA_WORKER_STUB=false`
- [ ] Certificado AFIP homo cargado v├¡a `PUT /arca/config` + `sucursalId`
- [ ] `POST /arca/test-connection?sucursalId=...` ÔåÆ OK
- [ ] `POST /arca/sync-numeracion?sucursalId=...` ÔåÆ OK

## Caso 1 ÔÇö Ticket WSAA

- Request: `POST /api/v1/arca/test-connection` o `PUT /api/v1/arca/wsaa/ticket` body `{}`
- Resultado: ticket vigente / conexi├│n OK
- Log ID:
- `exitoso` en `arca_log`: ÔÿÉ s├¡ ÔÿÉ no

## Caso 2 ÔÇö CAE feliz (emit v9)

- Request: `POST /api/v1/facturacion/comprobantes`
- Body resumido: `{ "tipo": "factura_b", "items": [{ "productoId": "...", "cantidad": 1 }] }`
- Comprobante ID:
- CAE recibido (├║ltimos 4 d├¡gitos): ****
- Vencimiento CAE:
- N├║mero AFIP asignado:
- Estado comprobante: `emitido`
- PDF: `GET /facturacion/comprobantes/:id/pdf` ÔÿÉ OK

## Caso 2b ÔÇö CAE feliz (retry, opcional)

- Comprobante seed/retry ID: `c0000001-0001-4001-8001-000000000003`
- Request: `POST /facturacion/comprobantes/:id/retry-arca` o `PUT /arca/wsfe/cae`
- CAE (├║ltimos 4): ****
- Estado: `emitido`

## Caso 3 ÔÇö Rechazo controlado

- Comprobante / escenario:
- C├│digos AFIP:
- Estado comprobante: `error_arca`
- Log ID:

## Caso 4 ÔÇö Red / timeout (opcional)

- M├®todo de simulaci├│n:
- Estado comprobante esperado: `pendiente_arca`
- error_codigo en log: `NETWORK`

## Caso 5 ÔÇö PDF post-CAE

- Comprobante ID:
- `GET .../pdf` tama├▒o bytes:
- `pdf_url` en respuesta (si storage): ÔÿÉ s├¡ ÔÿÉ no

## Consultas SQL

Adjuntar salida anonimizada de `apps/backend/scripts/verify-arca-homologacion.sql`.

## Observaciones

-
