# Plan completo — Bloque F (v6.0): Códigos de barra + POS con escáner

---

## 1. Visión general del bloque

Este bloque incorpora dos capacidades complementarias que juntas conforman un facturador profesional con escáner láser, y que se suman al motor de facturación ya existente sin modificarlo.

La primera capacidad es la **gestión de códigos de barra a nivel de producto**: que cada producto del catálogo pueda tener asignado uno o varios códigos de barra identificatorios, que puedan capturarse escaneando productos con código de fábrica, generarse internamente para productos sin código, y finalmente imprimirse en etiquetas físicas para pegar en los productos que lo necesiten. Esta capacidad tiene valor propio aunque el POS nunca se active, porque mejora la búsqueda de productos, facilita el control de inventario, y es precondición de todo lo demás.

La segunda capacidad es la **terminal POS con escáner**: una pantalla dedicada tipo caja registradora donde el operador dispara la pistola contra el producto, el sistema lo reconoce, lo agrega al comprobante en curso, acumula totales en tiempo real y finalmente emite ticket/factura reutilizando el motor de facturación existente. Esta pantalla está optimizada para uso intensivo con teclado y escáner, sin necesidad de mouse.

Se agrega un tercer elemento transversal: un **nuevo módulo** `facturador_pos` dentro de `modulo_config`, controlado por feature flag igual que el resto de módulos del sistema, activable individualmente por tenant según plan y necesidad.

Ambas capacidades son secuenciales en su implementación. Primero se construye la capa de productos (sin ella no hay nada que escanear), y luego se construye la pantalla POS que la consume.

---

## 2. Decisiones de diseño fundamentales

Estas decisiones atraviesan todo el bloque y conviene dejarlas claras desde el inicio porque condicionan muchas de las piezas técnicas posteriores.

### 2.1. El escáner se integra como teclado HID

La plataforma no necesita drivers, permisos de navegador, ni APIs especiales. La pistola láser se comporta como un teclado USB o Bluetooth estándar que "tipea" los caracteres del código de barras seguidos de un Enter en el campo que tenga el foco. Esto convierte toda la integración en un problema puramente frontend: capturar lo que se escribe en un input, detectar que viene del escáner por la velocidad, y disparar un handler al detectar Enter. Funciona igual en Windows, Mac, Linux, Android, iPad, y en cualquier navegador moderno. Cubre el 99% de los escáneres del mercado argentino (Honeywell, Zebra, Datalogic, genéricos chinos).

La alternativa (WebHID, WebSerial) se descarta por complejidad innecesaria: requiere permisos del usuario, no funciona en todos los navegadores, y no aporta nada que el modo HID no cubra.

### 2.2. Dos modos de código en paralelo: EAN normal y balanza

El sistema debe distinguir automáticamente entre dos formatos de código que se usan en paralelo en el mercado argentino.

El primero es el **EAN-13 / EAN-8 estándar**, impreso por fábrica en productos envasados (gaseosas, galletitas, shampoo) o generado internamente por el negocio para productos propios. Identifica al producto de forma única y la cantidad default al escanear es 1 unidad.

El segundo es el **código de balanza**, generado por balanzas de mostrador (Kretz, Systel, CAS, Gastronomy Scale) cuando el dueño pesa un producto y pega la etiqueta impresa. En el estándar argentino, estos códigos son EAN-13 que empiezan con el dígito `2` y tienen embebido en su interior el código interno del producto (el **PLU**) y el peso en gramos. Cuando el sistema detecta un código que empieza con `2` y tiene 13 dígitos, debe parsearlo, extraer el PLU (5 dígitos), extraer el peso en gramos (5 dígitos), y tratarlo como una venta por peso donde `subtotal = peso en kg × precio por kg`.

La decisión clave es implementar la **variante "código embebe peso"**, no la variante "código embebe precio". El motivo es que mantener el precio en el sistema (y no en la balanza) permite cambios de precio instantáneos sin reconfigurar la balanza, y es la variante estándar en almacenes y verdulerías argentinas. Si en el futuro un cliente necesita la otra variante (típica en carnicerías con balanza fiscal), se suma como modo adicional sin romper lo existente.

### 2.3. El sistema separa tres códigos distintos en cada producto

Cada producto pasa a tener potencialmente tres identificadores conviviendo:

- El **SKU interno** (`producto.codigo`), que ya existe. Es alfanumérico, elegido libremente por el negocio, sirve para el upsert en importaciones y para identificación humana. No cambia.
- El **código de barras** (`producto.codigo_barras`), nuevo. Es numérico, típicamente EAN-13, que se escanea directamente con la pistola. Puede ser de fábrica o generado internamente.
- El **PLU** (`producto.plu`), nuevo. Son hasta 5 dígitos, solo aplica a productos pesables, y es el identificador que se configura en la balanza para que cuando pese un producto imprima el código correspondiente. "PLU" (Price Look-Up) es el término estándar del mundo de las balanzas y es el que aparece en los manuales de Kretz, Systel, CAS, etc.

Los tres son ortogonales: un producto puede tener SKU y código de barras pero no PLU (gaseosa envasada), SKU y PLU pero no código de barras (producto que solo se vende por peso), o los tres (queso en horma que se vende tanto por unidad como por peso).

### 2.4. El POS reutiliza la infraestructura de facturación existente

La pantalla POS no inventa un nuevo motor de facturación. Construye items en memoria, y cuando el operador toca "COBRAR", llama al endpoint existente `POST /api/facturacion/emitir` con exactamente el mismo formato de body que usa la pantalla `/facturacion/nueva`. Esto garantiza que toda la lógica fiscal (determinación de tipo de factura, cálculo de IVA, descuento de stock, numeración atómica, generación de PDF, guard de módulos) sigue en un solo lugar, y el POS es simplemente una UI distinta sobre el mismo backend.

