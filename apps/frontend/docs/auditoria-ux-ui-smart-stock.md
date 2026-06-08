# Auditoría UX/UI Smart Stock — Hallazgos y soluciones

Documento de trabajo que consolida el informe de experiencia de usuario e interfaz sobre **Smart Stock**. Las fuentes originales son PDFs del proyecto Sincronia Marketing:

- PDF (introducción y marco): `C:\Users\Fede\Desktop\GinkGo Devs\Proyectos\proyecto2\smartstock\docs\Auditoría UX_UI Smart Stock - Hallazgos y Soluciones.pdf`


---

## 1. Introducción y objetivo del informe

**Proyecto:** Optimización del sistema Smart Stock  
**Estado:** En producción (post-MVP)

**Objetivo del documento:** Analizar usabilidad y diseño de interfaz para identificar fricciones operativas, reducir la carga cognitiva del administrador y proponer mejoras que conviertan el sistema en una herramienta intuitiva, eficiente y centrada en el usuario.

### Material de análisis

- **Capturas de interfaz real:** Dashboard, Inventario, Importación, Administración (proveedores/clientes), Facturación (comprobantes, pedidos, caja), Reportes.
- **Flujos de usuario:** Cierre de caja, carga de facturas de compra, gestión de estados de pedidos.
- **Documentación de reglas de negocio:** Configuraciones y su impacto en stock y fiscalidad.

### Metodologías aplicadas

1. **Evaluación heurística de Nielsen** — Visibilidad del estado del sistema, consistencia, prevención de errores, correspondencia con el mundo real.
2. **Análisis de carga cognitiva** — Esfuerzo mental en pantallas críticas (p. ej. Reportes y Configuración).
3. **Arquitectura de información** — Jerarquía y terminología; sustituir “lenguaje de programación” por lenguaje orientado al negocio.

### Herramientas mencionadas en el informe

- Análisis técnico de UI/UX y flujos de navegación.
- Benchmarking frente a estándares en POS y CRM.
- IA propositiva (ej.: lector de facturas, automatización administrativa).

### Nota del auditor (síntesis)

El análisis no persigue solo estética: busca que Smart Stock sea una **ventaja competitiva** para quien administra, con decisiones basadas en datos claros y menos tiempo en tareas manuales repetitivas.

**Diagnóstico central:** el producto tiene mucha “inteligencia” (IA, WhatsApp, workflows complejos) pero baja **empatía visual**.

---

## 2. Los tres pilares de mejora

| Pilar | Qué implica |
|--------|----------------|
| **1. Limpieza visual** | Eliminar ceros innecesarios, textos técnicos (UUIDs, slugs) y agrupar opciones según su impacto en el negocio. |
| **2. Prevención de errores** | Que el sistema use IA para rellenar campos y valide datos fiscales (CUIT) antes de que el error sea irreversible. |
| **3. Lenguaje humano** | Renombrar secciones para administradores sin manual (ej.: “Tickets” → “Caja”; “Resolver ARCA” → “Errores de factura”). |

---

## 3. Hallazgos por pantalla (parte compartida)

### 3.1 Dashboard (vista general)

