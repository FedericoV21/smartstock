# QA checklist multi-sucursal (hardening)

## Preparacion

- [ ] Tener al menos 2 sucursales activas en el mismo tenant.
- [ ] Tener 1 superadmin con permiso global (`sucursales.ver_todas`).
- [ ] Tener 1 usuario limitado solo a sucursal A.
- [ ] Tener 1 usuario limitado solo a sucursal B.
- [ ] Cargar datos de prueba en ambas sucursales (ventas, pedidos, caja, reportes).

## Login y contexto

- [ ] Login por correo y por `usuario + PIN` funciona para cada perfil.
- [ ] Usuario limitado no puede operar en sucursal no asignada (respuesta 403).
- [ ] Si no envia `sucursal_id`, la API usa `sucursal_default_id` del usuario.

## Operacion por modulo

- [ ] `facturacion/emitir` respeta `sucursal_id` y bloquea cross-sucursal.
- [ ] Endpoints de `caja` (apertura, cierre Z, historial) bloquean cross-sucursal.
- [ ] Endpoints de `pedidos` y conversiones de `presupuestos` bloquean cross-sucursal.

## Reportes

- [ ] Reportes por sucursal devuelven datos solo de la sucursal pedida.
- [ ] Superadmin puede consultar sucursal A, B y vista consolidada segun permisos.
- [ ] Reportes endurecidos: `clientes-deuda`, `ganancias-netas`, `proveedores-gasto`, `recibos`.
- [ ] Todos los reportes devuelven `sucursal_id` efectivo en la respuesta JSON.

## Seguridad y regresion

- [ ] Intentar forzar `sucursal_id` de otra sucursal con usuario limitado -> siempre 403.
- [ ] Repetir validacion en GET y POST/PATCH de endpoints criticos.
- [ ] Verificar que no se rompe flujo existente para tenant sin multi-sucursal activa.
- [ ] Verificar que exportaciones CSV mantienen el mismo resultado filtrado por sucursal.

## Cierre

- [ ] Ejecutar tests automatizados relevantes y dejar evidencia.
- [ ] Documentar resultados, incidencias y endpoints validados.
