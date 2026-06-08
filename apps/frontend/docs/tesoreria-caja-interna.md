# Caja interna / Tesorería

## Visión

Caja administrativa separada de las cajas POS para registrar efectivo y cheques, y pagar proveedores descontando saldo. Opt-in por tenant vía `business_prefs.cajaInterna`.

## Configuración

En **Configuración → Preferencias de negocio → Negocio**:

- `cajaInterna.habilitado`: activa el módulo.
- `cajaInterna.alcance`: `tenant` (una caja central) o `sucursal` (una por sucursal activa).

Al guardar, se ejecuta `provisionar_cajas_tesoreria`.

## Permisos

- RBAC: `tesoreria.gestionar` (admin/superadmin por defecto).
- Requiere módulo `facturador_simple`.

## Base de datos

Migración `192_caja_tesoreria.sql`:

- `caja_tesoreria`
- `caja_tesoreria_movimiento` (ledger)
- `caja_tesoreria_cheque` (cartera detallada)

RPCs principales: ingreso efectivo, alta cheque, transferencia manual desde caja POS, pago proveedor (parcial con saldo de cheque), cambio estado cheque, revertir por pago.

Migración `193_cheque_tesoreria_saldo_parcial.sql`: saldo consumible de cheques en varios pagos.

## API

- `GET /api/tesoreria` — resumen + movimientos + cheques
- `POST /api/tesoreria/ingreso-efectivo`
- `GET/POST /api/tesoreria/cheques`
- `PATCH /api/tesoreria/cheques/[id]/estado`
- `POST /api/tesoreria/transferencia-desde-caja`
- `POST /api/tesoreria/pago-proveedor`
- `GET /api/tesoreria/cierres-recientes`
- `GET /api/tesoreria/obligaciones?proveedor_id=`

## UI

- `/tesoreria` — panel principal
- Enlace desde cierre de caja (historial) y ficha proveedor
- Sin integración automática en el cierre POS: el admin registra transferencias manualmente

## Pagos a proveedor

`registrar_pago_proveedor_tesoreria` llama a `registrar_pago_cuenta_proveedor` / `registrar_pago_proveedor` y registra el egreso en tesorería. Un cheque en cartera puede financiar **varios pagos parciales** a distintos proveedores hasta agotar su saldo (`saldo_disponible_cheque_tesoreria`). Al revertir un pago con cheque se restaura el saldo del cheque. No se puede depositar o rechazar un cheque que ya tiene pagos imputados.