| Problema detectado | Fundamentación teórica | Solución propuesta | Impacto en el usuario |
|--------------------|------------------------|--------------------|------------------------|
| **Inversión de la pirámide operativa:** los accesos rápidos (acciones) quedan *debajo* de las métricas (lectura). | **Ley de Fitts:** el tiempo para alcanzar un objetivo depende de distancia y tamaño; al estar lejos del inicio se pierde eficiencia. | Mover **accesos rápidos** arriba (*above the fold*). Diseño tipo **action cards** para las acciones principales. | **Alta productividad:** menos escaneo visual; acceso directo a venta o caja. |
| **Baja densidad de información:** tarjetas de métricas demasiado grandes para el dato que muestran. | **Gestalt:** el espacio vacío excesivo desvincula el dato de su etiqueta. | Rediseñar métricas en formato **horizontal** o tarjetas **compactas**; grilla de **4 columnas en una fila**. | **Claridad visual:** más información visible sin scroll; menor carga cognitiva. |
| **Alertas despriorizadas:** la sección de alertas queda al final del flujo visual. | **Carga cognitiva:** el sistema no apoya la memoria de trabajo para prevenir errores. | Panel de **estado crítico** en lateral superior derecho o **banner** de notificación persistente. | **Prevención de errores:** avisos en tiempo real ante riesgos de stock o caja descuadrada. |
| **Copywriting sin pulir:** placeholders y saludos genéricos. | **Nielsen #4:** el lenguaje debe ser profesional para generar **confianza** (*user trust*). | Sustituir “Bienvenido” por un **resumen de estado dinámico** (ej.: “Caja abierta: $12.500”). Corregir errores de tipeo. | **Credibilidad:** sensación de herramienta robusta y profesional. |
| **Ambigüedad en componentes de acción:** los botones de acceso rápido parecen **etiquetas (tags)**. | **Affordance:** el elemento debe comunicar cómo debe usarse. | Estilos claros de **botón primario/secundario**; elevación (*shadows*) y **estados hover** evidentes. | **Menos incertidumbre:** el usuario identifica qué dispara una acción. |

---

## 4. Sitemap (arquitectura de información)

> El Sitemap es la representación jerárquica de la estructura de una plataforma. Es el esqueleto del software que define cómo se agrupan las secciones y cómo se conectan entre sí. En UX, el Sitemap no es solo una lista de páginas, sino una herramienta de Arquitectura de Información que garantiza que el usuario encuentre lo que busca en la menor cantidad de clicks posible.

En esta auditoría, el Sitemap se ha rediseñado bajo los siguientes principios:

- **Jerarquía por relevancia:** Las funciones de uso diario (Caja e Inventario) se sitúan en los niveles superiores, mientras que las configuraciones técnicas se desplazan a niveles secundarios.
- **Eliminación de silos:** Se agrupan funciones que el usuario percibe como una sola tarea (por ejemplo, unir "Tickets" con "Caja"), evitando que la información esté fragmentada.
- **Lenguaje orientado al dominio:** Se sustituyen tecnicismos de programación por términos que pertenecen al mundo real del comercio y la administración.

En resumen: El Sitemap asegura que la navegación sea predecible. Si la estructura es lógica, el usuario no tiene que "aprender" a usar el sistema; simplemente lo deduce.

### Nivel 1: El tablero de control (visibilidad directa)

Es lo primero que ves. Está diseñado para dar respuestas, no para mostrar tablas vacías.

- **1.0 Dashboard ejecutivo**
  - Métricas de ventas (Hoy vs. Ayer).
  - Alertas de stock crítico (lo que falta comprar).
  - Estado de AFIP/ARCA (semáforo de conexión).

### Nivel 2: Gestión de activos (módulos de trabajo)

Aquí es donde sucede la carga y el control de la mercadería y el dinero.

- **2.0 Inventario & stock**
  - **2.1 Catálogo de productos:** (Alta, baja y edición).
  - **2.2 Movimientos de stock:** (Ingresos, egresos y transferencias entre sucursales en una sola vista).
  - **2.3 Lector IA de facturas:** (Carga automática de compras a proveedores para subir stock).
- **3.0 Punto de venta (POS)**
  - **3.1 Caja registradora:** (Interfaz de venta rápida con botones grandes y atajos).
  - **3.2 Apertura / cierre de jornada:** (Arqueo de caja guiado con detección de faltantes).
  - **3.3 Historial de caja:** (Línea de tiempo de retiros, depósitos y cierres pasados).

### Nivel 3: Ciclo de venta & documentación

Todo lo que tiene que ver con el papel y el proceso de los pedidos.

- **4.0 Ventas & pedidos**
  - **4.1 Workflow de pedidos:** (Tablero visual de estados: Pendiente, Preparando, Enviado).
  - **4.2 Comprobantes emitidos:** (Listado de facturas, tickets y presupuestos con filtros por "Plata Real").
  - **4.3 Centro de errores (ex Resolver ARCA):** (Lista de facturas rebotadas con diagnóstico de solución rápida).

### Nivel 4: Entidades (relaciones)

La gestión de las personas que interactúan con el sistema.