La única extensión al backend es agregar soporte para items pesables: items donde la `cantidad` puede ser un decimal en lugar de un entero.

### 2.5. La pantalla POS es un modo operativo, no un módulo nuevo de facturación

La facturación tradicional (`/facturacion/nueva`) sigue existiendo y sirve para casos B2B: emitir una factura A a una empresa con múltiples líneas, editar precios, aplicar descuentos complejos. El POS es la otra cara de la misma moneda, optimizada para venta rápida al mostrador. Ambas coexisten y usan el mismo motor. El tenant puede activar el POS sin perder la facturación tradicional.

### 2.6. Los productos pesables usan decimales en cantidad

Esta es la consecuencia más invasiva del bloque hacia el resto del sistema. Hoy toda la cadena de stock, movimientos y facturación asume que `cantidad` es un entero (se venden 3 unidades de algo, no 3.5 unidades). Con productos pesables, la cantidad pasa a ser un decimal (se venden 0.450 kg de manzanas). Esto obliga a revisar y posiblemente modificar: la tabla `movimiento.cantidad`, `comprobante_item.cantidad`, `pedido_item.cantidad`, el constraint `chk_cantidad_positiva`, la función SQL `registrar_movimiento`, y los formularios que muestran cantidades. La decisión es hacer esta migración de enteros a decimales de forma explícita y controlada al inicio del bloque, no parchearla después.

### 2.7. El feature flag protege la habilitación progresiva

El módulo `facturador_pos` depende de `facturador_simple` (no podés tener POS sin facturación básica). Se activa automáticamente en Plan Completo y se puede habilitar manualmente en Plan Base por pedido del tenant. El guard se aplica tanto en las páginas (redirect al home si el tenant no tiene el módulo) como en las API routes (403 si se intenta acceder sin el módulo), siguiendo el mismo patrón que usan los otros módulos del sistema.

---

## 3. Capa A — Gestión de códigos de barra en productos

Esta capa es toda la infraestructura que permite tener productos con códigos de barra en la DB, generarlos cuando no existen, validarlos, buscarlos, y finalmente imprimirlos en etiquetas. Es precondición de la capa B y tiene que estar 100% funcional antes de arrancar con el POS.

### 3.1. Cambios en el schema de base de datos

La tabla `producto` suma tres columnas nuevas: `codigo_barras` (numérico largo, nullable, que acepta hasta 14 dígitos para futura compatibilidad con ITF-14 de cajas multipack), `plu` (texto de hasta 5 caracteres, nullable, aplicable solo a pesables), y `es_pesable` (booleano con default false).

Se crean índices UNIQUE parciales: inicialmente un índice sobre `(tenant_id, codigo_barras)` cuando el código no es nulo y el producto está activo (una sola barra por tenant). **Migración posterior `047_producto_barcode_por_proveedor.sql`:** se reemplaza por dos índices — `(tenant_id, codigo_barras, proveedor_id)` si hay proveedor, y `(tenant_id, codigo_barras)` si `proveedor_id IS NULL` — de modo que la misma barra puede repetirse entre **distintos** proveedores. Sigue existiendo un índice UNIQUE parcial sobre `(tenant_id, plu)` con las mismas condiciones de activo. En todos los casos un producto dado de baja (`activo = false`) deja de participar en la unicidad, permitiendo reutilizar códigos tras la baja.

Se agregan dos CHECK constraints a nivel de base de datos para garantizar la consistencia del modelo: uno que impide tener PLU sin ser pesable, y otro que restringe a los productos pesables a usar las unidades `kg` o `gramo` del enum `unidad_medida` existente. Estos dos constraints cierran la puerta a estados inconsistentes sin depender de la capa aplicativa.

Se revisa el tipo de dato de la columna `cantidad` en las tablas `movimiento`, `comprobante_item` y `pedido_item`. Actualmente es `INTEGER`. Se migra a `NUMERIC(12, 3)` para soportar decimales con precisión hasta gramo. Los constraints `chk_cantidad_positiva` y `chk_item_positivo` se ajustan para seguir validando que la cantidad sea positiva, pero ahora con semántica decimal.

La función SQL `registrar_movimiento` también recibe un ajuste: sus parámetros `p_cantidad`, `v_stock_anterior` y `v_stock_posterior` pasan de `INTEGER` a `NUMERIC(12, 3)`. La lógica interna no cambia (sigue sumando/restando/asignando según el tipo de movimiento), solo la firma y los tipos de las variables internas.

Aparte de `producto` y los ajustes de cantidad, se agrega una columna `facturador_pos` (booleano, default false) a `modulo_config`. Se le agrega un CHECK constraint que obliga a tener `facturador_simple = true` si `facturador_pos = true`. La función `activar_plan` se actualiza para setear este nuevo flag en true cuando el plan es completo, y en false cuando es base.

Finalmente, se regeneran los tipos TypeScript desde el schema con el script `gen:types` que ya existe en el proyecto, para que el resto del código reciba las nuevas columnas con autocompletado y type safety.

### 3.2. Librería de generación y validación EAN-13

Se construye un módulo de librería en `src/lib/pos/` con funciones puras (sin I/O, sin estado, fácil de testear) que implementan el algoritmo estándar de EAN-13.

La primera función **calcula el dígito verificador** de los primeros 12 dígitos de un EAN-13, usando la fórmula GS1 de módulo 10 con pesos 1-3-1-3 alternados. Esto es pura matemática.

La segunda función **valida** si un string es un EAN-13 completo con check digit correcto. Retorna un booleano. Se usa tanto para validar códigos escaneados como para validar códigos que el usuario ingresa manualmente.

