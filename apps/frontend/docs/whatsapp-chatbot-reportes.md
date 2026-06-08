# WhatsApp Chatbot - Catalogo de reportes

Este documento lista las acciones de reportes que el chatbot read-only puede resolver hoy por WhatsApp o por el sandbox web.

Indice del chatbot: [`whatsapp-chatbot.md`](./whatsapp-chatbot.md). Facturas (otro flujo): [`whatsapp-chatbot-facturas.md`](./whatsapp-chatbot-facturas.md).

Fuente tecnica principal: `src/lib/whatsapp/read-only-agent.ts`.

## Seguridad y alcance

- Solo responde a actores WhatsApp verificados y asociados a un tenant.
- Todas las consultas se ejecutan con `tenantId` explicito.
- No crea, modifica ni elimina datos.
- Si falta un modulo requerido, responde que el modulo no esta habilitado.
- La IA, cuando se habilite, debe rutear hacia estas tools o repreguntar; no debe inventar datos.

## Periodos soportados

Los reportes comerciales aceptan:

- `hoy`
- `ayer`
- `esta semana`
- `este mes` / `mes`
- `mes anterior` / `mes pasado`
- mes nombrado: `enero`, `febrero`, `marzo`, `abril`, `mayo`, etc.

Ejemplos:

- `ventas hoy`
- `productos mas vendidos en mayo`
- `ganancia mes anterior`
- `medios de pago esta semana`

Si el usuario nombra un mes sin año, el bot usa el año actual, salvo que ese mes todavia no haya ocurrido; en ese caso usa el año anterior.

## Reportes disponibles