- **5.0 Directorio de contactos**
  - **5.1 Clientes:** (Historial de compras y saldos en cuenta corriente).
  - **5.2 Proveedores:** (Listado de contactos y cuentas a pagar).

### Nivel 5: Análisis & inteligencia (lo estratégico)

Donde entrás para entender la salud del negocio a largo plazo.

- **6.0 Reportes de negocio**
  - **6.1 Rendimiento:** (Ganancia neta, productos estrella y ranking de ventas).
  - **6.2 Finanzas:** (Libro IVA, deudas a cobrar y flujo de fondos).
  - **6.3 Auditoría:** (Quién borró qué o quién modificó un precio).

### Nivel 6: Configuración del sistema

El motor del programa, separado para evitar cambios accidentales.

- **7.0 Ajustes del sistema**
  - **7.1 Mi negocio:** (Datos fiscales, logo y sucursales).
  - **7.2 Reglas operativas:** (Redondeos, permisos de venta sin stock, modos de interfaz).
  - **7.3 Usuarios & roles:** (Permisos para empleados vs. administrador).

---

## 5. Proto-personas: el factor humano

### ¿Qué son?

Las Proto-Personas son representaciones arquetípicas de los usuarios reales del sistema. A diferencia de las "Personas" tradicionales (que surgen de meses de investigación de campo), las Proto-Personas se basan en el conocimiento directo del negocio, las frustraciones observadas y los roles operativos existentes.

### ¿Para qué sirven en esta auditoría?

- **Empatía técnica:** Nos permiten dejar de ver el software como una base de datos y empezar a verlo como una herramienta que Martín, Lucía y Nicolás usan para trabajar.
- **Priorización de funciones:** Si una mejora no ayuda a resolver un problema de uno de estos perfiles, no es prioritaria.
- **Alineación de expectativas:** Aseguran que el diseño responda a necesidades reales: la velocidad para el cajero, el control para el dueño y la resolución de conflictos para el encargado.

### 5.1 El estratega (Martín — dueño)

**Título:** De la incertidumbre a la decisión en 5 minutos.

**Narrativa (texto del informe):**

> "Es lunes por la mañana y Alejandro no está en el local; está desayunando mientras revisa su tablet. Antes, para saber cuánto había ganado el fin de semana, tenía que esperar al cierre manual o llamar por teléfono. Hoy, abre el Dashboard Ejecutivo. En 30 segundos, ve una flecha verde: las ventas subieron un 15% respecto al lunes anterior.
> Recibe un aviso: 'Stock crítico en Remeras'. En lugar de buscar la factura del proveedor en biblioratos, usa el Lector IA: le saca una foto al remito que le mandó el repartidor por WhatsApp, el sistema reconoce los precios nuevos, actualiza el costo y le pregunta si quiere ajustar el precio de venta para mantener su margen. Alejandro confirma con un tap. El negocio se gestionó solo mientras terminaba su café."

- **Objetivo principal:** Rentabilidad y control. Necesitás saber si el negocio es sano sin estar físicamente en la caja.
- **Frustraciones actuales:** Perder tiempo cargando facturas a mano o navegar por menús técnicos (como Slugs o UUIDs) para ver un reporte de ventas.
- **Uso del sistema:**
  - Revisión de reportes y ganancias.
  - Carga de compras (usando el lector IA).
  - Configuración de reglas de negocio (redondeos, stock).
- **Interfaz ideal:** Un Dashboard ejecutivo limpio (Zen) con indicadores de "plata en la calle" y stock crítico.

### 5.2 El operativo (Lucía — cajera/vendedora)

**Título:** La fila que fluye sin errores.

**Narrativa (texto del informe):**

> "Son las 19:00 hs, la hora pico en Alushi. Hay tres personas esperando y el teléfono suena por un pedido de Instagram. El cajero no se pone nervioso. Gracias al Modo High Contrast, encuentra los productos al instante. Un cliente quiere pagar una parte en efectivo y otra con Mercado Pago; el sistema lo resuelve en una sola pantalla sin vueltas.
> Al momento de cobrar, el botón 'COBRAR' destaca tanto que no hay lugar a error. El ticket sale impreso con el logo perfecto y el cliente se va rápido. Al final del día, el Arqueo Guiado le pide el monto en caja. El sistema le dice: 'Faltan $50'. El cajero recuerda que dio un cambio mal, lo anota como observación y cierra la jornada en un minuto. Se va a su casa tranquilo porque sabe que su trabajo quedó prolijo."