La tercera función **genera un EAN-13 interno** a partir de un secuencial numérico. Usa el prefijo `20` (del rango de uso interno GS1, que va de 20 a 29 y no se emite a fabricantes reales), rellena con ceros a la izquierda hasta completar 12 dígitos, y calcula el check digit para cerrar el EAN-13. El secuencial se obtiene de la base de datos haciendo MAX sobre los códigos existentes del tenant que empiezan con `20`, o se usa el ID incremental de un contador por tenant (la segunda opción es más robusta bajo concurrencia, aunque el MAX funciona si se maneja con un índice UNIQUE que previene colisiones).

Se hace una cuarta función, pequeña pero útil, que **formatea un EAN-13** para mostrarlo al usuario separado visualmente en grupos (por ejemplo `779 1234 567890` en lugar del chorro de 13 dígitos). No es funcional, es presentación.

Todo esto se testea con Vitest, con casos reales (códigos argentinos con prefijo 779, códigos internos con prefijo 20, códigos inválidos por longitud, por caracteres no numéricos, por check digit incorrecto), apuntando a cobertura total del módulo ya que es lógica crítica.

### 3.3. Parser del código escaneado

Se construye en `src/lib/pos/barcode-parser.ts` una función única y central: `parseBarcode(input: string)`. Recibe el string que vino del escáner y devuelve un objeto con tres campos: el `tipo` de código (enumerado: `ean_normal`, `balanza_peso`, `desconocido`), el `codigoLookup` (el string exacto que hay que buscar en la base de datos), y opcionalmente un `peso` en kilogramos si el tipo fue `balanza_peso`.

La lógica de decisión es: si el código es exactamente 13 dígitos numéricos y empieza con `2`, se trata como código de balanza. En ese caso extrae los dígitos 2 a 6 (5 dígitos) como PLU, los dígitos 7 a 11 (5 dígitos) como peso en gramos, y los divide por 1000 para obtener kg. Opcionalmente valida el check digit del EAN-13 resultante, aunque las balanzas siempre lo calculan bien.

Si no es código de balanza, pero es un string puramente numérico de entre 8 y 14 dígitos, se trata como EAN normal y el `codigoLookup` es el string tal cual.

Si no cae en ninguno de los dos, pero es un código “texto” admisible (SKU, código de barras alfanumérico impreso como texto, rotulación con medidas, etc.), también se devuelve como `ean_normal`. El `codigoLookup` es el string **recortado solo al inicio y al final** (`trim`), **conservando espacios y puntuación internos** tal como los envía el lector (por ejemplo `alam  F 16` con doble espacio, o `alam  F 16"` con comilla de pulgadas). Se permiten letras Unicode (`\p{L}`), dígitos, guiones, guiones bajos, espacios y comillas simples o dobles; cualquier otro símbolo (p. ej. `!@#`) sigue marcando `desconocido`.

Si está vacío o tiene caracteres inválidos, se marca como `desconocido`. El endpoint `buscar-por-barcode` responde 404; la pantalla del POS entonces hace búsqueda por texto (`/api/pos/buscar-productos`) con el mismo criterio de **solo trim en extremos** (sin colapsar espacios múltiples), para no desalinear el término respecto del valor guardado en catálogo.

Esta función es compartida entre frontend y backend: en el frontend se usa para feedback visual inmediato al operador (mostrarle "peso: 0.450 kg" mientras escribe), y en el backend se usa en el endpoint de búsqueda para decidir qué columna de la DB consultar.

### 3.4. APIs de gestión de códigos

Se crean o extienden tres endpoints en `src/app/api/`.

El primero, `POST /api/productos/[id]/codigo-barras`, asigna o actualiza el código de barras de un producto existente. Recibe en el body el string del código. Hace las siguientes validaciones en orden: que el usuario esté autenticado, que tenga el módulo `facturador_pos` habilitado, que no sea rol `visor`, que el producto exista y pertenezca al tenant del usuario. Después valida el código: si pasa check digit EAN-13, perfecto; si no, se deja pasar pero se devuelve un warning (`{ warning: "..." }`) junto con la respuesta exitosa, para que el frontend pueda mostrárselo al usuario sin bloquear. Finalmente consulta si el código ya está asignado a otro producto activo del tenant **en el mismo “bucket” de proveedor** (mismo `proveedor_id`, incluido ambos sin proveedor); si sí, retorna 409 Conflict con el ID y nombre del producto que lo tiene para que el frontend pueda linkear a ese producto.

El segundo, `POST /api/productos/[id]/generar-codigo`, genera automáticamente un EAN-13 interno para un producto. Internamente: obtiene el siguiente secuencial del tenant (vía query a la DB o vía un contador dedicado), construye el EAN-13 con prefijo `20`, lo guarda en el producto, y lo retorna. Si el producto ya tenía un código de barras, el comportamiento es rechazar con 400 para forzar que el usuario confirme el reemplazo explícitamente desde el frontend (mostrando un diálogo "este producto ya tiene código, ¿querés reemplazarlo?").

El tercero, `PATCH /api/productos/[id]`, que ya existe, se extiende para aceptar los nuevos campos `codigo_barras`, `plu` y `es_pesable`. Aplica las mismas validaciones de duplicado y checa que si `es_pesable` cambia a true, la unidad del producto sea kg o gramo (si no lo es, fuerza el cambio o devuelve error). Si `es_pesable` cambia a false, se nulifica el `plu` automáticamente.

Un cuarto endpoint, de lookup para el POS, se define en la capa B porque se consume desde ahí: `GET /api/productos/buscar-por-barcode?codigo=XXX`.

### 3.5. Extensiones al formulario de alta/edición de productos

La pantalla `/productos/nuevo` y `/productos/[id]` ya existe. Se le suma una sección nueva titulada "Códigos y escaneo" con los siguientes elementos.