| Intent | Tool | Modulo requerido | Que responde | Ejemplos |
|---|---|---|---|---|
| `reporte_ventas` | `getReport:ventas` | `facturador_simple` | Ventas netas del periodo, cantidad de comprobantes, facturas, tickets POS, notas de credito y ticket promedio. | `ventas hoy`, `cuanto vendimos en mayo`, `facturado esta semana`, `ventas mes anterior` |
| `reporte_ventas_productos` | `getReport:ventas_productos` | `facturador_simple` | Ranking de productos mas vendidos por unidades e importe (top 5, sin margen). | `productos mas vendidos`, `cuales fueron los productos mas vendidos`, `ranking productos abril` |
| `reporte_ventas_articulo` | `getReport:ventas_articulo` | `facturador_simple` + `analizador_rentabilidad` | Ranking por SKU (top 10) con unidades, importe y margen estimado; PDF si hay mas de 40 articulos. Misma logica que `/api/reportes/ventas-articulo`. | `ventas por articulo hoy`, `top sku mayo`, `margen por articulo` |
| `reporte_ventas_clientes` | `getReport:ventas_clientes` | `facturador_simple` | Ranking de clientes que mas compraron y total del periodo. Incluye `Consumidor final` cuando la venta no tiene cliente. | `clientes que mas compraron`, `ventas por cliente mayo`, `mejores clientes mes anterior` |
| `reporte_ganancias` | `getReport:ganancias` | `facturador_simple` | Ventas netas, costo de mercaderia, margen bruto y porcentaje de margen. | `ganancia del mes`, `margen mes anterior`, `rentabilidad de mayo` |
| `reporte_medios_pago` | `getReport:medios_pago` | `facturador_simple` | Total vendido agrupado por medio de pago y total del periodo. | `medios de pago hoy`, `ventas por medio de pago`, `formas de pago en mayo` |
| `reporte_stock_general` | `getReport:stock_general` | `stock` | Stock total por producto activo, paginado. En reportes grandes puede adjuntar PDF. | `reporte de stock`, `inventario general`, `stock` |
| `reporte_stock_bajo` | `getReport:stock_bajo` | `stock` | Productos activos con stock actual menor o igual al stock minimo. | `stock bajo`, `faltantes`, `reporte de stock bajo` |
| `reporte_deuda_clientes` | `getReport:clientes_deuda` | `facturador_simple` | Clientes con saldo pendiente positivo en cuenta corriente, paginado, con total. | `reporte deuda clientes`, `deuda clientes`, `me deben` |
| `reporte_deuda_proveedores` | `getReport:proveedores_deuda` | `stock` | Proveedores con saldo pendiente positivo, paginado, con total. En reportes grandes puede adjuntar PDF. | `deuda proveedores`, `reporte deuda proveedores`, `yo debo` |
| `reporte_resumen` | `getReport:resumen` | `facturador_simple` | Ingresos netos del periodo, facturas vs tickets, notas de credito y deuda CC activa. | `resumen del mes`, `resumen comercial`, `como venimos` |
| `reporte_comparativo_ventas` | `getReport:comparativo_ventas` | `facturador_simple` | Ingresos netos actual vs mes calendario anterior (delta $ y % en servidor). | `como venimos vs mes pasado`, `ventas vs mes anterior`, `comparativo ventas mayo` |
| `reporte_vencimientos` | `getReport:vencimientos` | `stock` | Productos que vencen en 30 dias (vencidos, criticos, proximos). | `vencimientos`, `que vence`, `productos por vencer` |
| `reporte_ventas_pos` | `getReport:ventas_consumidor` | `facturador_pos` | Tickets POS del periodo: cantidad, total, ticket promedio y franja horaria pico. Filtros opcionales por **caja** (nombre o número) y/o **operador/cajero**. | `ventas POS hoy`, `ventas pos caja mostrador hoy`, `tickets pos operador Maria Lopez`, `tickets pos caja 2 hoy` |
| `reporte_recibos` | `getReport:recibos` | `facturador_simple` | Recibos emitidos en el periodo con cliente y medio de pago. | `recibos del mes`, `recibos hoy` |
| `reporte_libro_iva` | `getReport:libro_iva` | `facturador_simple` + `analizador_rentabilidad` | Neto gravado, IVA y total de comprobantes fiscales del periodo. Sin rentabilidad activa, el bot indica modulo no habilitado. | `libro IVA`, `iva del mes` |
| `reporte_gasto_proveedores` | `getReport:proveedores_gasto` | `facturador_simple` + `analizador_rentabilidad` | Ranking de costo vendido asociado a proveedores. Requiere ambos modulos. | `gasto por proveedor`, `ranking proveedores` |
| `reporte_cierre_caja` | `getReport:cierre_caja` | `facturador_simple` | Arqueo read-only: cierre Z del dia (efectivo sistema vs contado) o snapshot del turno abierto. Periodos: `hoy`, `ayer`. Sin ejecutar cierre desde el chat. | `cierre de caja hoy`, `arqueo ayer`, `cierre z`, `estado del turno` |

### Cierre de caja (limitaciones v1)

- Usa la **primera sucursal activa** del tenant (sin elegir sucursal por chat).
- No filtra por caja: lista todas las cajas con cierre en el dia, o la caja general (`__sin_caja__`) si el turno sigue abierto.
- Si preguntan por **hoy** y no hay cierre Z pero hay apertura vigente, devuelve efectivo sistema del turno (misma logica que preview `GET /api/caja/cierre-z?preview=1`).
- Mes/semana nombrados no aplican; usar `hoy` o `ayer`.

### Comparativo de ventas (limitaciones v1)

- Solo **ingresos netos** agregados (facturas + tickets POS, menos notas de credito); no incluye margen, ranking de productos ni resumen comercial completo.
- Por defecto compara **este mes (parcial)** vs **mes anterior (calendario completo)**.
- Con mes nombrado (ej. `mayo`), compara ese mes vs el mes calendario inmediato anterior (ej. abril).
- No compara semana vs semana ni sucursal/caja en v1.

## Entrega PDF

Algunos reportes paginados superan el limite practico de texto en WhatsApp. En esos casos el bot envia un resumen corto y adjunta un PDF generado en servidor ([`report-pdf.ts`](../src/lib/whatsapp/report-pdf.ts)):