- **Objetivo principal:** Velocidad y precisión. Quiere cobrar rápido y no equivocarse con el cambio o el stock.
- **Frustraciones actuales:** Que el sistema sea lento, que tenga botones chiquitos o que le pida muchos datos para una venta simple de "Consumidor Final".
- **Uso del sistema:**
  - Venta rápida (Tickets).
  - Consulta rápida de precios y stock.
  - Apertura y cierre de su propia caja.
- **Interfaz ideal:** Modo High Contrast, botones grandes, atajos de teclado y buscador de productos inteligente.

### 5.3 El facilitador (Nicolás — encargado/gerente)

**Título:** El bombero que ahora tiene un mapa.

**Narrativa (texto del informe):**

> "El encargado llega al local y ve que una factura de ayer fue rechazada por AFIP. Antes, esto era un drama que implicaba llamar al contador. Ahora, entra al Centro de Errores (ex Resolver ARCA). El sistema le habla en humano: 'CUIT del cliente inválido'. Lo corrige ahí mismo, aprieta 'Reintentar' y el semáforo se pone en verde.
> Luego, abre el Workflow de Pedidos. Ve que hay 5 pedidos de WhatsApp en estado 'Preparando'. Los arrastra visualmente a 'Enviado' a medida que el flete los retira. No tiene que escribir nada, solo supervisar que el flujo se mueva. Siente que tiene el control total de la logística sin tener que preguntar nada a nadie."

- **Objetivo principal:** Resolución de problemas y logística.
- **Frustraciones actuales:** No poder corregir un error de un compañero rápido o perderse en el historial de movimientos de stock.
- **Uso del sistema:**
  - Resolver ARCA (arreglar facturas que rebotaron).
  - Gestión del workflow de pedidos (pasar de "Preparando" a "Enviado").
  - Transferencias entre sucursales y control de inventario.
- **Interfaz ideal:** Una vista de gestión operativa (tipo Kanban para pedidos) y acceso a auditoría de movimientos.

---

## 6. User journeys

> El User Journey es una herramienta de diseño centrado en el usuario que permite visualizar el proceso completo que realiza una persona para alcanzar un objetivo específico dentro del sistema. A diferencia de un mapa de sitio, que es estático, el Journey es narrativo y dinámico: describe los pasos, los puntos de contacto, las emociones y los posibles obstáculos que surgen durante la interacción.

En esta auditoría, utilizamos los User Journeys para:

- **Detectar fricciones:** Identificar en qué momento exacto el usuario se siente frustrado o confundido.
- **Optimizar flujos:** Reducir la cantidad de clics o pasos innecesarios entre el inicio de una tarea y su resolución.
- **Contextualizar la interfaz:** Entender que una pantalla de "Caja" no es solo un formulario, sino el final de una interacción humana que requiere velocidad y precisión.

En resumen: Si el Sitemap es el plano de una casa, el User Journey es el relato de cómo una persona vive en ella, desde que entra hasta que se va.

### Journey 1: Abastecimiento con lector IA

- **Actor:** Martín (dueño / el estratega)
- **Meta:** Actualizar el stock de 50 prendas nuevas que acaban de llegar sin tipear manualmente.

1. **Inicio:** Martín abre la sección de Ingreso de Mercadería desde su celular mientras descargan las cajas.
2. **Captura:** Selecciona el ícono de Lector IA y le saca una foto a la factura de papel del proveedor.
3. **Procesamiento:** El sistema extrae cantidades, descripciones y costos. Martín ve en pantalla una lista precargada.
4. **Decisión:** El sistema resalta en naranja un producto: "El costo subió $200". Martín toca el botón "Ajustar PVP" para mantener su margen del 40%.
5. **Finalización:** Presiona "Confirmar Ingreso". El stock del comercio se actualiza al instante.