Un campo de texto para el **SKU interno** (ya existía, no cambia nada).

Un campo de texto para el **código de barras**, con un input estándar que acepta el foco y el escaneo directo (la pistola "tipea" ahí). Al lado del input, un botón "Generar" que llama al endpoint de generación automática y llena el campo con el EAN-13 resultante. Un tercer elemento visual: un indicador de validación en tiempo real que cambia de color según el estado (vacío/gris, válido/verde check, inválido con warning/amarillo, duplicado/rojo con link al producto que lo tiene). El indicador se actualiza al hacer blur del input (no en cada keystroke, para no saturar de requests).

Un checkbox para **"Es producto pesable (balanza)"**. Al activarlo, si la unidad del producto no era kg ni gramo, se muestra un aviso y se cambia automáticamente a kg. Al desactivarlo, si había un PLU cargado, se muestra confirmación de que se va a nulificar.

Un campo de texto para el **PLU** (con tooltip explicativo: "Número de 4-5 dígitos que usás en tu balanza para identificar este producto"), visible solo si el checkbox anterior está activo. Acepta hasta 5 dígitos numéricos. Se valida en tiempo real (inline, sin llamada a la API) que sean dígitos numéricos, y al blur se valida contra duplicados con una llamada al endpoint.

Adicionalmente, en la pantalla de listado de productos (`/productos`), se agregan dos cosas útiles: el campo de búsqueda existente pasa a buscar también por `codigo_barras` (además de por nombre y SKU), y la tabla suma una columna opcional "Código de barras" que se puede mostrar/ocultar según preferencia del usuario.

### 3.6. Pantalla de impresión de etiquetas

Se crea una nueva ruta `/productos/[id]/etiquetas` accesible desde el detalle del producto mediante un botón "Imprimir etiquetas". Esta pantalla permite al usuario imprimir una o muchas copias de la etiqueta física del producto.

El layout de la pantalla tiene tres zonas. Arriba, un selector de cantidad de copias (por ejemplo 1, 5, 10, 20, o custom). Al medio, un preview visual de cómo se va a ver la etiqueta impresa, que incluye: el nombre del producto (truncado si es muy largo), el precio de venta formateado, el código de barras renderizado como SVG usando la librería `bwip-js`, y opcionalmente el SKU o información adicional. Abajo, dos botones: "Imprimir" (que abre el diálogo nativo de impresión del navegador con la grilla repetida de etiquetas) y "Descargar PDF" (opcional, útil si el usuario prefiere generar el PDF y mandarlo después a imprimir).

La grilla de impresión usa CSS de página (page-break, print media queries) para que al imprimir se distribuyan múltiples etiquetas por hoja según el tamaño seleccionado. Los tamaños de etiqueta estándar que soporta el sistema inicialmente son: 50x30mm (común para productos chicos), 80x40mm (común para góndolas), y A4 con grilla de etiquetas (para lotes grandes en hojas adhesivas).

La librería elegida para renderizar el código es `bwip-js`, que pesa ~150kb, funciona server y client side, y soporta EAN-13, EAN-8, Code 128, QR, y decenas de otros. Inicialmente solo se usa EAN-13 y EAN-8. En el render, bajo el código de barras se imprime también el número humano-legible para fallback (si la pistola no puede leerlo por cualquier razón, se puede tipear).

Una versión más avanzada, opcional pero recomendada, es una pantalla de **impresión masiva**: `/productos/etiquetas-lote` donde el usuario selecciona múltiples productos (checklist o filtros), define copias por producto, y genera un PDF único con todas las etiquetas distribuidas en hojas A4. Útil cuando cargás una lista nueva de proveedor y tenés 100 productos sin etiqueta.

### 3.7. Utilidad para rotulación masiva

Independiente de la pantalla de etiquetas individuales, se agrega una **acción batch en el listado de productos**: "Imprimir etiquetas de los seleccionados", que abre un modal con los productos elegidos y genera el PDF con todas las etiquetas. Esto se usa principalmente en el día 1 cuando el tenant necesita imprimir etiquetas de todo su stock.

---

## 4. Capa B — Terminal POS con escáner

Esta capa es la pantalla de caja registradora propiamente dicha. Consume toda la infraestructura de la Capa A y el motor de facturación existente, agregando solo la UI optimizada para escaneo rápido.

### 4.1. Componente base de captura del escáner

El corazón de toda la capa B es un componente reutilizable `<BarcodeInput />` que se construye una vez y se usa en múltiples lugares (el POS principal, modales internos, el form de productos si se quiere).

Este componente es un input HTML común con algunas características adicionales. Mantiene el foco automáticamente: si el usuario hace click en otro elemento de la página y pierde foco, un intervalo cada 500ms lo reenfoca automáticamente (pausable con una prop). Detecta escaneo por velocidad: mantiene un timestamp del último keydown, y si los caracteres llegan con menos de 30ms entre uno y otro, flag interno de "está escaneando". Al recibir Enter (o Tab, configurable), toma el buffer completo, aplica `trim` solo en extremos y lo pasa al callback `onScan` (conservando espacios internos), y se limpia para el siguiente escaneo.

El componente expone props para: qué hacer al escanear (`onScan`), si debe tener autofoco, si debe estar deshabilitado temporalmente (por ejemplo mientras se procesa la última lectura), y un placeholder custom.

Internamente usa un ref al DOM node para gestionar el foco imperativamente y un buffer que no está atado al state de React (para evitar rerenders por cada keystroke que ralentizarían la UI).

### 4.2. API de búsqueda por código de barras

Se implementa `GET /api/productos/buscar-por-barcode?codigo=XXX`. Recibe el código tal como vino del escáner, lo pasa por `parseBarcode`, y según el tipo resultante hace la query correspondiente:

