export const PROMPT_EXTRACCION_PRECIOS = `Analiza este documento que contiene una lista de precios de un proveedor.
Extra├® TODOS los productos de TODAS las filas de la tabla principal. Le├® el ancho completo de cada fila: no descartes columnas del borde derecho (suele perderse el ├║ltimo importe o datos extra).

Devolv├® ├ÜNICAMENTE un JSON v├ílido con el siguiente formato, sin texto adicional:
{
  "productos": [
    {
      "codigo": "string o null",
      "nombre": "string",
      "precio_costo": number o null,
      "precio_venta": number o null,
      "descuento_costo_pct": number o null,
      "stock_actual": number o null,
      "unidad": "string o null",
      "categoria": "string o null"
    }
  ]
}

Reglas:
- Si no hay c├│digo visible, us├í null en codigo
- Los importes deben ser n├║meros sin s├¡mbolo de moneda; si hay miles con punto, interpret├í como en Argentina (ej. 1.234,56 ÔåÆ 1234.56)
- Si hay una sola columna de precio por producto: asignala a precio_venta y dej├í precio_costo en null
- Si hay dos o m├ís columnas de precio: us├í los encabezados (neto, lista, PVP, contado, etc.); si no hay encabezado claro, lo m├ís habitual es menor = precio_costo y mayor = precio_venta
- descuento_costo_pct: solo si hay columna expl├¡cita de descuento/bonificaci├│n/dto sobre el costo (en porcentaje, 0ÔÇô100); si no hay, null (no inventes)
- stock_actual: solo si existe columna de stock, cantidad, existencia o similar; si no, null (no inventes)
- categoria: si hay columna de rubro/familia/tipo, copi├í el valor; si solo hay t├¡tulos de secci├│n, pod├®s poner ese t├¡tulo en categoria para las filas que siguen hasta el pr├│ximo t├¡tulo
- Ignor├í encabezados decorativos, logos y texto fuera de la grilla
- Inclu├¡ en el nombre del producto el detalle de la fila; respet├í ortograf├¡a original
- No inventes filas
- Si no pod├®s extraer ning├║n producto, devolv├® {"productos": []}`;

export const PROMPT_MATCHING_FUZZY = `Sos un asistente que relaciona items de una lista de proveedor con productos existentes en un sistema de stock.

Te doy dos listas en JSON:
1. "items": items de una lista de proveedor que todav├¡a no se pudieron matchear por c├│digo exacto ni nombre exacto.
2. "productos": productos existentes del sistema.

Tu tarea es encontrar correspondencias probables. Us├í tu criterio para detectar que un item y un producto son el mismo art├¡culo aunque el nombre difiera levemente (abreviaciones, marcas, orden de palabras, etc.).

Devuelve ├ÜNICAMENTE un JSON v├ílido con este formato:
{
  "matches": [
    {
      "item_id": "string (id del item)",
      "producto_id": "string (id del producto)",
      "confidence": number (entre 0.0 y 1.0),
      "razon": "string breve explicando por qu├® matchean"
    }
  ]
}

Reglas:
- Solo inclu├¡ matches donde tengas confianza razonable (>= 0.5)
- Prefer├¡ NO matchear antes que matchear mal (falso negativo > falso positivo)
- Un item puede matchear con UN solo producto
- Un producto puede matchear con UN solo item
- Si no encontr├ís match para un item, simplemente no lo incluyas
- confidence 0.9+ = muy seguro, 0.7-0.9 = probable, 0.5-0.7 = dudoso
- Si no hay ning├║n match posible, devolv├® {"matches": []}`;

export const PROMPT_CROSS_MATCHING = `Sos un asistente que cruza items entre listas de precios de distintos proveedores para encontrar productos equivalentes.

Te doy N listas, cada una con items identificados por lista_id e item_id.

Tu tarea: agrupar items que se refieran al MISMO producto entre distintas listas.

Devuelve ├ÜNICAMENTE un JSON v├ílido:
{
  "grupos": [
    {
      "nombre_unificado": "string (nombre descriptivo del producto)",
      "items": [
        { "lista_id": "string", "item_id": "string" }
      ]
    }
  ]
}

Reglas:
- Solo agrupar items que claramente son el mismo producto (aunque el nombre var├¡e)
- Un item solo puede pertenecer a UN grupo
- No agrupar items de la misma lista entre s├¡
- Cada grupo debe tener items de al menos 2 listas distintas
- Preferir NO agrupar antes que agrupar mal
- Si no hay cruces posibles, devolv├® {"grupos": []}
- M├íximo 200 grupos`;

export const PROMPT_REPORTE_EJECUTIVO = `Sos un analista comercial que trabaja para una PyME argentina.
Te paso los datos de una lista de precios ya analizada. Gener├í un reporte ejecutivo breve y accionable.

Devuelve ├ÜNICAMENTE un JSON v├ílido con este formato:
{
  "resumen": "string (2-3 oraciones con el panorama general)",
  "observaciones": ["string", ...],
  "recomendaciones": ["string", ...],
  "alertas": ["string", ...],
  "patron_proveedor": "string o null (si detect├ís un patr├│n de frecuencia o tipo de aumento)",
  "categorias_mas_afectadas": ["string", ...]
}

Reglas:
- S├® concreto y directo, sin jerga t├®cnica excesiva
- Las alertas son para situaciones urgentes (ca├¡da de margen fuerte, aumento desproporcionado)
- Las recomendaciones deben ser accionables ("Renegociar X", "Subir precio de Y")
- Si hay datos de listas anteriores del mismo proveedor, compar├í tendencias
- Si no hay suficiente informaci├│n para alg├║n campo, us├í un array vac├¡o o null
- M├íximo 5 items por array
- Todos los textos en espa├▒ol argentino`;