**Punto de dolor de Martín:** "Tardar 1 hora cargando una factura." → **Solución:** "Lector IA (reducción a 1 minuto)."

### Journey 2: La venta multi-pago en hora pico

- **Actor:** Lucía (cajera / la operativa)
- **Meta:** Cobrar una venta de 3 artículos a un cliente apurado, combinando efectivo y transferencia.

1. **Inicio:** Lucía escanea los productos. Los ítems aparecen en la lista con tipografía Inter/Roboto de alto contraste (Nivel AAA).
2. **Subtotal:** El cliente pregunta cuánto es. Lucía mira el total en negrita gigante: $45.600.
3. **Pago mixto:** Lucía selecciona "Cobro Combinado". Ingresa $10.000 en la solapa de Efectivo y el resto se autocompleta en la de Transferencia.
4. **Acción:** Presiona el botón verde COBRAR (F2), que es el elemento más grande de la pantalla.
5. **Cierre:** El ticket se imprime y la pantalla se limpia automáticamente para el siguiente cliente.

**Punto de dolor de Lucía:** "Confundirse con los decimales al cobrar." → **Solución:** "Diseño accesible AAA y redondeo automático."

### Journey 3: Resolución de conflicto fiscal

- **Actor:** Nicolás (encargado / el facilitador)
- **Meta:** Corregir una factura rechazada por AFIP para que el cliente pueda llevarse su comprobante legal.

1. **Alerta:** Nicolás nota un punto rojo en el menú lateral: Facturación > Centro de Errores.
2. **Diagnóstico:** Entra y lee el error de la factura de un cliente: "CUIT no vinculado a la actividad comercial".
3. **Acción:** Nicolás le pide el DNI al cliente, lo cambia en el campo de texto y el sistema valida los datos con la base de AFIP en tiempo real.
4. **Re-intento:** Presiona el botón "Autorizar Comprobante".
5. **Éxito:** El estado cambia de Rojo a Verde. Nicolás envía el PDF por WhatsApp al cliente desde el mismo sistema.

**Punto de dolor de Nicolás:** "No entender los códigos de error de AFIP." → **Solución:** "Traducción de errores a lenguaje humano."

---

## 7. Design system: el lenguaje de marca y eficiencia

### ¿Qué es?

Un Design System (Sistema de Diseño) no es solo una "guía de estilos" o un conjunto de colores. Es una biblioteca viva de componentes, principios y reglas que dictan cómo se construye el software. Es el "ADN" visual y funcional de la plataforma.

### ¿Por qué es vital para Smart Stock?

- **Consistencia:** Garantiza que un botón de "Guardar" se vea y funcione igual en la pantalla de Inventario que en la de Configuración, reduciendo la curva de aprendizaje.
- **Escalabilidad:** Permite que el sistema crezca (se agreguen nuevos módulos) sin que la interfaz se desordene o se vuelva incoherente.
- **Accesibilidad y performance:** Al definir de antemano el contraste (AA/AAA) y el comportamiento en modo oscuro/claro, aseguramos que el sistema sea inclusivo y profesional desde su estructura básica.
- **Eficiencia en desarrollo:** El programador ya no tiene que adivinar qué color usar; simplemente utiliza los "Tokens" (ej. bg-primary) definidos en el sistema.

Para garantizar una operatividad continua sin fatiga visual, se propone una arquitectura de diseño basada en **Tokens adaptativos**. Esto permite alternar entre un **Modo claro (Light Mode)** optimizado para entornos de alta luminosidad, y un **Modo oscuro (Dark Mode)** diseñado para reducir la fatiga en jornadas extensas y entornos de luz controlada, cumpliendo con los estándares de contraste WCAG.

### 7.1 Sistema de color: tokens adaptativos

En lugar de fijar colores estáticos, usamos tokens. Por ejemplo, el token Surface-Primary es blanco en Light Mode y gris oscuro en Dark Mode.