Para `ean_normal`, busca en `producto` donde `codigo_barras = codigoLookup` AND `tenant_id = X` AND `activo = true`, opcionalmente filtrada por `proveedor_id` si el query string lo envía (filtro del POS). Si hay **más de un** producto candidato y **no** se pasó `proveedor_id`, responde **409** con `ambiguous: true` y una lista breve de productos para que el operador aplique el filtro de proveedor y vuelva a escanear. Si no encuentra por barra, intenta un segundo lookup por `codigo = codigoLookup` (SKU interno), porque si el operador escaneó una etiqueta con SKU impreso, también debe funcionar.

Para `balanza_peso`, busca en `producto` donde `plu = codigoLookup` AND `tenant_id = X` AND `activo = true` AND `es_pesable = true`.

Para `desconocido`, retorna directamente 404 con un mensaje claro.

La respuesta exitosa incluye: los datos completos del producto, el `tipo` de código detectado, y si aplica el `peso` parseado en kg. La respuesta 404 incluye el código que se intentó buscar. En la pantalla del POS, un 404 dispara además la búsqueda por texto (`/api/pos/buscar-productos`) con el mismo string (solo `trim` en extremos), además del mensaje de error si no hay coincidencias.

Guard de módulo `facturador_pos`. No tiene guard de rol restrictivo (un visor también puede escanear para ver precios, pero no puede emitir).

### 4.3. API de emisión extendida (ajustes menores)

El endpoint existente `POST /api/facturacion/emitir` recibe ajustes mínimos para soportar el flujo POS.

Primero, acepta cantidades decimales en los items (derivado del cambio de schema de `cantidad` a NUMERIC). Esto ya se resuelve a nivel de tipado al regenerar los tipos de Supabase.

Segundo, acepta un nuevo tipo de comprobante: `ticket`. Si el comercio no es responsable inscripto o si el cliente es Consumidor Final y no pide factura, el POS emite un "ticket" simple sin letra, con su propio número correlativo. Esto requiere extender el ENUM `tipo_comprobante` con el valor `ticket` y ajustar la función `determinarTipoFactura` para que, dado un flag "quiere ticket" del frontend, devuelva `ticket` en lugar de `factura_b/c`.

Tercero, acepta un campo opcional `metodo_pago` por comprobante (efectivo, tarjeta débito, tarjeta crédito, transferencia, mixto). Esto requiere una migración menor que agrega la columna `metodo_pago` a `comprobante`. Si el método es "mixto", el frontend envía un array con montos parciales por método. Esto se usa para reportes y para imprimir en el ticket, no afecta el cálculo de totales.

### 4.4. La pantalla POS `/facturacion/pos`

Esta es la pantalla visible, optimizada para una caja registradora. Layout de pantalla completa, sin sidebar, con tipografía grande y botones grandes pensados para ser operados con teclado y escáner (sin depender del mouse).

Estructura visual de arriba a abajo:

**Barra superior**: nombre del tenant a la izquierda, selector de cliente (default "Consumidor Final") con botón "Cambiar cliente", selector de tipo de comprobante (Ticket / Factura A / B / C, pre-seleccionado según condición del cliente), y a la derecha indicadores como fecha/hora y nombre del usuario logueado.

**Zona de escaneo** (banda destacada): un `<BarcodeInput />` grande y centrado, con el foco permanente, mostrando placeholder tipo "Apuntá la pistola al producto o tipeá el código y Enter". Al costado, indicador visual del último producto escaneado (para feedback visual) y un botón "Buscar" alternativo que abre un buscador textual por si no hay código de barras.

**Cuerpo principal dividido en dos columnas**:

Columna izquierda, ancha (~65%), la **lista de items acumulados**. Cada línea muestra: cantidad (editable inline clickeando), unidad si aplica (kg para pesables), nombre del producto truncado, precio unitario (editable con permisos), subtotal de la línea, y un botón X para eliminar la línea. La línea del último item escaneado se resalta brevemente con una animación (pulsar un color suave) para confirmar visualmente que se agregó. Si el carrito está vacío, se muestra un placeholder grande "Escaneá el primer producto para empezar".

Columna derecha, más angosta (~35%), el **resumen y acciones**. Muestra en tipografía grande: subtotal, IVA si aplica (discriminado para factura A), total. Debajo, un campo "Descuento" (porcentual o monto fijo) aplicable al comprobante completo (opcional, según rol). Debajo, un botón gigante "COBRAR (F2)" que abre el modal de pago. Botones secundarios: "Cancelar venta (F8)" que limpia el carrito con confirmación, "Cambiar cliente (F4)", "Modo teclado" (para cuando no hay pistola y todo se tipea).

**Barra inferior**: contador de items, nombre del cajero, número de terminal/caja (útil en comercios con más de una), y el link al listado de comprobantes emitidos hoy.

Comportamiento clave al escanear:

1. El operador dispara la pistola contra un producto.
2. El `<BarcodeInput />` captura y llama `onScan(codigo)`.
3. El handler del POS llama al endpoint de búsqueda.
4. Si el producto existe y no es pesable: se incrementa en 1 la cantidad si ya estaba en el carrito, o se agrega nueva línea con cantidad 1. Beep corto de confirmación (sonido opcional).
5. Si el producto existe y es pesable, y el código incluía peso (balanza): se agrega línea con la cantidad = peso en kg. Se resalta el peso en la UI.
6. Si el producto existe y es pesable pero el código no incluía peso (pasó un EAN interno sin pesar antes): se abre modal "Ingresar peso manualmente" con un input numérico grande, y al confirmar se agrega la línea.
7. Si el producto no existe: toast rojo prominente "Producto no encontrado: [código]", beep de error, y el foco vuelve al input de escaneo.
8. Si hay error de red/500: toast de error genérico, el carrito queda intacto.

