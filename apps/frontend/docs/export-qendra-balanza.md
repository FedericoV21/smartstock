# Exportación CSV para Qendra (balanza Systel Max)

Desde **Inventario → Productos**, con el módulo **POS / facturador** activo, **Qendra (balanza)** genera un CSV para la importación automática en Qendra / balanzas Systel Max.

## Qué se exporta

- Productos **activos** con **PLU**:
  - **Pesables** (`es_pesable`) → tipo de venta **`p`**
  - **No pesables** con medida de stock **unidad** y PLU → **`u`**
- Podés elegir:
  - **Por categorías** — una o varias categorías del negocio.
  - **Por productos seleccionados** — los marcados en la tabla o «toda la búsqueda».

## Formato del CSV

- Archivo: **`qendra.csv`**, UTF-8 (con BOM), delimitador **`;`**
- **Sin fila de encabezados**
- Una fila por producto, columnas en este orden:

| # | Campo | Ejemplo | Notas |
|---|--------|---------|--------|
| 1 | Sección | `FIAMBRE` | Categoría o sector fijo del diálogo |
| 2 | Código de PLU | `274` | PLU sin ceros a la izquierda |
| 3 | Descripción | `combo 1` | Hasta 40 caracteres |
| 4 | Número de PLU | `274` | Igual que código de PLU |
| 5 | Precio Lista 1 | `2500,00` | Precio de venta; coma decimal |
| 6 | Precio Lista 2 | `0,00` | Precio con descuento si hay promo `% off` vigente; si no, `0,00` |
| 7 | Tipo de venta | `u` / `p` | `u` = unidad; `p` = peso |
| 8 | Vencimiento | `0` | `0` sin fecha; si hay `fecha_vencimiento`, días hasta el vencimiento |
| 9 | Ingredientes | *(vacío)* | Descripción del producto si existe; si no, vacío |

Ejemplos:

```csv
FIAMBRE;274;combo 1;274;2500,00;0,00;u;0;
FIAMBRE;252;aceitunas con carozo;252;20000,00;0,00;p;0;
```

## API

`POST /api/productos/export-qendra-balanza`

```json
{
  "categoria_ids": ["uuid-…"],
  "producto_ids": ["uuid-…"],
  "sector_fijo": "CARNES"
}
```

Al menos uno de `categoria_ids` o `producto_ids` es obligatorio. También `GET` con `categoria_ids` / `producto_ids` repetibles en la query.

## Importación en Qendra

1. Crear la **sección** en Qendra y en la balanza.
2. **Archivo → Importar** (importación automática Systel Max).
3. Delimitador **`;`**, **sin** primera fila de títulos.
4. Enviar novedades a la balanza.