| Token | Función | Light Mode (día) | Dark Mode (noche) |
|--------|---------|------------------|-------------------|
| bg-main | Fondo de la aplicación | #F8F9FA (gris casi blanco) | #121212 (gris profundo) |
| bg-surface | Tarjetas, tablas y paneles | #FFFFFF (blanco puro) | #1E1E1E (gris elevado) |
| text-primary | Títulos y lectura principal | #1A1A1B (negro óptico) | #E1E1E1 (blanco suave) |
| text-secondary | Subtítulos y placeholders | #64748B (gris medio) | #94A3B8 (gris azulado) |
| accent-primary | Botones de acción (Vender) | #007BFF (azul corporativo) | #3395FF (azul vibrante) |
| border-subtle | Líneas divisorias de tablas | #E2E8F0 (gris muy claro) | #2D2D2D (gris oscuro) |

**Nota de accesibilidad:** En Dark Mode, nunca usamos negro puro (#000) para el fondo ni blanco puro (#FFF) para el texto, ya que el contraste extremo produce un efecto de "halo" o "sangrado" (halación) que dificulta la lectura.

### 7.2 Tipografía y escala visual

Para cumplir con las pautas WCAG 2.1, la tipografía debe ser flexible:

- **Contraste:** El texto debe mantener un ratio mínimo de 4.5:1 contra el fondo en ambos modos.
- **Fuente:** Inter (Google Fonts). Es gratuita, moderna y excelente para números (fundamental en un sistema de stock).
- **Jerarquía de números:** En el POS (Punto de Venta), el precio total debe usar un peso Bold y ser al menos un 40% más grande que el resto de los textos.

### 7.3 Componentes de interfaz (UI kit)

**A. Botones "Loud" vs "Quiet"**

- **Acción crítica (Cobrar):** Botón con color sólido. En Dark Mode, el color debe ser un poco más brillante para destacar.
- **Acción secundaria (Cancelar):** Botón solo con borde (outlined). El borde debe ser visible pero no distraer.

**B. Estados dinámicos (semántica)**

Los colores de estado deben ajustarse para ser legibles:

- **Éxito (Stock OK):** Verde suave en Light / Verde neón apagado en Dark.
- **Alerta (Error ARCA):** Rojo cálido en Light / Coral brillante en Dark.

**C. Tablas de datos (data tables)**

- **Zebra striping:** Usar filas con colores alternos muy sutiles para ayudar al ojo a seguir la línea.
- **Hover state:** Al pasar el mouse por una fila, esta debe iluminarse sutilmente (bg-hover), indicando qué ítem estamos mirando.

### 7.4 Accesibilidad (A11y) — más allá del color

Al incluir esto en tu auditoría, demostrás que pensás en todos los usuarios:

- **Focus indicators:** En ambos modos, cualquier elemento seleccionado mediante el teclado (con la tecla Tab) debe tener un borde grueso y brillante (ej. azul o naranja).
- **Touch targets:** Los botones en el modo "Caja" deben tener un área mínima de 44x44 píxeles, para que se puedan tocar fácilmente en pantallas táctiles sin errarle.
- **Iconos + texto:** Nunca usar un icono solo (ej: un tachito de basura). Siempre debe ir acompañado de texto o un "Tooltip" (pequeño cartel al pasar el mouse) para que los lectores de pantalla puedan interpretarlo.

### 7.5 Especificación técnica de contrastes (guía de estilos)

**1. Estándares de contraste (ratio target)**

- **Nivel AA (mínimo):** Ratio de 4.5:1 para texto normal y 3:1 para texto grande o componentes de interfaz (iconos, bordes de inputs).
- **Nivel AAA (óptimo):** Ratio de 7:1 para texto normal y 4.5:1 para texto grande.

**2. Tabla de contrastes: Light vs Dark Mode**

Para asegurar que tu sistema sea accesible, usaremos estos valores de contraste calculados:

| Elemento | Propiedad | Light Mode (AA/AAA) | Dark Mode (AA/AAA) |
|----------|-----------|---------------------|---------------------|
| Texto principal | Sobre fondo base | Negro óptico (#1A1A1B) sobre Blanco. Ratio: 18:1 (Supera AAA). | Gris Platino (#E1E1E1) sobre Gris Noche. Ratio: 13:1 (Supera AAA). |
| Texto secundario | Notas o leyendas | Gris Pizarra (#576574). Ratio: 5.5:1 (Cumple AA). | Gris Humo (#A0A0A0). Ratio: 5:1 (Cumple AA). |
| Botón acción (Cobrar) | Texto sobre fondo | Blanco sobre Azul Intenso (#0056b3). Ratio: 6.5:1 (Cumple AA). | Negro sobre Celeste Neón (#70B5FF). Ratio: 8:1 (Cumple AAA). |
| Estados de error | Texto sobre fondo | Rojo Oscuro (#C0392B) sobre blanco. Ratio: 6:1 (Cumple AA). | Blanco sobre Rojo Coral (#E74C3C). Ratio: 4.6:1 (Cumple AA). |

**3. Accesibilidad de componentes (non-text contrast)**

Para cumplir con el nivel AA, no solo el texto debe tener contraste. Los elementos de "interacción" también:

- **Inputs (campos de carga):** El borde de los cuadros de texto debe tener un contraste de al menos 3:1 contra el fondo. Esto asegura que una persona con baja visión sepa exactamente dónde termina el campo y empieza el fondo.
- **Iconos informativos:** Si el icono transmite información (como el de "Advertencia" en Resolver ARCA), debe cumplir el ratio de 3:1.
- **Focus state (el foco del teclado):** Cuando navegues con el teclado, el anillo de selección debe ser naranja brillante o azul eléctrico con un ratio de contraste de 4.5:1 respecto al fondo, para que nunca "te pierdas" en la pantalla.

**4. Herramientas y validación**

Para tu auditoría, podés mencionar que el UI Kit fue validado con:

- **Adobe Color Contrast Analyzer:** Para verificar ratios WCAG.
- **Simulación de daltonismo:** Asegurando que la diferencia entre un botón de "Éxito" (Verde) y uno de "Error" (Rojo) no dependa solo del color, sino también de iconos o etiquetas de texto (esencial para accesibilidad).

**5. Recomendación de tipografía (cierre de decisión)**

Dado que pediste máxima accesibilidad (AAA), mi recomendación final es Inter.

¿Por qué? Porque su "x-height" (la altura de las letras minúsculas) es mayor que en Roboto, lo que permite que el contraste se perciba mejor en tamaños pequeños. Además, su diseño evita que las letras se "peguen" visualmente cuando hay mucho contraste (como blanco sobre negro).

**6. Grid y layout system (code-standard)**

Para que la IA no invente márgenes aleatorios, dale estas reglas:

- **Sistema de 8px:** "Todo espaciado (margin/padding) debe ser múltiplo de 8. No uses valores impares ni arbitrarios".
- **Grid CSS:** "Utiliza CSS Grid de 12 columnas para desktop y 4 para mobile. Alineación siempre center en contenedores de tarjetas".
- **Componentes atómicos:** "Antes de escribir CSS nuevo, verifica si existe un token de espaciado $space-m (16px) o $space-l (24px)".

**7. Tono y voz del código (clean code)**

Para que el código sea legible para humanos (como vos), pedile a la IA que mantenga este tono:

- **Semántica clara:** "Nombrá las variables por su función, no por su tipo. Usá isInvoiceValid en lugar de check1".
- **Documentación Zen:** "Escribí comentarios breves y directos. No expliques qué hace el código, explicá por qué lo hace. Usá un tono profesional pero cercano".
- **Refactorización:** "Si ves una función de más de 20 líneas, proponé una refactorización para dividirla en funciones más pequeñas y reutilizables".

**8. Tono y voz del sistema (UX copy)**

Cuando la IA tenga que generar textos para la interfaz (mensajes de error o etiquetas):

- **Instrucción de copiloto:** "Nunca generes mensajes de error técnicos. Traducí los errores de servidor a lenguaje administrativo simple. Evitá el uso de mayúsculas sostenidas y signos de exclamación excesivos".

**9. Accesibilidad por defecto (A11y coding)**

Hacé que el Copilot sea tu auditor de accesibilidad mientras codeás:

- **Contraste automático:** "Al generar componentes de color, asegurate de que el ratio de contraste sea siempre AA (4.5:1) como mínimo".
- **Atributos ARIA:** "Cada vez que generes un ícono o un botón interactivo, incluí automáticamente el aria-label correspondiente".
- **Semántica HTML:** "Priorizá el uso de etiquetas semánticas (`<main>`, `<nav>`, `<section>`) sobre el uso excesivo de `<div>`".

**10. Lógica de "modo espejo" (Light/Dark Mode)**

Para que el código soporte ambos temas sin esfuerzo:

- **Uso de variables:** "No hardcodees colores (ej: #FFF). Usá siempre variables CSS que cambien según el data-theme. Ejemplo: color: var(--text-primary)".

---

## 8. Próximos pasos sugeridos en el repo

- Cruzar este documento con tickets de implementación (Dashboard, navegación/Sitemap, copy, design tokens, A11y).
- Validar contrastes y tokens con las herramientas citadas en la sección 7.5.
- **Checklist release visual (§7.5.4):** antes de cerrar una versión que toque UI, correr **Adobe Color Contrast Analyzer** (o equivalente, p. ej. APCA en navegador) y **simulación de daltonismo** (p. ej. Chrome DevTools → Rendering → Emulate vision deficiencies), además de no depender solo del color (icono o etiqueta en estados de éxito/error).
- **Implementación §7.5.2 (cierre `V131-UXAUD-014`):** los pares prioritarios del informe están mapeados en `src/app/globals.css` (`--foreground`, `--primary` / `--brand-primary`, `--destructive`, `--semantic-arca-error-*`, etc.) y resumidos en `docs/arquitectura.md` junto al checklist de herramientas §7.5.4.

### Backlog Nexus derivado de este informe

### Glosario de etiquetas (v13.1 — `V131-UXAUD-005`)

| Antes (UI) | Después (UI) | Ruta (sin cambio) |
|------------|--------------|-------------------|
| Resolver ARCA | Centro de errores | `/facturacion/resolver-arca` |
| Ticket (menú) | Punto de venta | `/facturacion/pos` |
| Administración (grupo) | Directorio | proveedores / clientes |
| ARCA / AFIP (config) | Datos fiscales (AFIP) | `/configuracion/arca` |

En `docs/TICKETS.md`, bloque **BLOQUE AUDITORÍA UX/UI — v13.1** (`V131-UXAUD-001` … `V131-UXAUD-018`):

| Sección del informe | Tickets |
|---------------------|---------|
| §3.1 Dashboard (tabla de hallazgos) | `V131-UXAUD-001` |
| §4 Sitemap (principios + niveles 1–7) | `V131-UXAUD-002` |
| §2 Pilar limpieza visual | `V131-UXAUD-003` |
| §2 Pilar prevención de errores | `V131-UXAUD-004` |
| §2 + §4 Pilar lenguaje humano | `V131-UXAUD-005` |
| §5 Proto-personas | `V131-UXAUD-006` |
| §6 Journey 1 (lector IA) | `V131-UXAUD-007` |
| §6 Journey 2 (POS multi-pago) | `V131-UXAUD-008` |
| §6 Journey 3 (fiscal / centro de errores) | `V131-UXAUD-009` |
| §7.1 + §7.5.10 Tokens / tema | `V131-UXAUD-010` |
| §7.2 + §7.5.5 Tipografía | `V131-UXAUD-011` |
| §7.3 UI kit | `V131-UXAUD-012` |
| §7.4 + §7.5.3 + §7.5.9 A11y | `V131-UXAUD-013` |
| §7.5.1–2 + §7.5.4 Contraste y QA | `V131-UXAUD-014` |
| §7.5.6 Grid | `V131-UXAUD-015` |
| §7.5.8 UX copy | `V131-UXAUD-016` |
| §7.5.7 Clean code (guía equipo) | `V131-UXAUD-017` |
| §1 + §8 Trazabilidad y checklist | `V131-UXAUD-018` |

---

*Consolidación: contenido extraído de los PDF (1) a (5) del informe y de la parte introductoria ya documentada; se preservó el texto y las ideas del material fuente.*