### 4.5. Modal de cobro

Al tocar "COBRAR" (o F2), se abre un modal overlay con los pasos finales de la venta.

Primer paso, confirmación del tipo de comprobante. Muestra el tipo detectado (ticket por defecto, o factura según cliente) y permite cambiarlo. Si se elige factura, se valida que el cliente tenga CUIT/DNI cargado; si no, obliga a completarlo en ese momento con un sub-formulario mini (nombre + CUIT/DNI).

Segundo paso, método de pago. Botones grandes para: Efectivo, Débito, Crédito, Transferencia, Mixto. Si es efectivo, se muestra un input "Recibido" donde el cajero tipea cuánto le dio el cliente y el sistema calcula el vuelto en tiempo real. Si es mixto, formulario de distribución entre métodos.

Tercer paso, confirmación y emisión. Botón "Confirmar cobro" que llama al endpoint `/api/facturacion/emitir` con todo el payload armado. Mientras procesa, spinner. Al recibir respuesta exitosa: pantalla verde de éxito con el número de comprobante, vuelto si aplica, y dos opciones: "Nueva venta" (limpia todo y vuelve al POS) e "Imprimir ticket" (dispara la impresión). Al recibir error: pantalla roja con el error descriptivo, manteniendo el carrito para reintentar.

### 4.6. Impresión del ticket

El ticket se imprime en papel de 80mm o 57mm (los dos anchos estándar de impresoras térmicas de POS). El sistema soporta dos modos de impresión, seleccionables en `/configuracion`:

**Modo navegador**: genera un HTML pensado para impresora térmica (tipografía monoespaciada, ancho fijo de 80mm, sin gráficos pesados), abre una ventana oculta con `window.print()`, y el navegador imprime a la impresora por defecto del sistema operativo. Es el modo universal y más simple. El usuario configura su impresora como default en Windows/Mac y listo.

**Modo PDF descarga**: genera un PDF optimizado para ancho 80mm y lo descarga/imprime. Útil cuando no hay impresora térmica y se usa una impresora A4 partida.

El contenido del ticket: cabecera con razón social, CUIT, domicilio del tenant; tipo y número de comprobante formateado; fecha y hora; tabla de items con nombre, cantidad y precio; totales; método de pago; pie con leyenda fiscal correspondiente; y con **ARCA** activo y CAE, el **QR de constatación AFIP** (URL en `qr_url` desde la emisión) + CAE + vencimiento (`docs/arca.md`, `docs/facturacion.md`).

Hay una decisión pendiente de arquitectura: si el PDF del ticket se genera también en el backend (como pasa con los comprobantes tradicionales) y se sube a Storage, o si se genera solo en el frontend para impresión inmediata y el backend solo genera el PDF "oficial" en formato A4 para archivo. La recomendación es hacer ambas cosas: el backend genera el PDF A4 estándar como siempre (y lo sube a Storage), y el frontend adicionalmente genera una versión HTML/PDF de 80mm para impresión térmica inmediata. Así queda el archivo fiscal correcto en Storage y el operador tiene su ticket impreso al instante.

### 4.7. Atajos de teclado y ergonomía

El POS se diseña para ser operado sin mouse. Los atajos de teclado son:

- **Enter** (en el input de escaneo): confirma el código escaneado/tipeado.
- **F2**: cobrar / abrir modal de pago.
- **F4**: cambiar cliente (abre selector modal).
- **F8**: cancelar venta actual (pide confirmación).
- **Escape**: cierra cualquier modal abierto.
- **+/-** en una línea seleccionada (navegable con flechas): ajusta cantidad.
- **Del**: elimina la línea seleccionada.
- **F12**: cambiar tipo de comprobante.

Estos atajos se listan en un modal de ayuda accesible con F1 o `?`.

### 4.8. Casos borde y manejo de errores

Hay varios casos borde que el POS tiene que manejar explícitamente para ser robusto en producción.

**Producto sin stock**: al escanear, el sistema puede comportarse de dos maneras según preferencia del tenant (configurable en `/configuracion`): o bloquea la venta con error "No hay stock disponible", o permite la venta pero marca la línea con warning visual. En ambos casos, el backend de emisión valida al final y devuelve error si no hay stock (cuando el tipo de comprobante no sea presupuesto/remito).

**Producto inactivo**: si el código está asignado a un producto con `activo = false`, el endpoint devuelve 404 como si no existiera.

**Código duplicado en la DB**: no debería pasar porque el índice UNIQUE lo previene, pero si por alguna razón pasa (por ejemplo si se desactivó el índice durante una migración), el endpoint devuelve error 500 con log explícito.

**Desconexión de red**: si al procesar un escaneo se pierde la conexión, el toast muestra "Sin conexión, reintentando..." y un botón "Reintentar". El carrito queda intacto. Al emitir sin conexión, se bloquea la emisión con un mensaje claro (no se hace cola offline en la v6.0, eso queda para una versión posterior).

**Doble disparo del escáner**: si el operador aprieta el gatillo dos veces seguidas por error, el debounce del input natural evita duplicados. Adicionalmente, si llegan dos onScan del mismo código en menos de 300ms, se ignora el segundo.

**Pesable sin pesar**: si alguien escanea un producto pesable sin código de balanza (por ejemplo un SKU manual), se abre el modal de peso manual como se describió arriba.

**Corte de luz / browser crash**: el carrito en curso se persiste automáticamente en `localStorage` cada vez que cambia (debounced cada 500ms). Al recargar la pantalla, si detecta un carrito previo sin emitir, pregunta "Hay una venta en curso sin emitir, ¿restaurar?".

### 4.9. Múltiples cajas / terminales

Para comercios con más de una caja, el sistema se diseña para soportarlo desde el inicio, aunque la implementación completa puede quedar como iteración posterior.