| Intent | Comportamiento |
|--------|----------------|
| `reporte_stock_general` | Resumen de la primera pagina + enlace/caption `PDF completo: ...` |
| `reporte_deuda_proveedores` | Igual cuando la lista de proveedores es larga |

En el **sandbox** (`/whatsapp`), el mensaje del asistente incluye el link del documento en el mismo hilo. En **WhatsApp live**, se encola un mensaje tipo `document` con el archivo.

Los demas reportes suelen caber en uno o pocos mensajes de texto.

## Acciones transaccionales (no son reportes)

Ver [`whatsapp-chatbot-acciones.md`](./whatsapp-chatbot-acciones.md): pagos a proveedor, cobros a clientes y ajustes de stock con doble confirmacion.

## Consultas relacionadas que no son reportes

Estas acciones tambien estan disponibles en el chatbot, pero son consultas puntuales:

| Intent | Tool | Que responde | Ejemplos |
|---|---|---|---|
| `stock_producto` | `getProductStock` | Stock de un producto puntual. | `stock de yerba playadito`, `cuanto stock tengo de coca` |
| `stock_mas_bajo` | `getProductLowestStock` | Producto con menor stock. | `producto con menos stock`, `cual es el producto con menos stock` |
| `cliente_deuda` | `getClienteDebt` | Deuda puntual de un cliente. | `cuanto me debe Juan Perez`, `deuda cliente Kiosco Centro`, `cuenta corriente del cliente Juan` (saldo, no movimientos) |
| `cliente_extracto_cc` | `getClienteExtractoCc` | Extracto/movimientos CC del periodo (default mes actual). Top 8 lineas + PDF si hay mas de 40 movimientos. Reutiliza `fetchExtractoCuentaCorriente`. | `extracto cuenta corriente Juan Perez`, `movimientos cc Kiosco Centro`, `historial cc Juan mayo` |
| `proveedor_deuda` | `getProveedorDebt` | Deuda puntual con un proveedor. | `cuanto le debo a proveedor Arcor`, `deuda proveedor Ginkgo` |
| `cliente_contacto` | `getClienteContact` | Telefono, email, direccion o datos de contacto de un cliente. | `telefono de Ana Garcia`, `mail de cliente Juan Perez`, `datos de contacto de Kiosco Centro` |
| `proveedor_contacto` | `getProveedorContact` | Telefono, email, direccion o datos de contacto de un proveedor (modulo stock). | `telefono del proveedor Arcor`, `mail de proveedor GinkGo`, `telefono del primero` (tras reporte deuda proveedores) |

## Memoria corta y follow-ups

El bot guarda memoria corta de slots conversacionales, no historial completo permanente.

Puede resolver follow-ups como:

- `y ayer?`
- `y del mes anterior?`
- `y de mayo?`
- `la primera`
- `telefono de la primera`
- `y su correo`
- `seguí`

Ejemplos de continuidad:

1. Usuario: `productos mas vendidos`
2. Bot: ranking del mes actual.
3. Usuario: `y del mes anterior?`
4. Bot interpreta: `productos mas vendidos mes anterior`.

Otro ejemplo:

1. Usuario: `clientes que mas compraron`
2. Bot: ranking por cliente.
3. Usuario: `telefono de la primera`
4. Bot interpreta: `telefono de cliente <primer cliente del ranking>`.

## No disponible todavia desde el chatbot

- Reporte POS filtrado por caja u operador especifico.
- Ventas por articulo con filtros avanzados de categoria/proveedor desde el chat (disponible en la web).
- Reportes de compras/importaciones.
- Exportacion CSV desde WhatsApp.
- Filtros por sucursal dentro del chat.
- Comparativos automaticos contra periodo anterior.

## Evals relacionados

La cobertura automatizada esta en:

- `src/test/fixtures/whatsapp-agent-evals.v141.json`
- `src/test/whatsapp-agent-evals.test.ts`

Version actual documentada: `v14.18`, con comparativo ventas (`WAE-171`…`174`), contacto proveedor, ventas POS por caja/operador, extracto CC cliente, ventas por articulo, cierre de caja, reglas NLU y follow-ups con `intentContext`.
