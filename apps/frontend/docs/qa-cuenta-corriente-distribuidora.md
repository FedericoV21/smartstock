---
estado: activo
version: v1.0
ultima_actualizacion: 2026-05-30
---

# QA — Cuenta corriente distribuidora (checklist manual)

Pruebas recomendadas antes de activar en un tenant productivo. Requiere **facturador_simple** y, para ticket sin importes, **facturador_pos**.

## Preparación

1. Tenant de prueba con al menos un cliente con cuenta corriente.
2. Sucursal operativa seleccionada en el encabezado del dashboard.
3. Caja con turno abierto en POS (para fase A).
4. En **Configuración → Preferencias por sucursal** (elegir sucursal):
   - [ ] `Permitir ajustes por caja`
   - [ ] `Panel movimientos del día`
   - [ ] `Liquidar precios del día`
5. En **Facturación → Cierre de caja → Cajas del negocio** (misma sucursal):
   - [ ] En la caja de despacho CC: `Ticket cuenta corriente sin importes`
   - [ ] Otra caja de la misma sucursal **sin** el toggle (control negativo)

## Fase A — Ticket sin importes

| # | Paso | Esperado |
|---|------|----------|
| A1 | POS, caja **con** toggle, cliente CC, **Emitir con pago pendiente** | Ticket térmico sin precios ni total; sí cantidades y descripción |
| A2 | Misma venta en pantalla POS | Carrito sigue mostrando precios (solo el térmico oculta) |
| A3 | POS, caja **sin** toggle, venta CC | Ticket **con** importes |
| A4 | Reimprimir comprobante de A1 | Mismo modo sin importes |
| A5 | Venta CC en **efectivo** (caja con toggle) | Ticket **con** importes |

## Fase B — Movimientos del día

| # | Paso | Esperado |
|---|------|----------|
| B1 | Tras A1, ficha cliente `/cuenta-corriente/[id]` | Panel «Movimientos del día» con el comprobante y líneas |
| B2 | Listado `/cuenta-corriente` | Badge «N cargos hoy» junto al nombre |
| B3 | Desactivar `panelMovimientosDia` en sucursal | Panel y badge no aparecen |
| B4 | Admin con otra sucursal activa | Solo cargos de la sucursal operativa |

## Fase C — Liquidación

| # | Paso | Esperado |
|---|------|----------|
| C1 | Ticket CC de hoy sin precios (o en $0), panel día | Inputs PU y «Guardar precios» |
| C2 | Cargar precios y guardar | Total comprobante, saldo CC y cobranza actualizados |
| C3 | Bajar total por debajo de un cobro ya registrado | Error claro, sin corromper datos |
| C4 | Comprobante con CAE fiscal | No editable desde el panel |
| C5 | Visor (rol sin edición) | No ve botón guardar |

## Fase D — Extracto

| # | Paso | Esperado |
|---|------|----------|
| D1 | Ficha cliente → Extracto, período mes | Tabla debe/haber/saldo; saldo final = saldo CC |
| D2 | Descargar CSV | Archivo con cliente, período y movimientos |
| D3 | Reportes → Extracto cuenta corriente | Misma data; PDF y CSV funcionan |
| D4 | Registrar un pago en CC en el período | Aparece en haber; saldo corrido baja |

## Automatizado (local)

```bash
npx vitest run src/test/ticket-ocultar-importes-cc.test.ts src/test/movimientos-dia-cc.test.ts src/test/liquidar-items-dia-cc.test.ts src/test/extracto-cuenta-corriente.test.ts src/test/cuenta-corriente-distribuidora.test.ts
```

## Regresión rápida

- [ ] Cobranza por factura (campana / pago parcial) sigue funcionando sin las prefs ON.
- [ ] Otra sucursal del tenant sin prefs: comportamiento anterior intacto.