La idea: cada caja/terminal se identifica con un `caja_id` (o un user-agent + IP). El número de ticket se emite secuencialmente por terminal para evitar colisiones. Los comprobantes emitidos quedan vinculados a la terminal en un campo nuevo `comprobante.caja_id` (opcional). Esto permite reportes por cajero/caja en el futuro.

En la v6.0 inicial esto puede simplificarse: una única caja implícita, `caja_id` queda nullable y reservado para iteraciones posteriores.

---

## 5. Integraciones con otros módulos

El bloque POS toca varias áreas del sistema existente. Vale la pena mapear explícitamente qué cambia en cada una.

**Módulo Stock**: los productos ahora pueden ser pesables. La UI del listado (`/productos`) y el detalle agregan la info de los nuevos códigos. La búsqueda ahora incluye `codigo_barras`. Los movimientos aceptan cantidades decimales.

**Módulo Facturación**: el motor existente no cambia conceptualmente. Se agrega el tipo `ticket` al ENUM, se agrega `metodo_pago` al comprobante, y se acepta cantidad decimal en los items. El PDF de comprobante A4 sigue funcionando igual para los comprobantes emitidos desde POS.

**Módulo Importador**: cuando se importan productos desde Excel, el importador ahora reconoce una columna adicional opcional "Código de barras" en el mapeo, que se guarda directamente en `producto.codigo_barras`. Esto permite que un tenant con miles de productos no tenga que asignar códigos uno por uno manualmente.

**Módulo Analizador (v5.0)**: no se toca. Las listas de precios siguen funcionando igual.

**Módulo Pedidos**: los items de pedidos también aceptan cantidades decimales ahora (por el cambio de `cantidad` a NUMERIC en `pedido_item`). Opcionalmente, en el detalle de un pedido, se puede agregar un botón "Enviar al POS" que carga todos los items del pedido en el carrito POS para agilizar el cobro. Esta integración es deseable pero opcional para la v6.0.

**Módulo ARCA (v4.0, pendiente)**: cuando se implemente ARCA, el flujo POS automáticamente emitirá facturas con CAE (porque usa el mismo endpoint de emisión). No requiere código específico del lado POS, solo que ARCA esté habilitado en el tenant.

**Módulo IA de precios (v3.0)**: no se toca.

**Módulo Configuración**: se agregan opciones nuevas en `/configuracion`:
- Sección "POS": activar/desactivar sonidos, preferencia de impresora (término vs A4), comportamiento ante falta de stock (bloquear vs permitir con warning), ancho de ticket (80mm vs 57mm).
- Sección "Plan / Módulos": se suma el flag `facturador_pos` al listado de módulos activables.

---

## 6. Testing

Sección importante porque la lógica fiscal y de cálculo no puede fallar en producción.

**Unit tests** (Vitest, lógica pura):
- Todos los casos de `calcularCheckDigitEAN13`, `validarEAN13`, `generarEAN13Interno`.
- Todos los casos de `parseBarcode`: EAN normales, EAN-8, códigos de balanza reales, SKU alfanuméricos, inválidos, vacíos.
- Formateo de cantidad decimal para pesables.
- Cálculo de vuelto y de mixto en el modal de pago.

**Integration tests** (con Supabase client real):
- Asignar código de barras a un producto.
- Intentar asignar un código duplicado y recibir 409.
- Generar código interno automático y verificar que es EAN-13 válido.
- Escanear producto normal y que se agregue al carrito.
- Escanear producto de balanza con peso y que se agregue con cantidad decimal correcta.
- Escanear producto inexistente y recibir 404.
- Emitir un ticket desde el POS y verificar que se creó correctamente con todos los movimientos de stock y el PDF.
- Verificar aislamiento entre tenants: escanear con un tenant un código de otro tenant debe devolver 404.

**E2E tests** (opcional, Playwright):
- Flujo completo: abrir POS → escanear 3 productos → cambiar cliente → cobrar con efectivo con vuelto → verificar ticket impreso.
- Flujo de error: escanear producto sin stock → verificar comportamiento según configuración.

**Tests manuales con pistola real**: esto no se automatiza, pero hay que hacerlo. Probar con al menos dos modelos de pistola distintos (una barata USB, una Zebra Bluetooth), en distintos navegadores (Chrome, Firefox, Safari), en distintos SO (Windows, Mac). Verificar que el sufijo Enter está configurado y funciona.

---

## 7. Configuración de pistola y hardware

Aunque no es código que escribamos, es parte del plan porque el cliente se va a cruzar con esto.

En la documentación del módulo (sección `/configuracion/pos` con link externo a una guía) se incluye:

- Cómo configurar la pistola para que use Enter como sufijo (cada marca tiene un código maestro que se escanea una vez).
- Cómo configurar idioma de teclado (un error común: la pistola configurada en inglés y el SO en español que cambia los `/` y `-`).
- Impresoras recomendadas (Epson TM-T20, Xprinter, modelos comunes).
- Cómo configurar la impresora por defecto en Windows/Mac.
- Cómo conectar una pistola Bluetooth a un Android o iPad.

Esta documentación vive como página dentro del producto (`/ayuda/pos`) y como archivo markdown en el repo para mantenimiento.

---

## 8. Orden de implementación sugerido

Después de ver todo el alcance, este es el orden natural de construcción que minimiza dependencias y permite entregar valor progresivamente.

**Fase 1 — Fundacional (Capa A parte 1)**: migración del schema (columnas nuevas en `producto`, flag `facturador_pos`, migración de cantidad a decimal), regenerar tipos, librería de generación/validación EAN-13, librería del parser. Todo esto se puede mergear de a pedazos sin impactar al usuario final.

**Fase 2 — Productos (Capa A parte 2)**: APIs de asignación y generación de código, extensión del formulario de producto con la sección nueva, extensión de búsqueda por código de barras en el listado. En este punto el tenant ya puede asignar códigos a sus productos.

**Fase 3 — Etiquetas (Capa A parte 3)**: pantalla de impresión individual y masiva, librería `bwip-js` integrada. En este punto el tenant ya puede imprimir etiquetas de sus productos. La Capa A queda 100% funcional.

**Fase 4 — Base del POS (Capa B parte 1)**: componente `<BarcodeInput />`, endpoint de búsqueda por código, extensiones al endpoint de emisión (tipo ticket, método de pago, cantidad decimal). Sin UI todavía, pero con toda la plomería lista.

**Fase 5 — UI del POS (Capa B parte 2)**: pantalla `/facturacion/pos` completa con captura de escaneo, carrito, totales, modal de cobro, impresión. En este punto el POS ya funciona end-to-end.

**Fase 6 — Refinamiento**: atajos de teclado, manejo de casos borde, persistencia en localStorage, configuración en `/configuracion/pos`, tests E2E, documentación de usuario, prueba con hardware real.

**Fase 7 — Integraciones opcionales** (pueden quedar para v6.1): mejoras al importador para aceptar columna de código de barras, botón "Enviar al POS" desde pedidos, reportes de ventas por cajero/caja.

---

## 9. Riesgos y puntos abiertos

Hay algunas decisiones que vale la pena discutir antes de arrancar para no cambiarlas a mitad de camino.

**Cambio de cantidad a decimal**: es la modificación más invasiva del bloque porque toca tres tablas core. Es necesaria para soportar pesables. Alternativa: mantener `cantidad` como INTEGER y agregar un campo `peso NUMERIC(10,3)` en los items que son pesables. Esta alternativa es menos invasiva pero agrega complejidad en toda la UI de facturación (tener que preguntar "es pesable o no" en cada lugar). La recomendación es migrar a NUMERIC, hacerlo bien una vez.

**Tipo de comprobante "ticket"**: algunos sistemas usan `factura_b` para tickets al consumidor final y no distinguen. El argumento para crear un tipo `ticket` aparte es que los tickets no son fiscales (no van a ARCA), tienen numeración propia, y su PDF es distinto (80mm térmico vs A4). El argumento en contra es que agrega complejidad al ENUM. Recomendación: crear el tipo `ticket` aparte.

**Impresión térmica vía navegador**: no es 100% confiable en todos los setups. Windows con impresora configurada y Chrome funciona bien. Mac es un poco más inconsistente. La alternativa robusta es integrar con un agente local (tipo `qz-tray`) que se comunica por WebSocket y maneja la impresora nativamente. Recomendación: empezar con `window.print()` porque es el 80% de los casos, y dejar documentado que si no funciona se puede sumar qz-tray como opción pro.

**Múltiples cajas simultáneas**: si dos cajeros están escaneando al mismo tiempo en dos terminales distintas del mismo tenant, la numeración de tickets debe ser atómica (ya está resuelto con `siguiente_numero_comprobante` y el índice UNIQUE), pero hay que verificar que no haya race conditions al escanear el mismo producto y que el stock se descuente correctamente (resuelto por `registrar_movimiento` con `FOR UPDATE`). No hay riesgo real, pero conviene dejar explícito en los tests.

**Balanzas que usan variante "precio embebido"**: si después de lanzar aparece un tenant con balanza que imprime códigos con precio en lugar de peso, habría que extender el parser para detectar y manejar ambas variantes. El diseño lo permite (es agregar una función al parser), pero conviene esperar a tener el caso real antes de implementarlo.

---

## 10. Mapeo Plan → Tickets

Referencia cruzada entre las secciones de este plan y los tickets de implementación en `TICKETS.md`.

| Sección del plan | Tickets |
|---|---|
| 3.1 Cambios en schema de DB | V60-POS-001, V60-POS-002, V60-POS-003, V60-POS-004, V60-POS-005, V60-POS-015 |
| 3.2 Librería EAN-13 | V60-POS-006 |
| 3.3 Parser del código escaneado | V60-POS-007 |
| 3.4 APIs de gestión de códigos | V60-POS-008, V60-POS-009, V60-POS-010 |
| 3.5 Extensiones al formulario de producto | V60-POS-011, V60-POS-012 |
| 3.6 Pantalla de impresión de etiquetas | V60-POS-013 |
| 3.7 Rotulación masiva | V60-POS-014 |
| 4.1 Componente BarcodeInput | V60-POS-016 |
| 4.2 API de búsqueda por código | V60-POS-017 |
| 4.3 API de emisión extendida | V60-POS-018 |
| 4.4 Pantalla POS | V60-POS-019, V60-POS-020 |
| 4.5 Modal de cobro | V60-POS-021 |
| 4.6 Impresión del ticket | V60-POS-022 |
| 4.7 Atajos de teclado | V60-POS-023 |
| 4.8 Casos borde | V60-POS-024, V60-POS-025 |
| 5. Integraciones: Importador | V60-POS-027 |
| 5. Integraciones: Pedidos | V60-POS-028 |
| 5. Integraciones: Configuración | V60-POS-026 |
| 6. Testing | V60-POS-029 |

**Total:** 29 tickets, 119 story points, 7 sprints estimados.

**Documentación actualizada:**
- `TICKETS.md` — Bloque F completo con 29 tickets
- `activeContext.md` — Contexto activo actualizado a v6.0
- `arquitectura.md` — Estructura de carpetas y roadmap con POS
- `base-de-datos.md` — Nuevas columnas, ENUMs, constraints y migraciones 023-026
- `modulos.md` — Módulo `facturador_pos` con constraints, defaults, guards y sidebar