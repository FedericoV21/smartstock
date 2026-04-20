---
estado: 🟡 En progreso
version: v6.0
ultima_actualizacion: 2026-04-16
---

# Nexus — Backlog de tickets

---

# BLOQUE A — v0.1 (Fundaciones) y v1.0 (Stock + Importador)

---

## V01-INFRA-001 — Inicializar proyecto Next.js con estructura de carpetas (hecho)

- Tipo: setup
- Módulo: infra
- Prioridad: critical
- Estimación: 2
- Versión: v0.1
- Estado: done ✅
- Dependencias: ninguna

**Descripción:** Crear el proyecto con `create-next-app` usando App Router, TypeScript y Tailwind CSS. Establecer la estructura de carpetas definitiva (`src/app/`, `src/lib/`, `src/components/`, `src/hooks/`, `src/types/`).

**Criterios de aceptación:**
- [x] Proyecto creado con `npx create-next-app@latest --typescript --tailwind --app --src-dir`
- [x] Estructura de carpetas según `arquitectura.md`: `(auth)/`, `(dashboard)/`, `api/`, `lib/`, `components/`, `hooks/`, `types/`
- [x] `npm run dev` levanta sin errores en `localhost:3000`
- [x] `npm run build` compila sin errores de TypeScript

**Notas técnicas:** Usar pnpm o npm según decisión del equipo. Configurar `tsconfig.json` con paths alias `@/`.

---

## V01-INFRA-002 — Instalar dependencias base del proyecto (hecho)

- Tipo: setup
- Módulo: infra
- Prioridad: critical
- Estimación: 1
- Versión: v0.1
- Estado: done ✅
- Dependencias: V01-INFRA-001

**Descripción:** Instalar las dependencias iniciales necesarias para Supabase, componentes UI y utilidades.

**Criterios de aceptación:**
- [x] `@supabase/supabase-js` y `@supabase/ssr` instalados
- [x] Librería UI elegida instalada (shadcn/ui recomendado) con al menos button, input, select, dialog, table
- [x] `lucide-react` instalado para iconos
- [x] `package.json` tiene scripts `dev`, `build`, `start`, `lint`

**Notas técnicas:** Si se elige shadcn/ui, ejecutar `npx shadcn-ui@latest init` y agregar componentes base.

---

## V01-INFRA-003 — Crear proyecto Supabase y obtener credenciales (hecho)

- Tipo: setup
- Módulo: infra
- Prioridad: critical
- Estimación: 1
- Versión: v0.1
- Estado: done
- Dependencias: ninguna

**Descripción:** Crear el proyecto en Supabase Dashboard, obtener URL y keys, configurar `.env.local`.

**Criterios de aceptación:**
- [ ] Proyecto creado en Supabase (región cercana a Argentina)
- [ ] `.env.local` creado con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_ScERVICE_ROLE_KEY`
- [ ] `.env.local` agregado a `.gitignore`
- [ ] `.env.local.example` creado con los nombres de variables sin valores

**Notas técnicas:** Vincular con `supabase link --project-ref <ref>`.

---

## V01-DB-001 — Migración 001: extensiones y ENUMs (hecho)

- Tipo: migration
- Módulo: infra
- Prioridad: critical
- Estimación: 2
- Versión: v0.1
- Estado: done
- Dependencias: V01-INFRA-003

**Descripción:** Crear la primera migración con las extensiones PostgreSQL requeridas y todos los tipos enumerados del sistema.

**Criterios de aceptación:**
- [ ] Archivo `supabase/migrations/001_enums.sql` creado
- [ ] Extensiones `uuid-ossp`, `pgcrypto`, `moddatetime` habilitadas
- [ ] Los 11 ENUMs creados: `condicion_iva`, `rol_usuario`, `unidad_medida`, `tipo_movimiento`, `referencia_tipo`, `tipo_comprobante`, `estado_comprobante`, `estado_pedido`, `plan_tipo`, `arca_ambiente`, `origen_precio`
- [ ] `supabase db push` ejecuta sin errores

**Notas técnicas:** SQL completo en `base-de-datos.md` sección ENUMs.

---

## V01-DB-002 — Migraciones 002-010: todas las tablas (hecho)

- Tipo: migration
- Módulo: infra
- Prioridad: critical
- Estimación: 5
- Versión: v0.1
- Estado: done
- Dependencias: V01-DB-001

**Descripción:** Crear las migraciones 002 a 010 con todas las tablas del sistema, triggers, índices y constraints.

**Criterios de aceptación:**
- [ ] Migración 002: tabla `tenant` con trigger y índice
- [ ] Migración 003: tabla `usuario` con FK a `auth.users` y `tenant`
- [ ] Migración 004: tablas `categoria`, `proveedor`, `producto` con todos sus índices y constraints
- [ ] Migración 005: tabla `movimiento`
- [ ] Migración 006: tablas `cliente`, `comprobante`, `comprobante_item`
- [ ] Migración 007: tablas `pedido`, `pedido_item`
- [ ] Migración 008: tabla `importacion_log`
- [ ] Migración 009: tabla `precio_historial`
- [ ] Migración 010: tablas `arca_config`, `arca_log`
- [ ] Todas las migraciones ejecutan en orden con `supabase db push`

**Notas técnicas:** SQL completo en `base-de-datos.md`. Respetar el orden estricto de dependencias.

---

## V01-DB-003 — Migración 011: RLS y funciones de auth (hecho)

- Tipo: migration
- Módulo: auth
- Prioridad: critical
- Estimación: 3
- Versión: v0.1
- Estado: done
- Dependencias: V01-DB-002

**Descripción:** Habilitar RLS en las 16 tablas, crear las policies SELECT/INSERT/UPDATE/DELETE, y las funciones `custom_access_token_hook` y `auth.tenant_id()`.

**Criterios de aceptación:**
- [ ] `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` en las 16 tablas
- [ ] 4 policies (select, insert, update, delete) por cada tabla con `tenant_id` directo
- [ ] Policies con subquery para `comprobante_item` y `pedido_item`
- [ ] Función `public.custom_access_token_hook` creada con permisos para `supabase_auth_admin`
- [ ] Función `auth.tenant_id()` creada
- [ ] Grants y revokes correctos

**Notas técnicas:** SQL completo en `multi-tenancy.md`. Después de ejecutar, registrar el hook manualmente en Supabase Dashboard.

---

## V01-DB-004 — Migración 012: funciones de negocio (hecho)

- Tipo: migration
- Módulo: infra
- Prioridad: critical
- Estimación: 2
- Versión: v0.1
- Estado: done
- Dependencias: V01-DB-003

**Descripción:** Crear las funciones SQL `registrar_movimiento` y `siguiente_numero_comprobante`.

**Criterios de aceptación:**
- [ ] Función `registrar_movimiento` creada con `SECURITY DEFINER`
- [ ] Función `siguiente_numero_comprobante` creada con `SECURITY DEFINER`
- [ ] Ambas funciones ejecutan correctamente desde un RPC de Supabase
- [ ] Tests manuales: entrada suma stock, salida resta, ajuste establece, salida con stock insuficiente lanza error

**Notas técnicas:** SQL completo en `base-de-datos.md`.

---

## V01-DB-005 — Seed con datos de prueba para 2 tenants (hecho)

- Tipo: setup
- Módulo: infra
- Prioridad: high
- Estimación: 3
- Versión: v0.1
- Estado: done
- Dependencias: V01-DB-004

**Descripción:** Crear `supabase/seed.sql` con datos de prueba para 2 tenants distintos: cada uno con productos, categorías, proveedores. Sirve para testear aislamiento RLS.

**Criterios de aceptación:**
- [x] Tenant A: "Almacén Don Pedro" con 10 productos, 3 categorías, 2 proveedores, plan base
- [x] Tenant B: "Distribuidora López" con 15 productos, 5 categorías, 3 proveedores, plan completo
- [x] `modulo_config` creado para cada tenant con módulos según plan
- [x] Al menos 5 movimientos de stock por tenant
- [x] `supabase seed` (local) / seed en `db reset` ejecuta sin errores — ver `supabase/config.toml` → `[db.seed]`
- [x] Los datos respetan constraints y son realistas (nombres, precios, stocks argentinos)

**Notas técnicas:** Los usuarios de auth se crean via `supabase.auth.admin.createUser` o en el seed con insert directo a `auth.users` (solo en desarrollo).

---

## V01-AUTH-001 — Crear clientes Supabase (browser, server, service role) (hecho)

- Tipo: feature
- Módulo: auth
- Prioridad: critical
- Estimación: 2
- Versión: v0.1
- Estado: done
- Dependencias: V01-INFRA-002, V01-INFRA-003

**Descripción:** Implementar los 3 clientes Supabase: browser para Client Components, server para Server Components/API Routes, y service role para operaciones administrativas.

**Criterios de aceptación:**
- [x] `src/lib/supabase/client.ts` exporta `createBrowserClient()`
- [x] `src/lib/supabase/server.ts` exporta `createServerClient()` y `createServiceRoleClient()`
- [x] Los clientes usan las variables de entorno correctas
- [x] El server client maneja cookies correctamente para SSR

**Notas técnicas:** Código de referencia en `autenticacion.md`.

---

## V01-AUTH-002 — Implementar middleware de sesión (hecho)

- Tipo: feature
- Módulo: auth
- Prioridad: critical
- Estimación: 3
- Versión: v0.1
- Estado: done
- Dependencias: V01-AUTH-001

**Descripción:** Crear `src/middleware.ts` que intercepta todas las requests, refresca sesiones, y redirige según autenticación.

**Criterios de aceptación:**
- [x] Rutas públicas (`/login`, `/register`, `/api/auth/callback`) accesibles sin sesión
- [x] Rutas protegidas (`/`, `/productos`, etc.) redirigen a `/login` si no hay sesión
- [x] Si hay sesión y el usuario va a `/login`, redirige al dashboard
- [x] La sesión se refresca automáticamente si está por expirar
- [x] El matcher excluye assets estáticos (`_next/static`, imágenes, etc.)

**Notas técnicas:** Código completo en `autenticacion.md`.

---

## V01-AUTH-003 — Página de registro (nuevo tenant + usuario admin) (hecho)

- Tipo: feature
- Módulo: auth
- Prioridad: critical
- Estimación: 5
- Versión: v0.1
- Estado: done
- Dependencias: V01-AUTH-002, V01-DB-005

**Descripción:** Crear la página de registro y la API route que crea un tenant, modulo_config y usuario admin en una transacción. Incluye cleanup si algún paso falla.

**Criterios de aceptación:**
- [x] Página `/register` con formulario: nombre del negocio, nombre, apellido, email, contraseña
- [x] API route `POST /api/auth/register` crea auth user → tenant → modulo_config → usuario
- [x] Si falla algún paso, revierte los anteriores (cleanup)
- [x] Después del registro, hace login automático y redirige al dashboard
- [x] Validación de campos: email válido, contraseña mínimo 6 caracteres, nombre requerido
- [x] Errores mostrados al usuario (email ya registrado, etc.)

**Notas técnicas:** Código de referencia en `autenticacion.md`.

---

## V01-AUTH-004 — Página de login (email/password) (hecho)

- Tipo: feature
- Módulo: auth
- Prioridad: critical
- Estimación: 3
- Versión: v0.1
- Estado: done
- Dependencias: V01-AUTH-002

**Descripción:** Crear la página de login con email y contraseña. El `custom_access_token_hook` inyecta el `tenant_id` en el JWT automáticamente.

**Criterios de aceptación:**
- [x] Página `/login` con formulario: email, contraseña
- [x] Usa `supabase.auth.signInWithPassword()`
- [x] Redirige al dashboard después del login exitoso
- [x] Muestra errores de credenciales inválidas
- [x] Link a `/register` para nuevos usuarios
- [x] Layout de auth sin sidebar (limpio)

**Notas técnicas:** El hook de JWT debe estar registrado en Supabase Dashboard (ver V01-DB-003).

---

## V01-AUTH-005 — Callback de auth y logout (hecho)

- Tipo: feature
- Módulo: auth
- Prioridad: high
- Estimación: 2
- Versión: v0.1
- Estado: done
- Dependencias: V01-AUTH-002

**Descripción:** Crear el endpoint de callback para magic links y la funcionalidad de logout.

**Criterios de aceptación:**
- [x] `GET /api/auth/callback` intercambia code por sesión y redirige
- [x] Botón de logout en el header del dashboard
- [x] Logout limpia la sesión y redirige a `/login`
- [x] Magic link funciona end-to-end (si se configura email en Supabase)

**Notas técnicas:** Código en `autenticacion.md`.

---

## V01-AUTH-006 — Registrar custom_access_token_hook en Supabase (hecho)

- Tipo: setup
- Módulo: auth
- Prioridad: critical
- Estimación: 1
- Versión: v0.1
- Estado: done
- Dependencias: V01-DB-003

**Descripción:** Paso manual: registrar la función `custom_access_token_hook` en el Supabase Dashboard para que inyecte `tenant_id` en el JWT.

**Criterios de aceptación:**
- [ ] Hook registrado en Authentication → Hooks → Customize Access Token
- [ ] Verificar: al hacer login, el JWT contiene el claim `tenant_id`
- [ ] Verificar: un usuario sin registro en tabla `usuario` genera JWT sin `tenant_id` (y no ve datos)

**Notas técnicas:** Instrucciones detalladas en `multi-tenancy.md` y `deploy.md`.

---

## V01-UI-001 — Layout del dashboard con sidebar y header (hecho)

- Tipo: feature
- Módulo: ui
- Prioridad: high
- Estimación: 5
- Versión: v0.1
- Estado: done
- Dependencias: V01-INFRA-002, V01-AUTH-002

**Descripción:** Crear el layout principal del dashboard: sidebar con navegación, header con nombre del tenant y botón de logout, área de contenido. La sidebar es estática por ahora (todos los items visibles).

**Criterios de aceptación:**
- [x] `(dashboard)/layout.tsx` con sidebar izquierda + header superior + contenido
- [x] Sidebar con items: Dashboard, Productos, Movimientos, Importar, Proveedores, Configuración
- [x] Header muestra nombre del usuario y botón de logout
- [x] Item activo resaltado según la ruta actual
- [x] Responsive: sidebar colapsable en móvil
- [x] `(auth)/layout.tsx` limpio, centrado, sin sidebar

**Notas técnicas:** Usar componentes de `modulos.md` como referencia para la sidebar.

---

## V01-UI-002 — Página de dashboard vacío (hecho)

- Tipo: feature
- Módulo: ui
- Prioridad: medium
- Estimación: 2
- Versión: v0.1
- Estado: done
- Dependencias: V01-UI-001

**Descripción:** Crear la página principal del dashboard con un mensaje de bienvenida y placeholders para las cards de métricas que se implementarán en v2.0.

**Criterios de aceptación:**
- [x] `(dashboard)/page.tsx` muestra "Bienvenido a Nexus" con el nombre del tenant
- [x] Placeholder para cards de métricas (stock bajo, vencimientos, ventas del día)
- [x] El usuario logueado ve esta página al entrar a `/`

**Notas técnicas:** Las cards de métricas reales se implementan en V20-UI-001.

---

## V01-TEST-001 — Test de aislamiento RLS entre tenants (hecho)

- Tipo: test
- Módulo: auth
- Prioridad: critical
- Estimación: 5
- Versión: v0.1
- Estado: done
- Dependencias: V01-DB-005, V01-AUTH-006

**Descripción:** Escribir tests automatizados que verifican que un tenant no puede ver, crear, editar ni eliminar datos de otro tenant.

**Criterios de aceptación:**
- [x] Test: Tenant A puede SELECT sus productos, Tenant B no los ve
- [x] Test: Tenant B no puede UPDATE productos de Tenant A
- [x] Test: Tenant B no puede DELETE productos de Tenant A
- [x] Test: Tenant B no puede INSERT con `tenant_id` de Tenant A
- [x] Test: usuario sin `tenant_id` en JWT no ve ningún dato
- [x] Tests pasan con `npm test` o `npx vitest`

**Notas técnicas:** Suite completa en `multi-tenancy.md`. Usar Vitest con el Supabase client.

---

## V01-INFRA-004 — Configurar Vitest y estructura de tests (hecho)

- Tipo: setup
- Módulo: infra
- Prioridad: high
- Estimación: 2
- Versión: v0.1
- Estado: done
- Dependencias: V01-INFRA-002

**Descripción:** Configurar Vitest como framework de testing, con soporte para TypeScript y variables de entorno.

**Criterios de aceptación:**
- [x] `vitest` y `@testing-library/react` instalados
- [x] `vitest.config.ts` configurado con paths alias y setup file
- [x] Script `test` en `package.json` ejecuta Vitest
- [x] Un test trivial pasa para verificar la configuración

**Notas técnicas:** Configurar `dotenv` para leer `.env.local` en los tests.

---

## V01-TYPES-001 — Generar tipos TypeScript de Supabase (hecho)

- Tipo: setup
- Módulo: infra
- Prioridad: high
- Estimación: 1
- Versión: v0.1
- Estado: done
- Dependencias: V01-DB-004

**Descripción:** Generar los tipos TypeScript automáticos desde el schema de Supabase para tener type safety en todo el proyecto.

**Criterios de aceptación:**
- [x] `src/types/database.ts` generado con `supabase gen types typescript`
- [x] Script `gen:types` en `package.json` para regenerar
- [x] Los clientes Supabase tipados con `Database` genérico
- [x] Autocompletado funciona en queries `.from('producto').select(...)`

**Notas técnicas:** `npm run gen:types` (requiere `SUPABASE_ACCESS_TOKEN`; el ref se toma de `.env.local`). El archivo versionado refleja el esquema documentado en `base-de-datos.md` hasta regenerar contra el proyecto remoto.

---

## V10-STOCK-001 — CRUD de categorías (hecho)

- Tipo: feature
- Módulo: stock
- Prioridad: high
- Estimación: 3
- Versión: v1.0
- Estado: done
- Dependencias: V01-UI-001, V01-AUTH-001

**Descripción:** Implementar el CRUD completo de categorías: listado, creación, edición y soft-delete.

**Criterios de aceptación:**
- [x] API route `GET /api/categorias` retorna categorías del tenant
- [x] API route `POST /api/categorias` crea una categoría
- [x] Validación: nombre único dentro del tenant (constraint de DB)
- [x] Guard de rol: visor no puede crear/editar
- [x] UI: listado con opción de crear nueva desde un modal/dialog

**Notas técnicas:** Código de referencia en `stock.md`.

---

## V10-STOCK-002 — CRUD de proveedores (hecho)

- Tipo: feature
- Módulo: stock
- Prioridad: high
- Estimación: 3
- Versión: v1.0
- Estado: done
- Dependencias: V01-UI-001, V01-AUTH-001

**Descripción:** Implementar el CRUD completo de proveedores: listado, creación, edición, detalle con perfil de mapeo Excel.

**Criterios de aceptación:**
- [x] Páginas `/proveedores` (lista) y `/proveedores/[id]` (detalle)
- [x] API routes GET, POST, PATCH para proveedores
- [x] Campos: nombre, CUIT, teléfono, email, dirección, notas
- [x] El detalle muestra el perfil de mapeo Excel guardado (si existe)
- [x] Guard de rol: visor no puede crear/editar

**Notas técnicas:** El campo `mapeo_excel` se llena desde el importador (V10-IMP-004).

---

## V10-STOCK-003 — CRUD de productos con búsqueda y filtros (hecho)

- Tipo: feature
- Módulo: stock
- Prioridad: critical
- Estimación: 8
- Versión: v1.0
- Estado: done
- Dependencias: V10-STOCK-001, V10-STOCK-002

**Descripción:** Implementar el CRUD completo de productos con búsqueda full-text en español, filtros por categoría/proveedor, y paginación.

**Criterios de aceptación:**
- [x] Página `/productos` con tabla de productos: código, nombre, categoría, stock, costo, venta, margen
- [x] Búsqueda full-text con `textSearch('nombre', ...)` en español
- [x] Filtros por categoría y proveedor (dropdowns)
- [x] Paginación server-side
- [x] Página `/productos/nuevo` con formulario de creación
- [x] Página `/productos/[id]` con detalle, edición y historial de movimientos
- [x] Stock inicial opcional al crear (genera movimiento de entrada)
- [x] Soft-delete (`activo = false`)
- [x] Guard de rol: visor solo ve, no edita

**Notas técnicas:** Código de referencia en `stock.md`. Índice full-text `idx_producto_nombre` ya existe.

---

## V10-STOCK-004 — Registro de movimientos de stock (hecho)

- Tipo: feature
- Módulo: stock
- Prioridad: critical
- Estimación: 5
- Versión: v1.0
- Estado: done
- Dependencias: V10-STOCK-003

**Descripción:** Implementar el registro de movimientos (entrada, salida, ajuste) usando la función atómica `registrar_movimiento`, con página de historial.

**Criterios de aceptación:**
- [x] API route `POST /api/movimientos` llama a `registrar_movimiento` via RPC
- [x] API route `GET /api/movimientos` con filtros por producto y tipo
- [x] Página `/movimientos` con historial paginado
- [x] Componente de movimiento rápido en el detalle del producto
- [x] Validación: salida no puede dejar stock negativo (error de la función SQL)
- [x] Ajuste establece el valor absoluto
- [x] Cada movimiento graba `stock_anterior` y `stock_posterior`

**Notas técnicas:** Código en `stock.md`. La función SQL maneja atomicidad y `FOR UPDATE`.

---

## V10-STOCK-005 — Alertas de stock mínimo en el dashboard (hecho)

- Tipo: feature
- Módulo: stock
- Prioridad: high
- Estimación: 3
- Versión: v1.0
- Estado: done
- Dependencias: V10-STOCK-003

**Descripción:** Mostrar una card en el dashboard con productos que tienen stock por debajo del mínimo configurado.

**Criterios de aceptación:**
- [x] API route `GET /api/alertas/stock-bajo` retorna productos donde `stock_actual <= stock_minimo`
- [x] Card en el dashboard con badge de cantidad y lista de los primeros 5
- [x] Link "Ver todos" que filtra la tabla de productos
- [x] La card no se muestra si no hay productos con stock bajo

**Notas técnicas:** Componente `StockBajoCard` en `stock.md`.

---

## V10-STOCK-006 — Alertas de vencimiento de productos (hecho)

- Tipo: feature
- Módulo: stock
- Prioridad: high
- Estimación: 3
- Versión: v1.0
- Estado: done
- Dependencias: V10-STOCK-003

**Descripción:** Mostrar una card en el dashboard con productos que vencen en los próximos 30 días, con estados: vencido, crítico (7 días), próximo (30 días).

**Criterios de aceptación:**
- [x] API route `GET /api/alertas/vencimientos` con clasificación por estado
- [x] Card con badges por severidad (rojo=vencido, naranja=7 días, amarillo=30 días)
- [x] Muestra días restantes o "Venció hace X días"
- [x] La card no se muestra si no hay productos con vencimiento próximo

**Notas técnicas:** Componente `VencimientosCard` en `stock.md`.

---

## V10-STOCK-007 — Utilidades de formateo (moneda, fecha) (hecho)

- Tipo: feature
- Módulo: ui
- Prioridad: high
- Estimación: 1
- Versión: v1.0
- Estado: done
- Dependencias: V01-INFRA-001

**Descripción:** Crear funciones utilitarias de formateo para moneda argentina y fechas con locale `es-AR`.

**Criterios de aceptación:**
- [x] `formatCurrency(amount)` → `$1.234,56` formato ARS
- [x] `formatDate(date)` → `13/04/2026`
- [x] `formatDateTime(date)` → `13/04/2026, 14:30`
- [x] Ubicadas en `src/lib/utils/formatters.ts`

**Notas técnicas:** Usar `Intl.NumberFormat` y `Intl.DateTimeFormat`.

---

## V10-IMP-001 — Parseo de archivos Excel/CSV con SheetJS (hecho)

- Tipo: feature
- Módulo: importador
- Prioridad: critical
- Estimación: 3
- Versión: v1.0
- Estado: done
- Dependencias: V01-INFRA-002

**Descripción:** Implementar el parseo de archivos .xlsx/.xls/.csv en el browser usando SheetJS. Instalar la librería y crear la función de parseo.

**Criterios de aceptación:**
- [x] `xlsx` (SheetJS) instalado como dependencia
- [x] Función `parsearArchivo(file)` retorna headers + filas como objetos JSON
- [x] Soporta `.xlsx`, `.xls`, `.csv`
- [x] Maneja archivos vacíos con error descriptivo
- [x] Procesamiento 100% en el browser (no sube al servidor)

**Notas técnicas:** Código en `importador.md`.

---

## V10-IMP-002 — Normalizador de headers (diccionario de aliases) (hecho)

- Tipo: feature
- Módulo: importador
- Prioridad: critical
- Estimación: 3
- Versión: v1.0
- Estado: done
- Dependencias: V10-IMP-001

**Descripción:** Implementar el diccionario de aliases y la función de mapeo automático que detecta a qué campo del sistema corresponde cada columna del Excel.

**Criterios de aceptación:**
- [x] Diccionario con 10 campos y 60+ aliases en `src/lib/normalizador/aliases.ts`
- [x] Función `normalizarString` que normaliza a minúsculas sin tildes ni caracteres especiales
- [x] Función `mapearHeaders(headers)` retorna el mapeo con confianza (exacta, parcial, ninguna)
- [x] Función `aplicarPerfilProveedor` aplica un mapeo guardado previamente
- [x] "Precio Unit." matchea con `precio_venta`, "COD ART" con `codigo`, etc.

**Notas técnicas:** Código completo en `importador.md`.

---

## V10-IMP-003 — Pantalla de mapeo interactivo de columnas (hecho)

- Tipo: feature
- Módulo: importador
- Prioridad: critical
- Estimación: 5
- Versión: v1.0
- Estado: done
- Dependencias: V10-IMP-002

**Descripción:** Crear la UI de mapeo donde el usuario ve las columnas del archivo y puede confirmar o corregir la asignación a campos del sistema.

**Criterios de aceptación:**
- [x] Página `/importar/mapeo` muestra columnas del Excel ↔ campos del sistema
- [x] Iconos de confianza: check verde (exacta), warning amarillo (parcial), X roja (sin match)
- [x] Dropdown para cambiar la asignación de cada columna
- [x] Opción de "Ignorar columna"
- [x] Muestra ejemplo de la primera fila por cada columna
- [x] Validación: campo "Nombre" obligatorio
- [x] Botón "Continuar al preview" habilitado solo si hay al menos nombre mapeado

**Notas técnicas:** Componente `MapeoColumnas` en `importador.md`.

---

## V10-IMP-004 — Guardar perfil de mapeo en proveedor (hecho)

- Tipo: feature
- Módulo: importador
- Prioridad: high
- Estimación: 2
- Versión: v1.0
- Estado: done
- Dependencias: V10-IMP-003, V10-STOCK-002

**Descripción:** Permitir al usuario guardar el mapeo configurado como perfil del proveedor para reutilizar en futuras importaciones.

**Criterios de aceptación:**
- [x] Selector de proveedor en el paso de upload
- [x] Si el proveedor tiene perfil guardado, se aplica automáticamente
- [x] Checkbox "Guardar este mapeo para futuras importaciones"
- [x] Se guarda en `proveedor.mapeo_excel` como JSONB
- [x] En la próxima importación con ese proveedor, se salta el paso de mapeo

**Notas técnicas:** Función `guardarPerfilMapeo` en `importador.md`.

---

## V10-IMP-005 — Validación de datos y preview interactivo (hecho)

- Tipo: feature
- Módulo: importador
- Prioridad: critical
- Estimación: 5
- Versión: v1.0
- Estado: done
- Dependencias: V10-IMP-003

**Descripción:** Implementar la validación fila por fila y el preview editable donde el usuario puede corregir errores antes de confirmar.

**Criterios de aceptación:**
- [x] Función `validarFilas()` valida: nombre no vacío, precios numéricos positivos, stock enteros, fechas reconocibles
- [x] Parseo de precios argentinos: `$1.234,56` → `1234.56`
- [x] Parseo de fechas: `DD/MM/YYYY`, `DD-MM-YYYY`, `YYYY-MM-DD`
- [x] Preview con tabla editable: filas con error marcadas en rojo
- [x] Edición inline de celdas con error
- [x] Botón para descartar filas individuales
- [x] Contador: X válidas, Y con errores

**Notas técnicas:** Funciones `validarFilas` y componente `PreviewTable` en `importador.md`.

---

## V10-IMP-006 — API de ejecución de importación (upsert) (hecho)

- Tipo: feature
- Módulo: importador
- Prioridad: critical
- Estimación: 8
- Versión: v1.0
- Estado: done
- Dependencias: V10-IMP-005, V10-STOCK-004

**Descripción:** Implementar la API route que recibe las filas validadas y ejecuta el upsert: busca por código, actualiza o crea, registra movimientos y precio_historial, y guarda el log.

**Criterios de aceptación:**
- [x] API route `POST /api/importar/ejecutar` procesa array de filas
- [x] Upsert por `(tenant_id, codigo)`: si existe → UPDATE, si no → INSERT
- [x] Categorías se crean automáticamente si no existen (por nombre)
- [x] Si cambió precio, se registra en `precio_historial`
- [x] Si cambió stock, se registra movimiento de ajuste
- [x] Si producto nuevo tiene stock > 0, se registra movimiento de entrada
- [x] Se crea registro en `importacion_log` con métricas completas
- [x] Response: `{ productos_creados, productos_actualizados, filas_con_error, detalle_errores }`

**Notas técnicas:** Código completo de la API en `importador.md`.

---

## V10-IMP-007 — Componente de upload con drag & drop (hecho)

- Tipo: feature
- Módulo: importador
- Prioridad: high
- Estimación: 3
- Versión: v1.0
- Estado: done
- Dependencias: V10-IMP-001

**Descripción:** Crear el componente de upload de archivo con drag & drop y selección por click, con validación de extensión y tamaño.

**Criterios de aceptación:**
- [x] Zona de drop visual con icono y texto instructivo
- [x] Acepta drag & drop y click para seleccionar
- [x] Valida extensión (.xlsx, .xls, .csv) y tamaño (máx 10 MB)
- [x] Muestra loading mientras parsea
- [x] Muestra error si el archivo no es válido
- [x] Página `/importar` con este componente como primer paso del wizard

**Notas técnicas:** Componente `UploadArchivo` en `importador.md`.

---

## V10-IMP-008 — Resumen de importación y deduplicación (hecho)

- Tipo: feature
- Módulo: importador
- Prioridad: high
- Estimación: 3
- Versión: v1.0
- Estado: done
- Dependencias: V10-IMP-006

**Descripción:** Implementar la pantalla de resumen post-importación y la lógica de deduplicación de filas dentro del mismo archivo.

**Criterios de aceptación:**
- [x] Pantalla de resumen con 4 métricas: total, creados, actualizados, errores
- [x] Detalle de errores expandible
- [x] Links: "Ver productos" y "Importar otro archivo"
- [x] Deduplicación: si dos filas tienen el mismo código, se toma la última
- [x] Indicador de filas duplicadas descartadas

**Notas técnicas:** Componentes `ResumenImportacion` y función `deduplicarFilas` en `importador.md`.

---

## V10-IMP-009 — Plantilla Excel descargable (hecho)

- Tipo: feature
- Módulo: importador
- Prioridad: medium
- Estimación: 1
- Versión: v1.0
- Estado: done
- Dependencias: V01-INFRA-001

**Descripción:** Crear una plantilla Excel en `public/plantillas/` con las columnas predefinidas y un ejemplo, con link de descarga en la página de importación.

**Criterios de aceptación:**
- [x] Archivo `public/plantillas/plantilla_importacion.xlsx` con headers y 1 fila de ejemplo
- [x] Link "Descargar plantilla" visible en la página `/importar`
- [x] Columnas: Código, Nombre, Precio Costo, Precio Venta, Stock, Stock Mínimo, Categoría, Unidad, Vencimiento

**Notas técnicas:** Generar con SheetJS o crear manualmente.

---

# BLOQUE B — v1.5 (Facturador simple) y v2.0 (Lanzamiento)

---

## V15-FAC-001 — CRUD de clientes (hecho)

- Tipo: feature
- Módulo: facturacion
- Prioridad: critical
- Estimación: 5
- Versión: v1.5
- Estado: done ✅
- Dependencias: V01-UI-001, V01-AUTH-001

**Descripción:** Implementar el CRUD completo de clientes con datos fiscales (CUIT/DNI, condición IVA) necesarios para emitir comprobantes.

**Criterios de aceptación:**
- [x] Páginas `/clientes` (lista) y `/clientes/[id]` (detalle/edición)
- [x] API routes GET, POST, PATCH para clientes
- [x] Campos: nombre, razón social, CUIT/DNI, condición IVA, dirección, teléfono, email, notas
- [x] Búsqueda por nombre o CUIT
- [x] Soft-delete (activo = false)
- [x] Guard de módulo: requiere `facturador_simple`
- [x] Guard de rol: visor no puede crear/editar

**Notas técnicas:** La condición IVA del cliente determina qué tipo de factura se emite (A, B o C).

---

## V15-FAC-002 — Determinación automática del tipo de factura (hecho)

- Tipo: feature
- Módulo: facturacion
- Prioridad: critical
- Estimación: 2
- Versión: v1.5
- Estado: done ✅
- Dependencias: V15-FAC-001

**Descripción:** Implementar la lógica que determina automáticamente si corresponde Factura A, B o C según la condición IVA del emisor (tenant) y del receptor (cliente).

**Criterios de aceptación:**
- [x] Función `determinarTipoFactura(emisor, receptor)` retorna `factura_a`, `factura_b` o `factura_c`
- [x] RI → RI = Factura A
- [x] RI → CF/Mono/Exento = Factura B
- [x] Mono/Exento → cualquiera = Factura C
- [x] Al seleccionar cliente en el formulario de emisión, el tipo se pre-selecciona automáticamente

**Notas técnicas:** Código en `facturacion.md`.

---

## V15-FAC-003 — Cálculo de importes (subtotal, IVA, total) (hecho)

- Tipo: feature
- Módulo: facturacion
- Prioridad: critical
- Estimación: 2
- Versión: v1.5
- Estado: done ✅
- Dependencias: V15-FAC-002

**Descripción:** Implementar el cálculo de importes según el tipo de comprobante: IVA discriminado para Factura A, IVA incluido para B/C.

**Criterios de aceptación:**
- [x] Función `calcularImportes(items, tipo, ivaPorcentaje)` retorna subtotal, iva_monto, total
- [x] Factura A: subtotal neto + IVA discriminado (21%) = total
- [x] Factura B/C: total = subtotal (IVA incluido en precio)
- [x] Redondeo a 2 decimales en todos los cálculos
- [x] Items: cantidad × precio_unitario = subtotal por item

**Notas técnicas:** Código en `facturacion.md`.

---

## V15-FAC-004 — Generación de PDF con jsPDF (hecho)

- Tipo: feature
- Módulo: facturacion
- Prioridad: critical
- Estimación: 8
- Versión: v1.5
- Estado: done ✅
- Dependencias: V15-FAC-003

**Descripción:** Implementar el generador de PDF de comprobantes usando jsPDF con el layout definido: header con letra, datos emisor/receptor, tabla de items, totales, leyendas.

**Criterios de aceptación:**
- [x] `jspdf` instalado como dependencia
- [x] Función `generarPDF(emisor, cliente, comprobante, items)` retorna un `jsPDF`
- [x] Header: letra del comprobante (A/B/C), tipo y número con formato `PPPP-NNNNNNNN`
- [x] Datos del emisor: razón social, CUIT, domicilio, condición IVA
- [x] Datos del cliente: nombre, CUIT/DNI, condición IVA
- [x] Tabla de items con cant, descripción, precio unitario, subtotal
- [x] Totales: subtotal, IVA (si aplica), total
- [x] Paginación si los items superan una página
- [x] PDF generado es legible y profesional

**Notas técnicas:** Código completo en `facturacion.md`. El PDF se genera en el servidor (API route).

---

## V15-FAC-005 — Numeración secuencial atómica de comprobantes (hecho)

- Tipo: feature
- Módulo: facturacion
- Prioridad: critical
- Estimación: 2
- Versión: v1.5
- Estado: done ✅
- Dependencias: V01-DB-004

**Descripción:** Implementar el wrapper TypeScript para la función SQL `siguiente_numero_comprobante` y el formateo `PPPP-NNNNNNNN`.

**Criterios de aceptación:**
- [x] Función `obtenerSiguienteNumero(supabase, tenantId, tipo)` llama al RPC
- [x] Función `formatearNumeroComprobante(puntoDeVenta, numero)` → `"0001-00000045"`
- [x] Función `formatearTipoComprobante(tipo)` → `"Factura A"`, `"Remito"`, etc.
- [x] La numeración es secuencial por tenant y tipo (factura_a, factura_b, etc. tienen secuencias separadas)
- [x] El índice UNIQUE previene duplicados bajo concurrencia

**Notas técnicas:** Código en `facturacion.md`.

---

## V15-FAC-006 — API de emisión de comprobante (hecho)

- Tipo: feature
- Módulo: facturacion
- Prioridad: critical
- Estimación: 8
- Versión: v1.5
- Estado: done ✅
- Dependencias: V15-FAC-004, V15-FAC-005, V10-STOCK-004

**Descripción:** Implementar la API route completa de emisión que: verifica stock, calcula importes, obtiene número, crea comprobante + items, registra movimientos de salida, genera PDF, sube a Storage.

**Criterios de aceptación:**
- [x] API route `POST /api/facturacion/emitir` con los 12 pasos del flujo
- [x] Guard de módulo `facturador_simple`
- [x] Guard de rol (visor no puede emitir)
- [x] Verificación de stock antes de emitir (excepto presupuestos)
- [x] Descuento de stock por cada item (movimiento de salida con referencia `factura`)
- [x] Notas de crédito generan movimientos de entrada (devuelven stock)
- [x] Presupuestos no afectan stock
- [x] PDF subido a Supabase Storage en `{tenant_id}/comprobantes/`
- [x] URL del PDF guardada en `comprobante.pdf_url`
- [x] Response incluye datos del comprobante y URL del PDF

**Notas técnicas:** Código completo en `facturacion.md`. Bucket `comprobantes` debe existir en Storage.

---

## V15-FAC-007 — Crear bucket de Storage para comprobantes (hecho)

- Tipo: setup
- Módulo: facturacion
- Prioridad: critical
- Estimación: 1
- Versión: v1.5
- Estado: done ✅
- Dependencias: V01-INFRA-003

**Descripción:** Crear el bucket `comprobantes` en Supabase Storage con policies RLS para que cada tenant solo acceda a sus propios PDFs.

**Criterios de aceptación:**
- [x] Bucket `comprobantes` creado en Supabase Storage
- [x] Policy SELECT: solo puede leer archivos en su carpeta `{tenant_id}/`
- [x] Policy INSERT: solo puede subir archivos en su carpeta `{tenant_id}/`
- [x] Archivos no son públicos (se accede via URL firmada o policy)

**Notas técnicas:** Policies de Storage en `deploy.md`.

---

## V15-FAC-008 — UI formulario de emisión de comprobante (hecho)

- Tipo: feature
- Módulo: facturacion
- Prioridad: critical
- Estimación: 8
- Versión: v1.5
- Estado: done ✅
- Dependencias: V15-FAC-006, V15-FAC-001, V10-STOCK-003

**Descripción:** Crear la página `/facturacion/nueva` con el formulario interactivo: selección de tipo y cliente, agregar productos, ver totales en tiempo real, emitir.

**Criterios de aceptación:**
- [x] Selector de tipo de comprobante (Factura A/B/C, Remito, Presupuesto)
- [x] Selector de cliente con auto-determinación del tipo de factura
- [x] Buscador de productos para agregar al comprobante
- [x] Tabla de items con cantidad y precio editables
- [x] Cálculo en tiempo real de subtotal, IVA y total
- [x] Campo de notas opcional
- [x] Botón "Emitir" que llama a la API y muestra resultado
- [x] Después de emitir, redirige al detalle del comprobante

**Notas técnicas:** Componente `EmitirComprobante` en `facturacion.md`.

---

## V15-FAC-009 — Listado de comprobantes con filtros (hecho)

- Tipo: feature
- Módulo: facturacion
- Prioridad: high
- Estimación: 3
- Versión: v1.5
- Estado: done ✅
- Dependencias: V15-FAC-006

**Descripción:** Crear la página `/facturacion` con el listado de comprobantes emitidos, filtrable por tipo, estado y cliente.

**Criterios de aceptación:**
- [x] API route `GET /api/facturacion` con filtros y paginación
- [x] Tabla con: tipo+número, fecha, cliente, total, estado (badge de color)
- [x] Filtros por tipo de comprobante, estado y cliente
- [x] Ordenado por fecha descendente
- [x] Click en un comprobante lleva al detalle

**Notas técnicas:** Código en `facturacion.md`.

---

## V15-FAC-010 — Detalle de comprobante con descarga/impresión (hecho)

- Tipo: feature
- Módulo: facturacion
- Prioridad: high
- Estimación: 3
- Versión: v1.5
- Estado: done ✅
- Dependencias: V15-FAC-009

**Descripción:** Crear la página `/facturacion/[id]` con detalle completo del comprobante: datos, items, totales, estado, y botones de descarga/impresión del PDF.

**Criterios de aceptación:**
- [x] Muestra tipo + número formateado, fecha, cliente, items, totales
- [x] Badge de estado con color según valor
- [x] Botón "Descargar PDF" (link directo al archivo en Storage)
- [x] Botón "Imprimir" (abre PDF en nueva ventana)
- [x] Si tiene CAE (futuro), lo muestra en un banner verde

**Notas técnicas:** Componente `ComprobanteDetalle` en `facturacion.md`.

---

## V15-FAC-011 — Configuración del negocio (datos fiscales del tenant) (hecho)

- Tipo: feature
- Módulo: facturacion
- Prioridad: high
- Estimación: 3
- Versión: v1.5
- Estado: done ✅
- Dependencias: V01-UI-001

**Descripción:** Crear la página `/configuracion` donde el admin puede editar los datos fiscales del negocio: razón social, CUIT, domicilio, condición IVA, punto de venta, logo.

**Criterios de aceptación:**
- [x] Página `/configuracion` con formulario de datos del tenant
- [x] Campos: nombre, razón social, CUIT, domicilio, teléfono, email, condición IVA, punto de venta
- [ ] Upload de logo (sube a Supabase Storage) — pendiente, se implementará cuando se necesite
- [x] Solo admin puede editar
- [x] Los datos del tenant se usan en la generación de PDF

**Notas técnicas:** Actualiza la tabla `tenant`.

---

## V20-UI-001 — Dashboard con métricas y alertas (hecho)

- Tipo: feature
- Módulo: ui
- Prioridad: high
- Estimación: 5
- Versión: v2.0
- Estado: done
- Dependencias: V10-STOCK-005, V10-STOCK-006, V15-FAC-006

**Descripción:** Transformar el dashboard vacío en una página con cards de métricas: total de productos, valor del inventario, comprobantes del mes, y las alertas de stock bajo/vencimientos.

**Criterios de aceptación:**
- [x] Card: Total de productos activos
- [x] Card: Valor total del inventario (suma de stock_actual × precio_costo)
- [x] Card: Comprobantes emitidos este mes
- [x] Card: Ventas del mes (suma de totales de comprobantes)
- [x] Card de alerta: Stock bajo (ya implementada en V10-STOCK-005)
- [x] Card de alerta: Vencimientos (ya implementada en V10-STOCK-006)
- [x] Layout responsive: 2 columnas en desktop, 1 en móvil

**Notas técnicas:** Las métricas se obtienen con queries agregados via API routes.

---

## V20-UI-002 — Sistema de feature flags dinámico (sidebar + guards) (hecho)

- Tipo: feature
- Módulo: ui
- Prioridad: critical
- Estimación: 5
- Versión: v2.0
- Estado: done
- Dependencias: V01-UI-001

**Descripción:** Implementar el sistema de módulos dinámicos: sidebar que muestra/oculta items según `modulo_config`, guards en API routes y pages, hook `useModulos`.

**Criterios de aceptación:**
- [x] Hook `useModulos()` consulta `modulo_config` y expone flags booleanos
- [x] Sidebar dinámica: solo muestra items de módulos activos
- [x] `moduloGuard(modulo)` para API routes: retorna 403 si el módulo no está activo
- [x] `requireModulo(modulo)` para Server Components: redirige a `/` si no está activo
- [x] Acceder por URL a `/pedidos` sin el módulo activo redirige al dashboard

**Notas técnicas:** Código completo en `modulos.md`.

---

## V20-UI-003 — API y UI de cambio de plan (hecho)

- Tipo: feature
- Módulo: ui
- Prioridad: high
- Estimación: 3
- Versión: v2.0
- Estado: done
- Dependencias: V20-UI-002

**Descripción:** Implementar la página `/configuracion/plan` donde el admin puede ver su plan actual y upgradear/downgradear, con la función SQL `activar_plan`.

**Criterios de aceptación:**
- [x] Página `/configuracion/plan` muestra plan actual y módulos activos
- [x] Comparativa visual Plan Base vs Plan Completo
- [x] Botón "Cambiar a Plan Completo" / "Cambiar a Plan Base"
- [x] API route `POST /api/configuracion/plan` llama a `activar_plan` RPC
- [x] Solo admin puede cambiar el plan
- [x] Al cambiar plan, la sidebar se actualiza inmediatamente

**Notas técnicas:** Función SQL `activar_plan` en `modulos.md`. Migración `014_activar_plan.sql` en el repo.

---

## V20-UI-004 — Onboarding de primer uso (hecho)

- Tipo: feature
- Módulo: ui
- Prioridad: medium
- Estimación: 5
- Versión: v2.0
- Estado: done
- Dependencias: V15-FAC-011

**Descripción:** Crear un wizard de onboarding que guía al nuevo usuario en los primeros pasos: completar datos del negocio, crear la primera categoría, crear el primer producto.

**Criterios de aceptación:**
- [x] Detectar si es la primera vez (no hay productos ni datos fiscales completos)
- [x] Paso 1: Completar datos del negocio (razón social, CUIT, condición IVA)
- [x] Paso 2: Crear al menos una categoría
- [x] Paso 3: Crear el primer producto o importar un Excel
- [x] Opción de "Saltear" cada paso
- [x] No volver a mostrar si se completó o se salteó

**Notas técnicas:** Guardar estado del onboarding en localStorage o en un campo del tenant.

---

## V20-UI-005 — Responsive design completo (hecho)

- Tipo: feature
- Módulo: ui
- Prioridad: high
- Estimación: 5
- Versión: v2.0
- Estado: done
- Dependencias: V15-FAC-008, V10-STOCK-003

**Descripción:** Asegurar que toda la UI funciona correctamente en mobile y tablet: sidebar colapsable, tablas scrolleables, formularios adaptados.

**Criterios de aceptación:**
- [x] Sidebar se colapsa en un menú hamburguesa en pantallas < 768px
- [x] Tablas de productos, movimientos y comprobantes scroll horizontal en móvil
- [x] Formularios de emisión y creación usables en móvil
- [x] Dashboard cards apiladas en móvil
- [x] No hay overflow horizontal en ninguna página
- [x] Testeado en Chrome DevTools para iPhone SE, iPhone 14, iPad

**Notas técnicas:** Usar clases responsive de Tailwind (`sm:`, `md:`, `lg:`).

---

## V20-DEPLOY-001 — Deploy a producción en Vercel

- Tipo: setup
- Módulo: infra
- Prioridad: critical
- Estimación: 3
- Versión: v2.0
- Estado: todo
- Dependencias: V20-UI-005

**Descripción:** Configurar y ejecutar el primer deploy a producción en Vercel con todas las variables de entorno, dominio custom y SSL.

**Criterios de aceptación:**
- [ ] Proyecto importado en Vercel desde GitHub
- [ ] Variables de entorno configuradas (ver `deploy.md`)
- [ ] Build exitoso en Vercel
- [ ] Dominio custom configurado con SSL
- [ ] Login y registro funcionan en producción
- [ ] Datos aislados entre tenants verificado en producción

**Notas técnicas:** Checklist completa en `deploy.md`.

---

## V20-DEPLOY-002 — Checklist de go-live

- Tipo: docs
- Módulo: infra
- Prioridad: critical
- Estimación: 3
- Versión: v2.0
- Estado: todo
- Dependencias: V20-DEPLOY-001

**Descripción:** Verificar y completar toda la checklist de go-live antes de aceptar al primer cliente en producción.

**Criterios de aceptación:**
- [ ] RLS activo verificado en las 16 tablas
- [ ] Service role key no expuesta en cliente
- [ ] Rate limiting configurado en Supabase
- [ ] Email templates personalizados
- [ ] Bucket de Storage con policies
- [ ] Flujo completo testeado: registro → login → producto → Excel → factura
- [ ] Segundo tenant no ve datos del primero en producción
- [ ] Vercel Analytics habilitado

**Notas técnicas:** Checklist detallada en `deploy.md`.

---

## V20-TEST-001 — Tests de integración del flujo de facturación (hecho)

- Tipo: test
- Módulo: facturacion
- Prioridad: high
- Estimación: 5
- Versión: v2.0
- Estado: done
- Dependencias: V15-FAC-006

**Descripción:** Tests automatizados del flujo completo de facturación: crear cliente, crear productos, emitir factura, verificar stock descontado, verificar PDF generado.

**Criterios de aceptación:**
- [x] Test: emitir Factura C descuenta stock correctamente
- [x] Test: emitir Nota de Crédito devuelve stock
- [x] Test: presupuesto no afecta stock
- [x] Test: numeración secuencial sin huecos
- [x] Test: stock insuficiente rechaza la emisión
- [x] Tests pasan con `npm test`

**Notas técnicas:** Usar Vitest con el client de Supabase. Lógica de emisión en `src/lib/facturacion/emitir-comprobante.ts`; tests en `src/test/facturacion-integration.test.ts` (entorno `node`). PDF: smoke con `generarPDF` (buffer no vacío); emisión en tests sin subida a Storage.

---

## V20-TEST-002 — Tests del importador Excel (hecho)

- Tipo: test
- Módulo: importador
- Prioridad: high
- Estimación: 5
- Versión: v2.0
- Estado: done
- Dependencias: V10-IMP-006

**Descripción:** Tests del pipeline de importación: normalizador, validación, upsert, precio_historial, importacion_log.

**Criterios de aceptación:**
- [x] Test: normalizador detecta "COD ART" como `codigo`, "PVP" como `precio_venta`
- [x] Test: precios argentinos "$1.234,56" se parsean a 1234.56
- [x] Test: upsert crea producto si no existe, actualiza si existe
- [x] Test: precio_historial se registra cuando cambia un precio
- [x] Test: importacion_log tiene métricas correctas
- [x] Test: deduplicación toma la última fila con el mismo código

**Notas técnicas:** Crear archivos Excel de prueba con SheetJS en el test. Tests unitarios en `src/test/normalizador-import.test.ts`; integración y pipeline XLSX en `src/test/importacion-integration.test.ts`. Lógica de ejecución en `src/lib/importar/ejecutar-importacion.ts`.

---

## V20-UI-006 — Gestión de usuarios del tenant (hecho)

- Tipo: feature
- Módulo: auth
- Prioridad: medium
- Estimación: 5
- Versión: v2.0
- Estado: done
- Dependencias: V01-AUTH-003

**Descripción:** Permitir al admin del tenant invitar nuevos usuarios con roles (operador, visor) y gestionar usuarios existentes.

**Criterios de aceptación:**
- [x] Página `/configuracion/usuarios` lista usuarios del tenant
- [x] Formulario para invitar: email, nombre, apellido, rol
- [x] API crea auth user + registro en tabla `usuario` con el `tenant_id` del admin
- [x] Admin puede cambiar el rol de un usuario
- [x] Admin puede desactivar un usuario (activo = false)
- [x] Solo admin accede a esta página
- [x] Máximo 5 usuarios **activos** por tenant; al llegar al tope no se pueden enviar más invitaciones hasta desactivar a alguien

**Notas técnicas:** Invitación vía `auth.admin.inviteUserByEmail` + insert en `usuario` (service role); alternativa documentada: `createUser`. Límite de cupos: `USUARIOS_MAX_POR_TENANT` en `src/lib/limits.ts`, validado en `POST /api/configuracion/usuarios` antes de invitar (conteo `usuario` con `activo = true` por `tenant_id`).

---

# BLOQUE C — v3.0 (Pedidos + IA de precios) y v4.0 (Integración ARCA)

---

## V30-PED-001 — CRUD de pedidos (crear, listar, detalle) (hecho)

- Tipo: feature
- Módulo: pedidos
- Prioridad: critical
- Estimación: 8
- Versión: v3.0
- Estado: done
- Dependencias: V20-UI-002, V10-STOCK-003, V15-FAC-001

**Descripción:** Implementar la creación, listado y detalle de pedidos. Un pedido se arma seleccionando cliente, agregando productos con cantidades y precios, y se guarda como borrador.

**Criterios de aceptación:**
- [x] API route `POST /api/pedidos` crea pedido con items en estado `borrador`
- [x] API route `GET /api/pedidos` con filtros por estado y cliente, paginado
- [x] Página `/pedidos` con tabla: #pedido, cliente, fecha, items, total, estado (badge)
- [x] Página `/pedidos/nuevo` con formulario: selector de cliente, buscador de productos, tabla de items
- [x] Página `/pedidos/[id]` con detalle completo y acciones según estado
- [x] Guard de módulo: requiere `pedidos`
- [x] Guard de rol: visor no puede crear

**Notas técnicas:** Código completo en `pedidos.md`.

---

## V30-PED-002 — Máquina de estados del pedido (hecho)

- Tipo: feature
- Módulo: pedidos
- Prioridad: critical
- Estimación: 5
- Versión: v3.0
- Estado: done
- Dependencias: V30-PED-001

**Descripción:** Implementar las transiciones de estado del pedido: borrador → confirmado → entregado → (facturado), y borrador/confirmado → cancelado. Cada transición tiene efectos en stock.

**Criterios de aceptación:**
- [x] API route `PATCH /api/pedidos/[id]/estado` con validación de transiciones
- [x] Confirmar: valida que hay stock suficiente para todos los items
- [x] Entregar: descuenta stock via `registrar_movimiento` con referencia `pedido`
- [x] Cancelar: válido desde borrador o confirmado (no entregado)
- [x] Transiciones inválidas retornan 400 con mensaje claro
- [x] Botones de acción en la UI según estado actual

**Notas técnicas:** Mapa de transiciones y código en `pedidos.md`.

---

## V30-PED-003 — Stock comprometido (vista dinámica) (hecho)

- Tipo: feature
- Módulo: pedidos
- Prioridad: high
- Estimación: 3
- Versión: v3.0
- Estado: done
- Dependencias: V30-PED-002

**Descripción:** Implementar el cálculo de stock comprometido (pedidos confirmados no entregados) y mostrarlo en la UI de productos.

**Criterios de aceptación:**
- [x] Vista SQL `v_stock_comprometido` o query dinámica que suma cantidades de pedidos confirmados por producto
- [x] En el detalle del producto: "Stock actual: 100 | Comprometido: 25 | Disponible: 75"
- [x] En la tabla de productos: columna "Disponible" (stock_actual - comprometido)
- [x] Al confirmar un pedido, el stock comprometido se actualiza

**Notas técnicas:** Vista y función en `pedidos.md`.

---

## V30-PED-004 — Conversión de pedido a factura (hecho)

- Tipo: feature
- Módulo: pedidos
- Prioridad: high
- Estimación: 5
- Versión: v3.0
- Estado: done
- Dependencias: V30-PED-002, V15-FAC-006

**Descripción:** Permitir generar una factura desde un pedido entregado con un click. El stock no se descuenta de nuevo (ya se descontó al entregar). El comprobante se vincula al pedido.

**Criterios de aceptación:**
- [x] API route `POST /api/pedidos/[id]/facturar` crea comprobante desde pedido
- [x] Solo pedidos en estado `entregado` pueden facturarse
- [x] No descuenta stock de nuevo (ya se hizo al entregar)
- [x] El usuario elige tipo de factura (A/B/C)
- [x] Se genera PDF y se sube a Storage
- [x] `pedido.comprobante_id` se actualiza con el ID del comprobante
- [x] Un pedido no puede facturarse dos veces (409 si ya tiene `comprobante_id`)
- [x] En la UI, botón "Generar factura" visible solo en pedidos entregados sin factura

**Notas técnicas:** Código completo en `pedidos.md`.

---

## V30-PED-005 — Presupuestos y conversión a pedido/factura (hecho)

- Tipo: feature
- Módulo: pedidos
- Prioridad: high
- Estimación: 5
- Versión: v3.0
- Estado: done
- Dependencias: V30-PED-001, V15-FAC-006

**Descripción:** Los presupuestos son comprobantes tipo `presupuesto` que no afectan stock. Se pueden convertir a pedido (hereda items) o directamente a factura.

**Criterios de aceptación:**
- [x] Emitir presupuesto reutiliza el flujo de facturación con tipo `presupuesto`
- [x] API route `POST /api/presupuestos/[id]/convertir-a-pedido` crea pedido borrador con mismos items
- [x] API route `POST /api/presupuestos/[id]/convertir-a-factura` crea comprobante directo
- [x] Guard de módulo: requiere `presupuestos`
- [x] En listado de presupuestos, botones "Convertir a pedido" y "Convertir a factura"
- [x] El presupuesto original se conserva (no se borra)

**Notas técnicas:** Código en `pedidos.md`.

---

## V30-IA-001 — Cliente Gemini y prompt de extracción (hecho)

- Tipo: feature
- Módulo: ia
- Prioridad: critical
- Estimación: 3
- Versión: v3.0
- Estado: done
- Dependencias: V01-INFRA-002

**Descripción:** Implementar el cliente REST para Gemini 1.5 Pro y los prompts de extracción de precios desde PDF/imagen.

**Criterios de aceptación:**
- [x] Función `llamarGemini(prompt, archivo)` envía base64 + prompt y retorna texto
- [x] Temperatura 0.1 para máxima consistencia
- [x] `responseMimeType: 'application/json'` para forzar JSON
- [x] Max output tokens: 8192
- [x] Prompts definidos en `src/lib/ia/prompts.ts`
- [x] Manejo de errores: API key inválida, timeout, respuesta no-JSON

**Notas técnicas:** Código en `ia-precios.md`. Requiere variable `GEMINI_API_KEY`.

---

## V30-IA-002 — API de extracción desde PDF/imagen (hecho)

- Tipo: feature
- Módulo: ia
- Prioridad: critical
- Estimación: 5
- Versión: v3.0
- Estado: done
- Dependencias: V30-IA-001

**Descripción:** Implementar la API route que recibe un PDF o imagen, lo envía a Gemini, parsea la respuesta JSON y retorna productos normalizados listos para el preview.

**Criterios de aceptación:**
- [x] API route `POST /api/ia/extraer` acepta FormData con archivo
- [x] Valida formato (PDF, JPG, PNG, WebP) y tamaño (máx 20 MB)
- [x] Guard de módulo: requiere `ia_precios`
- [x] Convierte archivo a base64 y llama a Gemini
- [x] Parsea JSON de respuesta (con fallback si viene con texto extra)
- [x] Normaliza productos: trim, precios numéricos, filtra nombres vacíos
- [x] Response: `{ productos, total_extraidos, total_validos, archivo_nombre }`
- [x] Errores descriptivos si Gemini falla o no devuelve JSON válido

**Notas técnicas:** Código completo en `ia-precios.md`.

---

## V30-IA-003 — UI de extracción IA con preview reutilizado (hecho)

- Tipo: feature
- Módulo: ia
- Prioridad: high
- Estimación: 5
- Versión: v3.0
- Estado: done
- Dependencias: V30-IA-002, V10-IMP-005

**Descripción:** Crear la página `/ia-precios` con upload de PDF/imagen, indicador de progreso, y reutilización del preview de importación para revisar y confirmar los datos extraídos.

**Criterios de aceptación:**
- [x] Componente de upload específico para IA (acepta PDF, JPG, PNG, WebP)
- [x] Spinner/loader durante la extracción (5-30 segundos)
- [x] Los datos extraídos se muestran en el mismo `PreviewTable` del importador
- [x] El usuario puede editar, descartar filas y corregir precios
- [x] Al confirmar, llama a `POST /api/importar/ejecutar` con `origen: 'ia_pdf'`
- [x] Resumen final con métricas (creados, actualizados, errores)

**Notas técnicas:** Componente `ExtraerPrecios` en `ia-precios.md`. Reutiliza pipeline de importación.

---

## V30-IA-004 — Preview de cambios de precio (subieron/bajaron) (hecho)

- Tipo: feature
- Módulo: ia
- Prioridad: high
- Estimación: 3
- Versión: v3.0
- Estado: done
- Dependencias: V30-IA-003

**Descripción:** Cuando la importación IA actualiza productos existentes, mostrar un preview que resalta qué precios subieron, bajaron o se mantuvieron, con la variación porcentual.

**Criterios de aceptación:**
- [x] Componente `PrecioCambioPreview` con tabla: producto, precio anterior → nuevo, variación %
- [x] Filas coloreadas: rojo si subió, verde si bajó, gris si sin cambio
- [x] Resumen: "X subieron, Y bajaron, Z sin cambio"
- [x] Ordenado por mayor variación absoluta
- [x] Se muestra antes de confirmar la importación

**Notas técnicas:** Componente en `ia-precios.md`.

---

## V30-IA-005 — Historial de precios y sugerencia de márgenes (hecho)

- Tipo: feature
- Módulo: ia
- Prioridad: medium
- Estimación: 5
- Versión: v3.0
- Estado: done
- Dependencias: V30-IA-003

**Descripción:** Página de historial de precios con filtros, y función de sugerencia de precio de venta basada en el margen habitual del producto o de su categoría.

**Criterios de aceptación:**
- [x] API route `GET /api/precios/historial` con filtros por producto y origen
- [x] Página `/ia-precios/historial` con tabla: fecha, producto, origen (badge), costo ant/nuevo, venta ant/nuevo, margen
- [x] Filtros por origen (manual, excel, IA) y por producto
- [x] Función `sugerirPrecioVenta(supabase, productoId, nuevoCosto)` retorna precio sugerido
- [x] Lógica: margen actual del producto → margen promedio de la categoría → fallback 30%
- [x] En el preview de importación, mostrar precio sugerido junto al extraído

**Notas técnicas:** Código en `ia-precios.md`.

---

## V30-IA-006 — Límite mensual de extracciones IA por tenant (hecho)

- Tipo: feature
- Módulo: ia
- Prioridad: medium
- Estimación: 2
- Versión: v3.0
- Estado: done
- Dependencias: V30-IA-002

**Descripción:** Implementar un límite mensual de extracciones IA por tenant para controlar costos de la API de Gemini.

**Criterios de aceptación:**
- [x] Función `verificarLimiteIA(supabase)` cuenta registros de `importacion_log` con `origen = 'ia_pdf'` del mes actual
- [x] Límite default: 50 extracciones/mes (configurable)
- [x] Si se supera, la API retorna 429 con mensaje "Límite mensual de extracciones alcanzado"
- [x] En la UI, mostrar "X/50 extracciones usadas este mes"
- [x] Advertencia visual cuando quedan menos de 5

**Notas técnicas:** Código en `ia-precios.md`.

---

## V40-ARCA-001 — Configuración ARCA (certificados y datos) (hecho)

- Tipo: feature
- Módulo: arca
- Prioridad: critical
- Estimación: 5
- Versión: v4.0
- Estado: done
- Dependencias: V20-UI-002, V15-FAC-011

**Descripción:** Crear la página `/configuracion/arca` donde el admin sube certificado y clave privada, configura CUIT, punto de venta y ambiente. Los certificados se encriptan con AES-256-CBC antes de guardar.

**Criterios de aceptación:**
- [ ] Página `/configuracion/arca` con formulario
- [ ] Upload de certificado .pem y clave privada .key
- [ ] Campos: CUIT emisor, punto de venta, ambiente (homologación/producción)
- [ ] Los certificados se encriptan con `encriptarCampo()` antes del INSERT
- [ ] Guard de módulo: requiere `facturador_arca`
- [ ] Solo admin puede acceder
- [ ] Se guarda en tabla `arca_config` (UPSERT por tenant_id)

**Notas técnicas:** Funciones de crypto en `arca.md`.

---

## V40-ARCA-002 — Implementar WSAA (autenticación con certificado) (hecho)

- Tipo: feature
- Módulo: arca
- Prioridad: critical
- Estimación: 8
- Versión: v4.0
- Estado: done
- Dependencias: V40-ARCA-001

**Descripción:** Implementar el flujo completo de WSAA: construir TRA XML, firmar con CMS/PKCS#7, enviar a WSAA, parsear respuesta, guardar ticket.

**Criterios de aceptación:**
- [ ] Instalar `node-forge` para firma PKCS#7
- [ ] Función `obtenerTicketAcceso(cert, key, ambiente)` retorna token + sign + expiracion
- [ ] TRA XML con uniqueId, generationTime, expirationTime, service=wsfe
- [ ] Firma CMS con el certificado y clave privada del tenant
- [ ] Envío SOAP al endpoint de WSAA (homo o prod según config)
- [ ] Parseo de respuesta: extraer token, sign y expiration del XML
- [ ] Guardar ticket en `arca_config`
- [ ] Log de la operación en `arca_log`

**Notas técnicas:** Código en `arca.md`. WSAA endpoint cambia según ambiente.

---

## V40-ARCA-003 — Renovación automática de ticket WSAA (hecho)

- Tipo: feature
- Módulo: arca
- Prioridad: critical
- Estimación: 3
- Versión: v4.0
- Estado: done
- Dependencias: V40-ARCA-002

**Descripción:** Antes de cada operación con WSFE, verificar si el ticket sigue vigente (con 5 minutos de margen) y renovarlo si expiró.

**Criterios de aceptación:**
- [ ] Función `asegurarTicketVigente(supabase, tenantId)` verifica expiración
- [ ] Si faltan menos de 5 minutos para expirar, renueva proactivamente
- [ ] Si el ticket es válido, lo retorna sin hacer request a WSAA
- [ ] Si la renovación falla, lanza error descriptivo
- [ ] Log de renovación en `arca_log`

**Notas técnicas:** Código en `arca.md`.

---

## V40-ARCA-004 — Implementar WSFE (solicitar CAE) (hecho)

- Tipo: feature
- Módulo: arca
- Prioridad: critical
- Estimación: 8
- Versión: v4.0
- Estado: done
- Dependencias: V40-ARCA-003

**Descripción:** Implementar la operación `FECAESolicitar` de WSFE: construir XML del comprobante, enviar, parsear respuesta con CAE o errores.

**Criterios de aceptación:**
- [ ] Función `solicitarCAE(supabase, config, solicitud)` envía comprobante a ARCA
- [ ] XML builder con todos los campos: tipo cbte, pto venta, concepto, doc receptor, importes, alícuotas IVA
- [ ] Mapeo de tipos Nexus a códigos ARCA (factura_a=1, factura_b=6, factura_c=11, etc.)
- [ ] Mapeo de documento receptor (CUIT=80, DNI=96, sin_identificar=99)
- [ ] Parseo de respuesta: CAE, CAEFchVto, Resultado, Errores, Observaciones
- [ ] Timeout de 30 segundos en el request
- [ ] Log completo (request XML + response XML) en `arca_log`

**Notas técnicas:** XML builder y tipos en `arca.md`.

---

## V40-ARCA-005 — Integrar ARCA en el flujo de emisión (hecho)

- Tipo: feature
- Módulo: arca
- Prioridad: critical
- Estimación: 5
- Versión: v4.0
- Estado: done
- Dependencias: V40-ARCA-004, V15-FAC-006

**Descripción:** Extender la API de emisión de comprobantes para que, si el módulo `facturador_arca` está activo, solicite CAE después de crear el comprobante. Manejar los 3 escenarios: aprobado, rechazado, timeout.

**Criterios de aceptación:**
- [ ] Si `modulo_config.facturador_arca = true`, después de emitir localmente se solicita CAE
- [ ] Si ARCA aprueba: guardar CAE + vencimiento, regenerar PDF con CAE, estado = `emitido`
- [ ] Si ARCA rechaza: estado = `error_arca`, guardar errores en `arca_log`, notificar al usuario
- [ ] Si timeout/error de red: estado = `pendiente_arca`, entra a cola de reintentos
- [ ] Si ARCA no está activo, el flujo sigue igual que antes (facturador simple)
- [ ] El comprobante local siempre se crea (la operación del negocio no se bloquea)

**Notas técnicas:** Diagrama de estados en `arca.md`.

---

## V40-ARCA-006 — Consultar último comprobante en ARCA (hecho)

- Tipo: feature
- Módulo: arca
- Prioridad: high
- Estimación: 2
- Versión: v4.0
- Estado: done
- Dependencias: V40-ARCA-004

**Descripción:** Implementar la operación `FECompUltimoAutorizado` para sincronizar la numeración local con ARCA y detectar inconsistencias.

**Criterios de aceptación:**
- [ ] Función `consultarUltimoComprobante(supabase, config, tipo)` retorna el último número
- [ ] Botón "Sincronizar numeración" en `/configuracion/arca`
- [ ] Si hay discrepancia entre local y ARCA, mostrar advertencia
- [ ] Actualizar `arca_config.ultimo_comprobante` con el valor de ARCA

**Notas técnicas:** XML en `arca.md`.

---

## V40-ARCA-007 — Cola de reintentos con Edge Function cron (hecho)

- Tipo: feature
- Módulo: arca
- Prioridad: critical
- Estimación: 5
- Versión: v4.0
- Estado: done
- Dependencias: V40-ARCA-005

**Descripción:** Crear la Edge Function que corre cada 15 minutos y procesa comprobantes en estado `pendiente_arca`, reintentando hasta 3 veces.

**Criterios de aceptación:**
- [ ] Edge Function `reintentar-arca` en `supabase/functions/`
- [ ] Cron cada 15 minutos via configuración de Supabase
- [ ] Busca comprobantes con `estado = 'pendiente_arca'` (máx 10 por ciclo)
- [ ] Cuenta reintentos previos en `arca_log`
- [ ] Si < 3 reintentos: intenta solicitar CAE de nuevo
- [ ] Si >= 3 reintentos: marca como `error_arca` y registra en log
- [ ] Variables de entorno configuradas: `SUPABASE_SERVICE_ROLE_KEY`, `ARCA_ENCRYPTION_KEY`

**Notas técnicas:** Código en `arca.md`.

---

## V40-ARCA-008 — Regenerar PDF con CAE y código de barras (hecho)

- Tipo: feature
- Módulo: arca
- Prioridad: high
- Estimación: 3
- Versión: v4.0
- Estado: done
- Dependencias: V40-ARCA-005

**Descripción:** Cuando ARCA aprueba un comprobante, regenerar el PDF incluyendo el CAE, fecha de vencimiento del CAE, y el código de barras fiscal.

**Criterios de aceptación:**
- [ ] El PDF incluye sección "CAE: XXXXXXXXXXXXXXXX" y "Vencimiento CAE: DD/MM/YYYY"
- [ ] El PDF regenerado reemplaza al anterior en Supabase Storage
- [ ] `comprobante.pdf_url` se actualiza con la nueva versión
- [ ] La función `generarPDF` ya acepta datos de CAE (implementado en V15-FAC-004)

**Notas técnicas:** El generador de PDF ya tiene soporte para CAE. Solo hay que llamarlo de nuevo después de obtener el CAE.

---

## V40-ARCA-009 — Alerta de vencimiento de certificado ARCA (hecho)

- Tipo: feature
- Módulo: arca
- Prioridad: medium
- Estimación: 2
- Versión: v4.0
- Estado: done
- Dependencias: V40-ARCA-001

**Descripción:** Verificar la fecha de vencimiento del certificado ARCA y alertar al admin cuando faltan 30 días o menos.

**Criterios de aceptación:**
- [ ] Función `verificarVencimientoCertificado(pem)` retorna días restantes y si es válido
- [ ] Alerta en el dashboard si faltan <= 30 días
- [ ] Banner en `/configuracion/arca` con mensaje de urgencia si faltan <= 7 días
- [ ] Si el certificado ya expiró, mostrar error y bloquear emisión ARCA

**Notas técnicas:** Código en `arca.md`. Usar `crypto.X509Certificate` de Node.js.

---

## V40-ARCA-010 — Botón "Probar conexión" con ARCA (hecho)

- Tipo: feature
- Módulo: arca
- Prioridad: high
- Estimación: 2
- Versión: v4.0
- Estado: done
- Dependencias: V40-ARCA-002

**Descripción:** En la página de configuración ARCA, agregar un botón que testea la conexión: intenta obtener un ticket WSAA y consultar el último comprobante.

**Criterios de aceptación:**
- [ ] Botón "Probar conexión" en `/configuracion/arca`
- [ ] Intenta: 1) obtener ticket WSAA, 2) consultar `FECompUltimoAutorizado`
- [ ] Si éxito: mensaje verde con "Conexión exitosa. Último comprobante: #XXX"
- [ ] Si falla WSAA: mensaje rojo con detalle del error
- [ ] Si falla WSFE: mensaje naranja con detalle
- [ ] Log de la prueba en `arca_log`

**Notas técnicas:** Usa las funciones de `wsaa.ts` y `wsfe.ts`.

---

## V40-TEST-001 — Tests de integración ARCA contra homologación (hecho)

- Tipo: test
- Módulo: arca
- Prioridad: high
- Estimación: 8
- Versión: v4.0
- Estado: done
- Dependencias: V40-ARCA-005

**Descripción:** Tests end-to-end contra el ambiente de homologación de ARCA. Requiere certificado de homologación configurado.

**Criterios de aceptación:**
- [ ] Test: obtener ticket WSAA con certificado de homologación
- [ ] Test: consultar último comprobante con `FECompUltimoAutorizado`
- [ ] Test: emitir Factura C y obtener CAE válido
- [ ] Test: emitir Factura B y obtener CAE válido
- [ ] Test: emitir Nota de Crédito y obtener CAE válido
- [ ] Test: enviar datos inválidos y verificar que ARCA rechaza con error descriptivo
- [ ] Tests se ejecutan solo con flag especial (no en CI normal): `npm test -- --group=arca`

**Notas técnicas:** Requiere certificado de homologación. Ver instrucciones en `deploy.md`.

---

## V40-TEST-002 — Tests de la cola de reintentos (hecho)

- Tipo: test
- Módulo: arca
- Prioridad: high
- Estimación: 3
- Versión: v4.0
- Estado: done
- Dependencias: V40-ARCA-007

**Descripción:** Tests que verifican el comportamiento de la cola de reintentos: reintento exitoso, máximo de reintentos, transición a `error_arca`.

**Criterios de aceptación:**
- [ ] Test: comprobante `pendiente_arca` es procesado por la cola
- [ ] Test: después de 3 reintentos fallidos, pasa a `error_arca`
- [ ] Test: reintento exitoso actualiza CAE y estado a `emitido`
- [ ] Test: la cola procesa máximo 10 comprobantes por ciclo

**Notas técnicas:** Mockear las respuestas de ARCA para simular timeouts y errores.

---

# BLOQUE E — v5.0 (Analizador de Listas, Rentabilidad e IA)

---

## V50-ANAL-001 — Migración: tablas lista_precios y lista_precios_item (hecho)

- Tipo: migration
- Módulo: analizador
- Prioridad: critical
- Estimación: 5
- Versión: v5.0
- Estado: done
- Dependencias: V15-FAC-006

**Descripción:** Crear las tablas que convierten a la lista de precios en una entidad de primera clase del sistema. Una lista de precios es un documento (PDF/Excel) subido por el usuario que contiene los precios de un proveedor, con fecha, vigencia y estado. Cada item de la lista puede matchearse o no con un producto existente.

**Criterios de aceptación:**
- [x] Tabla `lista_precios` creada con RLS y todos los campos de origen, estado, métricas globales y resumen IA
- [x] Tabla `lista_precios_item` creada con RLS y campos de matching, análisis y decisión
- [x] Índices en `(tenant_id, proveedor_id)`, `(tenant_id, fecha_recepcion)`, `(lista_id)` y `(producto_id)`
- [x] Trigger `moddatetime` en `lista_precios`
- [x] Migración ejecuta sin errores sobre el schema existente

**Notas técnicas:** La lista es persistente. Los campos de análisis (`variacion_pct`, `margen_actual_pct`, etc.) se llenan después del matching y del análisis.

---

## V50-ANAL-002 — Migración: tabla producto_proveedor (N:N) (hecho)

- Tipo: migration
- Módulo: analizador
- Prioridad: critical
- Estimación: 3
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-001

**Descripción:** Crear la tabla de relación N:N entre productos y proveedores para permitir comparación de costos alternativos por proveedor.

**Criterios de aceptación:**
- [x] Tabla `producto_proveedor` creada con `UNIQUE(tenant_id, producto_id, proveedor_id)`
- [x] RLS con policy de `tenant_isolation`
- [x] Índices en `(tenant_id, producto_id)` y `(tenant_id, proveedor_id)`
- [x] Trigger `moddatetime`

**Notas técnicas:** No reemplaza `producto.proveedor_id`; agrega costos alternativos e histórico de relación por proveedor.

---

## V50-ANAL-003 — Migración: columna precio_costo en comprobante_item (hecho)

- Tipo: migration
- Módulo: analizador
- Prioridad: critical
- Estimación: 3
- Versión: v5.0
- Estado: done
- Dependencias: V15-FAC-006

**Descripción:** Agregar `precio_costo` a `comprobante_item` para capturar el costo real al momento de vender y habilitar rentabilidad histórica.

**Criterios de aceptación:**
- [x] Columna `precio_costo` agregada a `comprobante_item`
- [x] Backfill ejecutado para registros existentes usando `producto.precio_costo`
- [x] `src/lib/facturacion/emitir-comprobante.ts` graba `precio_costo` al crear items
- [x] La facturación desde pedido también graba `precio_costo`
- [x] Tipos TypeScript de `ComprobanteItem` actualizados

**Notas técnicas:** El costo debe tomarse del producto al momento de emitir, no recalcularse después.

---

## V50-ANAL-004 — Migración: tablas cuenta_corriente y pago (hecho)

- Tipo: migration
- Módulo: analizador
- Prioridad: high
- Estimación: 5
- Versión: v5.0
- Estado: done
- Dependencias: V15-FAC-001

**Descripción:** Crear el subdominio de cuenta corriente de clientes y el registro de pagos.

**Criterios de aceptación:**
- [x] Tablas `cuenta_corriente` y `pago` creadas con RLS
- [x] Función `registrar_pago` implementada como `SECURITY DEFINER`
- [x] Vista `v_clientes_morosos` funcional
- [x] Al emitir factura se genera o actualiza deuda en cuenta corriente
- [x] Integración documentada en el flujo de facturación

**Notas técnicas:** La cuenta corriente se crea lazy, al primer comprobante o pago.

---

## V50-ANAL-005 — Migración: cierre_mensual, radar_inflacion y flag de módulo (hecho)

- Tipo: migration
- Módulo: analizador
- Prioridad: high
- Estimación: 5
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-003

**Descripción:** Crear las tablas de soporte para cierres mensuales, radar cross-tenant y el flag `analizador_rentabilidad` en `modulo_config`.

**Criterios de aceptación:**
- [x] Tabla `cierre_mensual` con RLS y `UNIQUE(tenant_id, periodo)`
- [x] Tabla `radar_inflacion` con RLS especial para lectura y contribución autenticada
- [x] Función `contribuir_radar` con UPSERT ponderado
- [x] Flag `analizador_rentabilidad` agregado a `modulo_config`
- [x] `activar_plan` actualizado para activar/desactivar el módulo según plan
- [x] Tipos y defaults de módulos actualizados en TypeScript

**Notas técnicas:** El radar es opt-in y solo maneja agregados anonimizados.

---

## V50-ANAL-006 — Actualizar flujo de emisión para grabar precio_costo y deuda (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: critical
- Estimación: 3
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-003, V50-ANAL-004

**Descripción:** Adaptar la emisión de comprobantes para registrar costo real por línea y actualizar cuenta corriente.

**Criterios de aceptación:**
- [x] Cada `comprobante_item` guarda `precio_costo` al emitir
- [x] La facturación desde pedido también guarda `precio_costo`
- [x] Facturas suman deuda a `cuenta_corriente`
- [x] Notas de crédito restan deuda
- [x] Si no existe cuenta corriente, se crea automáticamente
- [x] Tipos TypeScript actualizados

**Notas técnicas:** El orden del flujo pasa a ser: crear comprobante, crear items con costo, registrar movimientos, actualizar deuda.

---

## V50-ANAL-007 — Carga y extracción de lista de precios (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: critical
- Estimación: 5
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-001, V30-IA-001

**Descripción:** Permitir subir una lista de proveedor en PDF, imagen o Excel/CSV, extraer sus items y crear la entidad persistente `lista_precios`.

**Criterios de aceptación:**
- [x] `POST /api/analizador/listas` acepta PDF, Excel, CSV, JPG, PNG y WebP
- [x] Para Excel/CSV reutiliza SheetJS y normalizador existente
- [x] Para PDF/imagen reutiliza Gemini
- [x] El archivo original se sube a Storage en bucket `listas-precios`
- [x] Se crea `lista_precios` con metadata y `estado: 'pendiente'`
- [x] Se crean `lista_precios_item` con nombre, costo, código y unidad
- [x] `GET /api/analizador/listas` y `GET /api/analizador/listas/[id]` funcionan
- [x] Guard de módulo `analizador_rentabilidad`
- [x] Si se usa IA, cuenta contra el límite mensual

**Notas técnicas:** A diferencia del importador, acá no se impacta stock todavía; primero se analiza y decide.

---

## V50-ANAL-008 — Motor de matching: lista vs productos existentes (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: critical
- Estimación: 8
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-007

**Descripción:** Implementar el cruce automático entre items de una lista y productos del tenant en tres niveles: código exacto, nombre normalizado e IA fuzzy.

**Criterios de aceptación:**
- [x] `POST /api/analizador/listas/[id]/matching` ejecuta matching en 3 niveles
- [x] Código exacto produce `confidence = 1.0`
- [x] Nombre normalizado produce `confidence = 0.95`
- [x] Fuzzy matching usa Gemini solo para los no resueltos
- [x] Optimización por batch para requests a Gemini
- [x] Cada item se actualiza con `producto_id`, `match_confidence` y `match_metodo`
- [x] La respuesta agrupa en `matcheados`, `dudosos` y `nuevos`
- [x] `lista_precios` actualiza contadores de matching
- [x] Cuenta contra el límite mensual de IA

**Notas técnicas:** El objetivo es minimizar falsos positivos; se acepta perder matches dudosos antes que contaminar el análisis.

---

## V50-ANAL-009 — Análisis de impacto y cálculo de márgenes por lista (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: critical
- Estimación: 5
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-008

**Descripción:** Calcular variación de costos, impacto en márgenes y sugerencias de venta sobre cada item matcheado y sobre la lista completa.

**Criterios de aceptación:**
- [x] Calcula variación de costo por item versus costo actual
- [x] Calcula margen actual y margen nuevo sin tocar precio de venta
- [x] Reutiliza `sugerirPrecioVenta()` para precio sugerido
- [x] Calcula métricas globales e impacto por categoría
- [x] Actualiza `lista_precios_item` con datos de análisis
- [x] Actualiza `lista_precios` con métricas globales
- [x] Cambia estado de la lista a `analizada`
- [x] Excluye del impacto global los items sin match, pero los reporta

**Notas técnicas:** Es cálculo determinístico y debe poder re-ejecutarse sin costo.

---

## V50-ANAL-010 — Reporte IA ejecutivo por lista (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: high
- Estimación: 5
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-009, V30-IA-001

**Descripción:** Generar un resumen ejecutivo con IA sobre la lista analizada, recomendaciones y patrones del proveedor.

**Criterios de aceptación:**
- [x] Genera resumen, observaciones, recomendaciones y alertas
- [x] Compara contra listas anteriores del mismo proveedor si existen
- [x] Detecta categorías más afectadas y patrones de frecuencia/aumento
- [x] Guarda el resultado en `lista_precios.resumen_ia`
- [x] Es opcional: el análisis numérico funciona sin este paso
- [x] Cuenta contra el límite mensual de IA

**Notas técnicas:** Es una capa de valor agregado sobre el análisis determinístico.

---

## V50-ANAL-011 — Simulador de precios de venta (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: critical
- Estimación: 8
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-009

**Descripción:** Crear un simulador interactivo client-side para probar estrategias de precios antes de aplicar la lista.

**Criterios de aceptación:**
- [x] `GET /api/analizador/listas/[id]/simular` retorna datos listos para simular
- [x] Implementa modos: mantener margen, margen fijo, aumento fijo, piso de margen y manual
- [x] Resume en vivo margen global simulado, márgenes bajos y aumento promedio al público
- [x] El usuario puede editar precios individualmente
- [x] Los precios decididos se guardan en `lista_precios_item.precio_venta_decidido`

**Notas técnicas:** El cálculo debe vivir en funciones puras reutilizables en React state.

---

## V50-ANAL-012 — Aplicación de lista (total o parcial) (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: critical
- Estimación: 5
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-011

**Descripción:** Aplicar una lista al catálogo actualizando costos, ventas opcionales, historial, relación producto-proveedor y radar.

**Criterios de aceptación:**
- [x] Soporta aplicación total y parcial
- [x] Cada cambio genera `precio_historial` con origen `lista_precios`
- [x] Hace upsert en `producto_proveedor`
- [x] Puede usar `precio_venta_decidido` del simulador
- [x] Puede contribuir a `radar_inflacion`
- [x] Cambia el estado de la lista a `aplicada_total` o `aplicada_parcial`
- [x] Retorna resumen con actualizados, creados y errores

**Notas técnicas:** Debe ser una operación atómica.

---

## V50-ANAL-013 — UI completa del flujo Cargo → Analizo → Decido → Importo (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: critical
- Estimación: 13
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-007, V50-ANAL-008, V50-ANAL-009, V50-ANAL-010, V50-ANAL-011, V50-ANAL-012

**Descripción:** Construir la UI principal del analizador con upload, revisión de matching, resumen IA, simulador y aplicación.

**Criterios de aceptación:**
- [x] Página `/analizador/listas` con filtros y badges de estado
- [x] Página `/analizador/listas/nueva` con upload y extracción
- [x] Página `/analizador/listas/[id]` con cards de métricas, matching review, resumen IA y simulador
- [x] Tabla interactiva con checkboxes por fila e inputs editables
- [x] Colores semafóricos por margen
- [x] Botones `Aplicar`, `Archivar` y `Exportar PDF`
- [x] Responsive en mobile/tablet

**Notas técnicas:** Es el ticket más grande del bloque; conviene dividirlo en entregas internas si hace falta.

---

## V50-ANAL-014 — Comparación de proveedores (API + lógica) (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: high
- Estimación: 8
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-002, V50-ANAL-012

**Descripción:** Comparar proveedores para un mismo producto o categoría usando `producto_proveedor`, listas históricas y estabilidad de aumentos.

**Criterios de aceptación:**
- [x] `GET /api/analizador/proveedores/comparar` retorna score comparativo
- [x] Score ponderado por precio, estabilidad y frecuencia de aumentos
- [x] `GET /api/analizador/proveedores/[id]/perfil` retorna historial, tendencia y predicción
- [x] La predicción usa regresión lineal simple sobre listas previas
- [x] Guard de módulo

---

## V50-ANAL-015 — Comparación temporal: mismo proveedor en el tiempo (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: high
- Estimación: 5
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-012

**Descripción:** Comparar listas sucesivas del mismo proveedor para detectar patrones de aumento, estabilidad y frecuencia de envío.

**Criterios de aceptación:**
- [x] Compara 2 o más listas del mismo proveedor
- [x] Genera evolución de precio por producto cruzando por `producto_id`
- [x] Identifica productos inflacionarios y estables
- [x] Calcula aumento acumulado, promedio por lista y días entre listas

---

## V50-ANAL-016 — Margen real por producto y alertas (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: high
- Estimación: 5
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-003

**Descripción:** Calcular margen real desde ventas históricas y generar alertas cuando cae respecto del promedio.

**Criterios de aceptación:**
- [x] `GET /api/analizador/margen` calcula margen desde `comprobante_item`
- [x] Evolución mensual por producto o categoría
- [x] Tendencia basada en últimos 3 meses
- [x] Alertas cuando el margen cae más de 5% frente al promedio reciente
- [x] Ranking por contribución absoluta
- [x] Guard de módulo

---

## V50-ANAL-017 — Productos estrella vs. lastre (ranking BCG) (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: medium
- Estimación: 3
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-016

**Descripción:** Clasificar productos por rentabilidad y rotación con una matriz BCG simplificada.

**Criterios de aceptación:**
- [x] `GET /api/analizador/ranking` retorna score por margen y rotación
- [x] Clasificación: `estrella`, `vaca`, `interrogacion`, `lastre`
- [x] Filtrado por período y categoría
- [x] Top 10 estrellas y lastres destacados

---

## V50-ANAL-018 — Forecast de reposición con estacionalidad (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: medium
- Estimación: 8
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-016, V50-ANAL-014

**Descripción:** Estimar cuándo y cuánto reponer usando consumo histórico, estacionalidad y score de proveedor.

**Criterios de aceptación:**
- [x] Velocidad de consumo calculada desde movimientos de salida
- [x] Ajuste por estacionalidad si hay suficiente historia
- [x] Sugiere fecha y cantidad de compra
- [x] Sugiere proveedor por score de `producto_proveedor`
- [x] Calcula costo estimado de reposición
- [x] Puede complementar con IA opcional para insights

---

## V50-ANAL-019 — Comparación de presupuestos de proveedores (N listas simultáneas) (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: high
- Estimación: 8
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-008, V30-IA-001

**Descripción:** Comparar 2 a 5 listas de distintos proveedores en simultáneo, cruzando items equivalentes con ayuda de IA.

**Criterios de aceptación:**
- [x] Acepta 2 a 5 listas ya cargadas o archivos nuevos
- [x] Cruza items equivalentes entre listas con matching asistido por IA
- [x] Tabla comparativa con filas por producto y columnas por proveedor
- [x] Mejor precio resaltado por fila
- [x] Resume ahorro potencial comprando siempre al mejor proveedor
- [x] Puede persistir datos en `producto_proveedor`
- [x] Cuenta contra límite de IA

---

## V50-ANAL-020 — Alertas de oportunidad e inflación (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: medium
- Estimación: 3
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-014, V50-ANAL-005

**Descripción:** Generar alertas sobre proveedores que no enviaron listas nuevas y exponer el radar de inflación cross-tenant.

**Criterios de aceptación:**
- [x] `GET /api/analizador/alertas/oportunidades` detecta probables aumentos por frecuencia histórica
- [x] `GET /api/analizador/radar` expone agregados anonimizados por rubro y proveedor
- [x] Solo visible si el tenant tiene opt-in al radar

---

## V50-ANAL-021 — Cierre mensual y dashboard de rentabilidad (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: high
- Estimación: 8
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-005, V50-ANAL-016, V50-ANAL-017

**Descripción:** Construir el dashboard principal del módulo y el cierre mensual cacheado por período.

**Criterios de aceptación:**
- [x] Cierre mensual automático y cacheado en `cierre_mensual`
- [x] Cards de ventas, costos, margen bruto y margen %
- [x] Gráfico de evolución del margen últimos 6 meses con Recharts
- [x] Top productos, categorías y clientes
- [x] Actividad de listas y pendientes de aplicar
- [ ] Exportable a PDF
- [x] Guard de módulo

---

## V50-ANAL-022 — UI de comparación de proveedores (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: medium
- Estimación: 5
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-014, V50-ANAL-019

**Descripción:** Construir `/analizador/proveedores` con comparación y perfiles de proveedor.

**Criterios de aceptación:**
- [x] Selector de producto o categoría
- [x] Tabla comparativa con scores y precios
- [x] Cards de perfil con historial, tendencia y predicción
- [x] Acceso rápido a comparación de listas
- [x] Radar de inflación si hay opt-in

---

## V50-ANAL-023 — UI de forecast de reposición (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: medium
- Estimación: 3
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-018

**Descripción:** Construir `/analizador/reposicion` con tabla ordenada por urgencia de compra.

**Criterios de aceptación:**
- [x] Tabla con producto, stock, consumo, días restantes, fecha sugerida, cantidad y proveedor
- [x] Filtros por categoría y proveedor
- [x] Botón para derivar a pedido de compra
- [x] Costo total estimado visible en header
- [ ] Insights IA opcionales

---

## V50-ANAL-024 — Margen en tiempo real al emitir factura (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: medium
- Estimación: 3
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-006

**Descripción:** Mostrar margen por línea y margen total al emitir un comprobante.

**Criterios de aceptación:**
- [x] En `/facturacion/nueva`, cada línea muestra costo, venta y margen %
- [x] Margen total del comprobante visible en vivo
- [x] Descuentos recalculan el margen instantáneamente
- [x] Color semafórico según margen
- [x] Visible solo para admin y operador
- [x] Requiere módulo `analizador_rentabilidad`

---

## V50-ANAL-025 — Alertas del analizador en dashboard + UI de cuenta corriente (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: medium
- Estimación: 3
- Versión: v5.0
- Estado: done
- Dependencias: V50-ANAL-020, V50-ANAL-016, V50-ANAL-018, V50-ANAL-004

**Descripción:** Integrar alertas del analizador al dashboard principal y sumar cuenta corriente a la ficha del cliente.

**Criterios de aceptación:**
- [x] Card de productos con margen en caída
- [x] Card de productos con reposición próxima
- [x] Card de oportunidad por proveedor sin lista reciente
- [x] Card de listas pendientes de analizar o aplicar
- [x] Visible solo si el módulo está activo
- [x] En `/clientes/[id]`, pestaña `Cuenta corriente` con saldo, límite, historial y registro de pagos
- [x] Advertencia si el cliente excede su límite de crédito al facturar

---

## Resumen de tickets y esfuerzo

| Fase | Ticket | Descripción | Pts |
|---|---|---|---|
| 1 | V50-ANAL-001 | Migración: lista_precios y lista_precios_item | 5 |
| 1 | V50-ANAL-002 | Migración: producto_proveedor (N:N) | 3 |
| 1 | V50-ANAL-003 | Migración: precio_costo en comprobante_item | 3 |
| 1 | V50-ANAL-004 | Migración: cuenta_corriente y pagos | 5 |
| 1 | V50-ANAL-005 | Migración: cierre_mensual, radar_inflacion y flag módulo | 5 |
| 1 | V50-ANAL-006 | Actualizar emisión para grabar precio_costo y deuda | 3 |
| 1 | **Subtotal Fase 1** | | **24** |
| 2 | V50-ANAL-007 | Carga y extracción de lista de precios | 5 |
| 2 | V50-ANAL-008 | Motor de matching: lista vs productos existentes | 8 |
| 2 | V50-ANAL-009 | Análisis de impacto y cálculo de márgenes por lista | 5 |
| 2 | V50-ANAL-010 | Reporte IA ejecutivo por lista | 5 |
| 2 | V50-ANAL-011 | Simulador de precios de venta | 8 |
| 2 | V50-ANAL-012 | Aplicación de lista (total o parcial) | 5 |
| 2 | V50-ANAL-013 | UI completa del flujo Cargo→Analizo→Decido→Importo | 13 |
| 2 | **Subtotal Fase 2** | | **49** |
| 3 | V50-ANAL-014 | Comparación de proveedores (API + lógica) | 8 |
| 3 | V50-ANAL-015 | Comparación temporal: mismo proveedor en el tiempo | 5 |
| 3 | V50-ANAL-016 | Margen real por producto y alertas | 5 |
| 3 | V50-ANAL-017 | Productos estrella vs. lastre (ranking BCG) | 3 |
| 3 | V50-ANAL-018 | Forecast de reposición con estacionalidad | 8 |
| 3 | V50-ANAL-019 | Comparación de presupuestos (N listas simultáneas) | 8 |
| 3 | V50-ANAL-020 | Alertas de oportunidad e inflación | 3 |
| 3 | V50-ANAL-021 | Cierre mensual y dashboard de rentabilidad | 8 |
| 3 | **Subtotal Fase 3** | | **48** |
| 4 | V50-ANAL-022 | UI comparación de proveedores | 5 |
| 4 | V50-ANAL-023 | UI forecast de reposición | 3 |
| 4 | V50-ANAL-024 | Margen en tiempo real al emitir factura | 3 |
| 4 | V50-ANAL-025 | Alertas en dashboard + UI cuenta corriente | 3 |
| 4 | **Subtotal Fase 4** | | **14** |
| | **TOTAL BLOQUE E** | **25 tickets** | **135 pts** |

---

## Grafo de dependencias

```text
V50-ANAL-001 (lista_precios)
  └── V50-ANAL-007 (carga y extracción)
        └── V50-ANAL-008 (matching)
              ├── V50-ANAL-009 (análisis impacto)
              │     ├── V50-ANAL-010 (reporte IA)
              │     └── V50-ANAL-011 (simulador precios)
              │           └── V50-ANAL-012 (aplicar lista)
              │                 └── V50-ANAL-013 (UI flujo completo)
              └── V50-ANAL-019 (comparar N listas)

V50-ANAL-002 (producto_proveedor)
  └── V50-ANAL-014 (comparar proveedores)
        └── V50-ANAL-022 (UI comparar proveedores)

V50-ANAL-003 (precio_costo en items)
  └── V50-ANAL-006 (grabar costo al emitir)
        ├── V50-ANAL-016 (margen real)
        │     ├── V50-ANAL-017 (ranking BCG)
        │     └── V50-ANAL-018 (forecast reposición)
        │           └── V50-ANAL-023 (UI forecast)
        └── V50-ANAL-024 (margen en factura)

V50-ANAL-004 (cuenta corriente)
  └── V50-ANAL-025 (alertas + UI cuenta corriente)

V50-ANAL-005 (cierre mensual + radar + flag)
  ├── V50-ANAL-021 (dashboard rentabilidad)
  └── V50-ANAL-020 (alertas oportunidad)
        └── V50-ANAL-025 (alertas en dashboard)
```

---

## Orden de implementación recomendado

**Sprint 1 (Fase 1 — Fundación):** ANAL-001 → ANAL-002 → ANAL-003 → ANAL-005 → ANAL-004 → ANAL-006

**Sprint 2 (Fase 2a — Flujo core):** ANAL-007 → ANAL-008 → ANAL-009 → ANAL-011

**Sprint 3 (Fase 2b — IA + UI):** ANAL-010 → ANAL-012 → ANAL-013

**Sprint 4 (Fase 3a — Análisis):** ANAL-014 → ANAL-015 → ANAL-016 → ANAL-017

**Sprint 5 (Fase 3b — Avanzado):** ANAL-018 → ANAL-019 → ANAL-020 → ANAL-021

**Sprint 6 (Fase 4 — Integración UX):** ANAL-022 → ANAL-023 → ANAL-024 → ANAL-025

---

# BLOQUE F — v6.0 (Códigos de barra + POS con escáner)

---

## V60-POS-001 — Migración: columnas codigo_barras, plu y es_pesable en producto (hecho)

- Tipo: migration
- Módulo: pos
- Prioridad: critical
- Estimación: 3
- Versión: v6.0
- Estado: done
- Dependencias: V50-ANAL-005

**Descripción:** Agregar tres columnas nuevas a la tabla `producto`: `codigo_barras` (VARCHAR(14), nullable), `plu` (VARCHAR(5), nullable) y `es_pesable` (BOOLEAN, default false). Crear índices UNIQUE parciales y CHECK constraints para garantizar consistencia.

**Criterios de aceptación:**
- [ ] Columna `codigo_barras` VARCHAR(14) nullable agregada a `producto`
- [ ] Columna `plu` VARCHAR(5) nullable agregada a `producto`
- [ ] Columna `es_pesable` BOOLEAN DEFAULT false agregada a `producto`
- [ ] Índice UNIQUE parcial `idx_producto_barcode_tenant` sobre `(tenant_id, codigo_barras)` WHERE `codigo_barras IS NOT NULL AND activo = true`
- [ ] Índice UNIQUE parcial `idx_producto_plu_tenant` sobre `(tenant_id, plu)` WHERE `plu IS NOT NULL AND activo = true`
- [ ] CHECK constraint `chk_plu_requiere_pesable`: `plu IS NULL OR es_pesable = true`
- [ ] CHECK constraint `chk_pesable_unidad`: `es_pesable = false OR unidad IN ('kg', 'gramo')`
- [ ] Migración ejecuta sin errores sobre el schema existente

**Notas técnicas:** Archivo `supabase/migrations/023_producto_barcode.sql`. Los índices parciales siguen el patrón existente del sistema (ver `idx_producto_codigo_tenant`). Los 14 dígitos cubren EAN-13 y futura compatibilidad con ITF-14.

---

## V60-POS-002 — Migración: cantidad INTEGER → NUMERIC(12,3) en movimiento, comprobante_item y pedido_item (hecho)

- Tipo: migration
- Módulo: pos
- Prioridad: critical
- Estimación: 5
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-001

**Descripción:** Migrar el tipo de dato de la columna `cantidad` de INTEGER a NUMERIC(12,3) en las tablas `movimiento`, `comprobante_item` y `pedido_item` para soportar productos pesables con cantidades decimales (ej: 0.450 kg). Ajustar los constraints existentes y las columnas de stock en `movimiento`.

**Criterios de aceptación:**
- [ ] `movimiento.cantidad` migrada de INTEGER a NUMERIC(12,3)
- [ ] `movimiento.stock_anterior` migrada de INTEGER a NUMERIC(12,3)
- [ ] `movimiento.stock_posterior` migrada de INTEGER a NUMERIC(12,3)
- [ ] `comprobante_item.cantidad` migrada de INTEGER a NUMERIC(12,3)
- [ ] `pedido_item.cantidad` migrada de INTEGER a NUMERIC(12,3)
- [ ] `producto.stock_actual` migrada de INTEGER a NUMERIC(12,3)
- [ ] `producto.stock_minimo` migrada de INTEGER a NUMERIC(12,3)
- [ ] Constraint `chk_cantidad_positiva` ajustado para semántica decimal (`cantidad > 0`)
- [ ] Constraint `chk_item_positivo` ajustado para semántica decimal
- [ ] Constraint `chk_pedido_item_positivo` ajustado para semántica decimal
- [ ] Constraint `chk_stock_positivo` ajustado (`stock_actual >= 0`)
- [ ] Datos existentes preservados sin pérdida (INTEGER → NUMERIC es un cast seguro)

**Notas técnicas:** Archivo `supabase/migrations/024_cantidad_decimal.sql`. NUMERIC(12,3) permite hasta 999.999.999,999 con precisión de milésimas (gramo). Los constraints se recrean con `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT`. Es la migración más invasiva del bloque porque toca tablas core.

---

## V60-POS-003 — Migración: flag facturador_pos en modulo_config + activar_plan (hecho)

- Tipo: migration
- Módulo: pos
- Prioridad: critical
- Estimación: 3
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-001

**Descripción:** Agregar la columna `facturador_pos` (BOOLEAN, default false) a `modulo_config`. Crear CHECK constraint que obliga a tener `facturador_simple = true` si `facturador_pos = true`. Actualizar la función `activar_plan` para setear este flag en true con plan completo y false con plan base.

**Criterios de aceptación:**
- [ ] Columna `facturador_pos` BOOLEAN DEFAULT false agregada a `modulo_config`
- [ ] CHECK constraint `chk_pos_requiere_facturador`: `facturador_pos = false OR facturador_simple = true`
- [ ] Función `activar_plan` actualizada: plan completo activa `facturador_pos = true`, plan base desactiva `facturador_pos = false`
- [ ] RLS policies de `modulo_config` siguen funcionando correctamente
- [ ] Migración es idempotente y no rompe tenants existentes

**Notas técnicas:** Archivo `supabase/migrations/025_facturador_pos.sql`. Sigue el mismo patrón que `chk_arca_requiere_facturador`.

---

## V60-POS-004 — Actualizar función registrar_movimiento para NUMERIC (hecho)

- Tipo: migration
- Módulo: pos
- Prioridad: critical
- Estimación: 2
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-002

**Descripción:** Actualizar la firma y tipos internos de la función SQL `registrar_movimiento`: los parámetros `p_cantidad`, variables `v_stock_anterior` y `v_stock_posterior` pasan de INTEGER a NUMERIC(12,3). La lógica interna no cambia.

**Criterios de aceptación:**
- [ ] Parámetro `p_cantidad` cambia de INTEGER a NUMERIC(12,3)
- [ ] Variables `v_stock_anterior` y `v_stock_posterior` cambian a NUMERIC(12,3)
- [ ] La función sigue sumando/restando/asignando correctamente con decimales
- [ ] `FOR UPDATE` sigue previniendo race conditions
- [ ] Error de stock insuficiente sigue funcionando con valores decimales
- [ ] Tests existentes de movimiento siguen pasando

**Notas técnicas:** Se usa `CREATE OR REPLACE FUNCTION` para actualizar sin borrar la función existente. Incluir en la misma migración `024_cantidad_decimal.sql` o en una separada si conviene.

---

## V60-POS-005 — Regenerar tipos TypeScript de Supabase (hecho)

- Tipo: setup
- Módulo: infra
- Prioridad: critical
- Estimación: 1
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-001, V60-POS-002, V60-POS-003, V60-POS-004

**Descripción:** Ejecutar `npm run gen:types` para regenerar `src/types/database.ts` con las nuevas columnas de producto, el tipo NUMERIC en cantidad, el flag `facturador_pos` y los nuevos valores de ENUM.

**Criterios de aceptación:**
- [ ] `src/types/database.ts` regenerado con `codigo_barras`, `plu`, `es_pesable` en producto
- [ ] `cantidad` aparece como `number` (no integer) en movimiento, comprobante_item, pedido_item
- [ ] `stock_actual` y `stock_minimo` aparecen como `number` en producto
- [ ] `facturador_pos` aparece en modulo_config
- [ ] El tipo `tipo_comprobante` incluye `ticket` (si se agregó en migración)
- [ ] Autocompletado funciona en el IDE para las nuevas columnas
- [ ] Build de TypeScript compila sin errores

**Notas técnicas:** Requiere que las migraciones se hayan ejecutado en el proyecto Supabase remoto o local antes de regenerar.

---

## V60-POS-006 — Librería de generación y validación EAN-13 (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: critical
- Estimación: 3
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-005

**Descripción:** Construir módulo de librería en `src/lib/pos/ean13.ts` con funciones puras para calcular dígito verificador EAN-13, validar códigos completos, generar EAN-13 internos con prefijo `20`, y formatear para display.

**Criterios de aceptación:**
- [ ] Función `calcularCheckDigitEAN13(digits12: string): string` implementa fórmula GS1 módulo 10
- [ ] Función `validarEAN13(code: string): boolean` valida longitud, solo dígitos y check digit correcto
- [ ] Función `generarEAN13Interno(secuencial: number): string` genera con prefijo `20` + padding + check digit
- [ ] Función `formatearEAN13(code: string): string` devuelve formato visual separado en grupos
- [ ] Tests con Vitest: códigos argentinos (prefijo 779), internos (prefijo 20), inválidos por longitud, por caracteres, por check digit
- [ ] Cobertura del 100% de las funciones (lógica crítica)
- [ ] Todas las funciones son puras (sin I/O, sin estado)

**Notas técnicas:** Archivo `src/lib/pos/ean13.ts`, tests en `src/test/ean13.test.ts`. Rango 20-29 de GS1 es de uso interno y no se emite a fabricantes reales.

---

## V60-POS-007 — Parser de código escaneado (parseBarcode) (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: critical
- Estimación: 3
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-006

**Descripción:** Construir función `parseBarcode(input: string)` en `src/lib/pos/barcode-parser.ts` que recibe el string del escáner y determina el tipo de código, el lookup key y opcionalmente el peso para códigos de balanza.

**Criterios de aceptación:**
- [ ] Detecta código de balanza: 13 dígitos que empieza con `2` → extrae PLU (dígitos 2-6), peso en gramos (dígitos 7-11), convierte a kg
- [ ] Detecta EAN normal: string numérico de 8-14 dígitos que no es balanza
- [ ] Detecta SKU alfanumérico: string no vacío con caracteres válidos → devuelve como `ean_normal` para búsqueda dual
- [ ] Detecta desconocido: string vacío o con caracteres inválidos
- [ ] Retorna objeto tipado `{ tipo: 'ean_normal' | 'balanza_peso' | 'desconocido', codigoLookup: string, peso?: number }`
- [ ] Tests con Vitest: códigos de balanza reales, EAN-13 normales, EAN-8, SKU alfanuméricos, strings vacíos, caracteres especiales
- [ ] Función compartida entre frontend y backend (es isomórfica)

**Notas técnicas:** Archivo `src/lib/pos/barcode-parser.ts`, tests en `src/test/barcode-parser.test.ts`. El estándar argentino de balanza usa 5 dígitos para PLU y 5 para peso (variante "peso embebido").

---

## V60-POS-008 — API: asignar código de barras a un producto (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: critical
- Estimación: 3
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-006, V60-POS-005

**Descripción:** Crear endpoint `POST /api/productos/[id]/codigo-barras` que asigna o actualiza el código de barras de un producto existente, validando formato, duplicados y permisos.

**Criterios de aceptación:**
- [ ] Recibe `{ codigo_barras: string }` en el body
- [ ] Guard de módulo `facturador_pos`
- [ ] Guard de rol: visor no puede asignar
- [ ] Valida que el producto exista y pertenezca al tenant
- [ ] Si pasa validación EAN-13, OK. Si no, devuelve `{ success: true, warning: "..." }`
- [ ] Si el código ya está asignado a otro producto activo del tenant: 409 Conflict con ID y nombre del producto conflictuante
- [ ] Actualiza `producto.codigo_barras` con el código proporcionado
- [ ] Response exitosa: `{ success: true, codigo_barras, warning? }`

**Notas técnicas:** API route en `src/app/api/productos/[id]/codigo-barras/route.ts`. Reutiliza `validarEAN13` de la librería.

---

## V60-POS-009 — API: generar EAN-13 interno automáticamente (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: high
- Estimación: 3
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-006, V60-POS-005

**Descripción:** Crear endpoint `POST /api/productos/[id]/generar-codigo` que genera un EAN-13 interno con prefijo `20` para un producto que no tiene código de barras, usando un secuencial del tenant.

**Criterios de aceptación:**
- [ ] Guard de módulo `facturador_pos`
- [ ] Guard de rol: visor no puede generar
- [ ] Obtiene el siguiente secuencial del tenant (MAX sobre codigos existentes con prefijo `20` + 1, o contador dedicado)
- [ ] Genera EAN-13 con `generarEAN13Interno(secuencial)`
- [ ] Guarda en `producto.codigo_barras`
- [ ] Si el producto ya tiene código de barras, retorna 400 con mensaje para forzar confirmación explícita
- [ ] Response: `{ success: true, codigo_barras: string }`

**Notas técnicas:** API route en `src/app/api/productos/[id]/generar-codigo/route.ts`. El índice UNIQUE previene colisiones bajo concurrencia.

---

## V60-POS-010 — Extender PATCH /api/productos/[id] con campos de barcode y pesable (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: high
- Estimación: 2
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-005

**Descripción:** Extender la API de edición de producto existente para aceptar los campos `codigo_barras`, `plu` y `es_pesable`, con validaciones de consistencia.

**Criterios de aceptación:**
- [ ] PATCH acepta `codigo_barras`, `plu` y `es_pesable` como campos opcionales
- [ ] Valida duplicado de `codigo_barras` contra otros productos activos del tenant
- [ ] Valida duplicado de `plu` contra otros productos activos del tenant
- [ ] Si `es_pesable` cambia a `true` y la unidad no es `kg` ni `gramo`, cambia automáticamente a `kg`
- [ ] Si `es_pesable` cambia a `false`, nulifica `plu` automáticamente
- [ ] Si se envía `plu` sin `es_pesable = true`, retorna 400
- [ ] Validación de formato PLU: solo dígitos numéricos, máximo 5 caracteres

**Notas técnicas:** Se extiende la route existente en `src/app/api/productos/[id]/route.ts`.

---

## V60-POS-011 — UI: sección "Códigos y escaneo" en formulario de producto (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: high
- Estimación: 5
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-008, V60-POS-009, V60-POS-010

**Descripción:** Agregar sección "Códigos y escaneo" en las pantallas `/productos/nuevo` y `/productos/[id]` con campos para código de barras, PLU, checkbox de pesable, y botón de generación automática.

**Criterios de aceptación:**
- [ ] Campo de texto para código de barras con soporte de escaneo directo (la pistola tipea ahí)
- [ ] Botón "Generar" al lado del input que llama al endpoint de generación automática
- [ ] Indicador de validación en tiempo real: vacío/gris, válido/verde, warning/amarillo, duplicado/rojo con link
- [ ] Validación al blur (no en cada keystroke)
- [ ] Checkbox "Es producto pesable (balanza)" con cambio automático de unidad a kg
- [ ] Campo PLU visible solo si es_pesable está activo, con validación numérica y límite de 5 dígitos
- [ ] Tooltip explicativo en PLU: "Número que usás en tu balanza para identificar este producto"
- [ ] Sección visible solo si el módulo `facturador_pos` está activo

**Notas técnicas:** Se extiende el componente existente de formulario de producto. Usar `useModulos()` para condicionar la visibilidad de la sección.

---

## V60-POS-012 — Extender búsqueda de productos por código de barras (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: high
- Estimación: 2
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-005

**Descripción:** Extender la búsqueda del listado de productos (`/productos`) para incluir `codigo_barras` como campo de búsqueda, y agregar columna opcional de código de barras en la tabla.

**Criterios de aceptación:**
- [ ] El campo de búsqueda existente busca también por `codigo_barras` (además de nombre y SKU)
- [ ] La tabla de productos agrega columna "Código de barras" (mostrable/ocultable)
- [ ] Columna muestra el código formateado con `formatearEAN13` si existe, o vacío si no
- [ ] La búsqueda por código de barras es exacta (no fuzzy)
- [ ] Funciona con escáner: si el usuario escanea en el campo de búsqueda, filtra por el código

**Notas técnicas:** Se extiende la API `GET /api/productos` y la página `/productos/page.tsx`.

---

## V60-POS-013 — Pantalla de impresión de etiquetas individual (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: high
- Estimación: 8
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-011

**Descripción:** Crear ruta `/productos/[id]/etiquetas` con selector de cantidad, preview visual del código de barras renderizado con `bwip-js`, selector de tamaño de etiqueta e impresión/descarga.

**Criterios de aceptación:**
- [ ] Instalar `bwip-js` como dependencia
- [ ] Ruta `/productos/[id]/etiquetas` accesible desde el detalle del producto con botón "Imprimir etiquetas"
- [ ] Selector de cantidad de copias: 1, 5, 10, 20, custom
- [ ] Preview visual de la etiqueta: nombre del producto, precio de venta, código de barras SVG, SKU opcional
- [ ] Selector de tamaño de etiqueta: 50×30mm, 80×40mm, A4 con grilla
- [ ] Botón "Imprimir" que abre diálogo nativo con CSS de impresión (page-break, print media queries)
- [ ] Número humano-legible bajo el código de barras como fallback
- [ ] Guard de módulo `facturador_pos`
- [ ] El producto debe tener código de barras asignado para poder imprimir

**Notas técnicas:** `bwip-js` pesa ~150kb y soporta EAN-13, EAN-8, Code 128, QR. Usar renderizado SVG client-side. CSS de impresión con `@media print` y `page-break-after`.

---

## V60-POS-014 — Impresión masiva de etiquetas (lote) (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: medium
- Estimación: 5
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-013

**Descripción:** Agregar acción batch en el listado de productos: "Imprimir etiquetas de los seleccionados", que abre un modal con los productos elegidos, permite definir copias por producto y genera la impresión en grilla.

**Criterios de aceptación:**
- [ ] Checkboxes de selección en la tabla de productos
- [ ] Botón "Imprimir etiquetas" visible cuando hay productos seleccionados con código de barras
- [ ] Modal con lista de productos seleccionados y campo de copias por producto
- [ ] Genera grilla de impresión con todas las etiquetas distribuidas en hojas A4
- [ ] Preview antes de imprimir
- [ ] Filtra automáticamente los productos sin código de barras y muestra aviso

**Notas técnicas:** Reutiliza el renderizador de etiquetas de V60-POS-013. La ruta puede ser `/productos/etiquetas-lote` o un modal sobre `/productos`.

---

## V60-POS-015 — Migración: tipo ticket en tipo_comprobante y metodo_pago en comprobante (hecho)

- Tipo: migration
- Módulo: pos
- Prioridad: critical
- Estimación: 3
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-002

**Descripción:** Extender el ENUM `tipo_comprobante` con el valor `ticket`. Agregar columna `metodo_pago` a la tabla `comprobante` y opcionalmente columna `caja_id` para múltiples terminales.

**Criterios de aceptación:**
- [ ] `ALTER TYPE tipo_comprobante ADD VALUE 'ticket'`
- [ ] Columna `metodo_pago` VARCHAR(20) nullable agregada a `comprobante` (valores: efectivo, debito, credito, transferencia, mixto)
- [ ] Columna `metodo_pago_detalle` JSONB nullable para desglose de pagos mixtos
- [ ] Columna `caja_id` VARCHAR(20) nullable reservada para múltiples terminales (v6.1)
- [ ] Migración es aditiva y no afecta comprobantes existentes

**Notas técnicas:** Archivo `supabase/migrations/026_pos_comprobante.sql`. El tipo `ticket` tiene numeración propia separada de facturas. `metodo_pago` se usa para reportes e impresión del ticket, no afecta cálculos.

---

## V60-POS-016 — Componente `<BarcodeInput />` reutilizable (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: critical
- Estimación: 5
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-005

**Descripción:** Construir un componente de input HTML optimizado para captura de escáner, con autofoco, detección de velocidad de teclado, y callback al completar un escaneo (Enter/Tab).

**Criterios de aceptación:**
- [ ] Input HTML que mantiene foco automáticamente (reenfoca cada 500ms si pierde foco, pausable con prop)
- [ ] Detección de escaneo por velocidad: si caracteres llegan con < 30ms entre sí, flag "está escaneando"
- [ ] Al recibir Enter (o Tab), toma el buffer completo, llama callback `onScan(codigo)`, y limpia el input
- [ ] Buffer interno NO atado al state de React (evita rerenders por cada keystroke)
- [ ] Props: `onScan`, `autoFocus`, `disabled`, `placeholder`, `className`
- [ ] Ref al DOM node para gestión imperativa de foco
- [ ] Debounce anti doble-disparo: ignora segundo scan del mismo código en < 300ms
- [ ] Funciona con escáneres USB, Bluetooth y teclado manual

**Notas técnicas:** Archivo `src/components/pos/barcode-input.tsx`. El escáner se comporta como teclado HID: "tipea" el código y envía Enter. No requiere drivers ni permisos de navegador.

---

## V60-POS-017 — API: búsqueda de producto por código de barras (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: critical
- Estimación: 3
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-007, V60-POS-005

**Descripción:** Implementar `GET /api/productos/buscar-por-barcode?codigo=XXX` que recibe un código, lo parsea y busca el producto correspondiente según el tipo detectado.

**Criterios de aceptación:**
- [ ] Recibe query param `codigo` con el string escaneado
- [ ] Pasa el código por `parseBarcode()` para determinar tipo
- [ ] `ean_normal`: busca por `codigo_barras`, si no encuentra intenta por `codigo` (SKU)
- [ ] `balanza_peso`: busca por `plu` en productos pesables activos
- [ ] `desconocido`: retorna 404 directamente
- [ ] Response 200: `{ producto, tipo, peso? }` con datos completos del producto
- [ ] Response 404: `{ error: "Producto no encontrado", codigo }` con el código buscado
- [ ] Guard de módulo `facturador_pos`
- [ ] Solo busca productos activos del tenant autenticado

**Notas técnicas:** API route en `src/app/api/productos/buscar-por-barcode/route.ts`. El visor puede escanear para ver precios pero no puede emitir.

---

## V60-POS-018 — Extender API de emisión: tipo ticket, método de pago, cantidad decimal (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: critical
- Estimación: 5
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-015, V60-POS-005

**Descripción:** Ajustar la API existente `POST /api/facturacion/emitir` para soportar el tipo de comprobante `ticket`, recibir `metodo_pago` y aceptar cantidades decimales en items.

**Criterios de aceptación:**
- [ ] Acepta `tipo: 'ticket'` como tipo de comprobante válido
- [ ] El ticket tiene numeración propia secuencial (reutiliza `siguiente_numero_comprobante`)
- [ ] Acepta campo `metodo_pago` en el body (efectivo, debito, credito, transferencia, mixto)
- [ ] Acepta campo `metodo_pago_detalle` para pagos mixtos con montos por método
- [ ] Cantidades decimales en items se aceptan y procesan correctamente
- [ ] `determinarTipoFactura` acepta flag `quiere_ticket` del frontend y retorna `ticket`
- [ ] Generación de PDF adaptada para ticket (se mantiene el PDF A4 estándar para archivo)
- [ ] Guarda `metodo_pago` y `metodo_pago_detalle` en el comprobante

**Notas técnicas:** Se extiende `src/lib/facturacion/emitir-comprobante.ts` y la route `/api/facturacion/emitir`. El tipo `ticket` no es fiscal (no va a ARCA).

---

## V60-POS-019 — Pantalla POS: layout, barra superior y zona de escaneo (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: critical
- Estimación: 8
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-016, V60-POS-017, V60-POS-018

**Descripción:** Construir la pantalla `/facturacion/pos` con layout de pantalla completa (sin sidebar), barra superior con datos del tenant y selector de cliente, y zona de escaneo con `<BarcodeInput />`.

**Criterios de aceptación:**
- [ ] Ruta `/facturacion/pos` con layout fullscreen sin sidebar
- [ ] Barra superior: nombre del tenant, selector de cliente (default "Consumidor Final"), tipo de comprobante, fecha/hora, usuario
- [ ] Selector de cliente con búsqueda y botón "Cambiar cliente"
- [ ] Tipo de comprobante pre-seleccionado según condición del cliente (ticket por default para CF)
- [ ] Zona de escaneo con `<BarcodeInput />` grande y centrado, con placeholder instructivo
- [ ] Indicador visual del último producto escaneado
- [ ] Botón "Buscar" alternativo para buscador textual sin código de barras
- [ ] Guard de módulo `facturador_pos`
- [ ] Guard de rol: visor puede ver precios pero no emitir
- [ ] Responsive: funcional en desktop y tablet

**Notas técnicas:** La pantalla POS es independiente del layout del dashboard. Usar un layout dedicado o `layout.tsx` propio en la ruta.

---

## V60-POS-020 — Pantalla POS: carrito de items y totales en tiempo real (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: critical
- Estimación: 8
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-019

**Descripción:** Implementar el cuerpo principal del POS: lista de items acumulados con edición inline, y panel de resumen con subtotal, IVA y total calculados en tiempo real.

**Criterios de aceptación:**
- [ ] Columna izquierda (~65%): lista de items con cantidad editable, unidad, nombre, precio unitario, subtotal, botón eliminar
- [ ] Al escanear producto no pesable: si ya está en carrito incrementa cantidad +1, si no agrega nueva línea
- [ ] Al escanear producto pesable con peso de balanza: agrega línea con cantidad = peso en kg
- [ ] Al escanear producto pesable sin peso: abre modal "Ingresar peso manualmente"
- [ ] Producto no encontrado: toast rojo "Producto no encontrado: [código]"
- [ ] Animación de highlight en la última línea agregada
- [ ] Placeholder "Escaneá el primer producto para empezar" cuando el carrito está vacío
- [ ] Columna derecha (~35%): subtotal, IVA discriminado (si factura A), total en tipografía grande
- [ ] Campo de descuento (porcentual o monto fijo) aplicable al comprobante
- [ ] Botón gigante "COBRAR (F2)"
- [ ] Botón "Cancelar venta (F8)" con confirmación
- [ ] Barra inferior: contador de items, nombre del cajero

**Notas técnicas:** Estado del carrito en React state (o useReducer). Cálculos de importes con `calcularImportes` existente. Sonido opcional de confirmación/error.

---

## V60-POS-021 — Modal de cobro (tipo comprobante, método de pago, vuelto) (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: critical
- Estimación: 8
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-020

**Descripción:** Implementar el modal overlay que aparece al tocar "COBRAR" con confirmación de tipo de comprobante, selección de método de pago, cálculo de vuelto y emisión final.

**Criterios de aceptación:**
- [ ] Paso 1: Confirmación del tipo de comprobante. Si es factura, valida CUIT/DNI del cliente
- [ ] Sub-formulario mini para completar datos del cliente si faltan (nombre + CUIT/DNI)
- [ ] Paso 2: Método de pago con botones grandes: Efectivo, Débito, Crédito, Transferencia, Mixto
- [ ] Si efectivo: input "Recibido" con cálculo de vuelto en tiempo real
- [ ] Si mixto: formulario de distribución entre métodos con montos parciales
- [ ] Paso 3: Botón "Confirmar cobro" que llama a `POST /api/facturacion/emitir`
- [ ] Spinner mientras procesa
- [ ] Éxito: pantalla verde con número de comprobante, vuelto, botones "Nueva venta" e "Imprimir ticket"
- [ ] Error: pantalla roja con error descriptivo, carrito se mantiene intacto para reintentar
- [ ] Escape cierra el modal sin emitir

**Notas técnicas:** El modal reutiliza `calcularImportes` y `determinarTipoFactura` del módulo de facturación existente.

---

## V60-POS-022 — Impresión de ticket térmico (80mm / 57mm) (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: high
- Estimación: 5
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-021

**Descripción:** Implementar la generación e impresión de tickets en formato térmico (80mm y 57mm) usando `window.print()` con CSS de impresión optimizado. El backend genera el PDF A4 estándar para archivo.

**Criterios de aceptación:**
- [ ] HTML de ticket con ancho fijo 80mm, tipografía monoespaciada
- [ ] Contenido: cabecera (razón social, CUIT, domicilio), tipo y número, fecha/hora, tabla de items, totales, método de pago, pie fiscal
- [ ] `window.print()` abre diálogo nativo con impresora por defecto
- [ ] Soporte de ancho 57mm como alternativa (configurable)
- [ ] Ventana oculta para impresión sin afectar la UI del POS
- [ ] El backend sigue generando PDF A4 para archivo en Storage (sin cambios)
- [ ] Si en el futuro se activa ARCA, el ticket muestra CAE + código QR + vencimiento

**Notas técnicas:** Modo universal con `window.print()` cubre el 80% de los casos. Alternativa pro con `qz-tray` queda documentada como iteración futura.

---

## V60-POS-023 — Atajos de teclado y ergonomía del POS

- Tipo: feature
- Módulo: pos
- Prioridad: high
- Estimación: 3
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-020

**Descripción:** Implementar todos los atajos de teclado del POS para operación sin mouse, con modal de ayuda accesible con F1.

**Criterios de aceptación:**
- [ ] Enter en input de escaneo: confirma código
- [ ] F2: cobrar / abrir modal de pago
- [ ] F4: cambiar cliente
- [ ] F8: cancelar venta (con confirmación)
- [ ] Escape: cierra cualquier modal abierto
- [ ] +/- en línea seleccionada: ajusta cantidad
- [ ] Del: elimina línea seleccionada
- [ ] F12: cambiar tipo de comprobante
- [ ] F1 o `?`: abre modal de ayuda con lista de atajos
- [ ] Navegación con flechas arriba/abajo en el carrito
- [ ] Los atajos no interfieren con el input de escaneo cuando tiene foco

**Notas técnicas:** Usar `useEffect` con listener de `keydown` a nivel de documento. Prevenir defaults para las teclas F que el navegador usa.

---

## V60-POS-024 — Manejo de casos borde del POS (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: high
- Estimación: 5
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-020, V60-POS-021

**Descripción:** Implementar el manejo explícito de todos los casos borde: producto sin stock, inactivo, desconexión de red, doble disparo del escáner, pesable sin pesar.

**Criterios de aceptación:**
- [ ] Producto sin stock: comportamiento configurable (bloquear o permitir con warning visual)
- [ ] Producto inactivo: 404 como si no existiera
- [ ] Desconexión de red al escanear: toast "Sin conexión, reintentando..." con botón "Reintentar"
- [ ] Desconexión al emitir: bloquea emisión con mensaje claro, carrito intacto
- [ ] Doble disparo del escáner: debounce de 300ms para mismo código
- [ ] Pesable sin pesar (SKU manual): abre modal de peso manual con input numérico grande
- [ ] Error de red/500: toast genérico, carrito intacto
- [ ] Código duplicado en DB (edge case): error 500 con log

**Notas técnicas:** El comportamiento ante falta de stock se configura en V60-POS-026. Usar navigator.onLine para detección de red.

---

## V60-POS-025 — Persistencia del carrito en localStorage (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: high
- Estimación: 2
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-020

**Descripción:** Persistir automáticamente el carrito del POS en `localStorage` para recuperarlo tras un corte de luz o crash del navegador.

**Criterios de aceptación:**
- [ ] El carrito se guarda en `localStorage` cada vez que cambia (debounced cada 500ms)
- [ ] Al recargar la pantalla POS, si detecta carrito previo sin emitir, pregunta "Hay una venta en curso sin emitir, ¿restaurar?"
- [ ] Si el usuario acepta, restaura todo el estado del carrito (items, cliente, tipo)
- [ ] Si el usuario rechaza, limpia el carrito guardado
- [ ] Después de emitir exitosamente, limpia el carrito de localStorage
- [ ] El carrito guardado incluye timestamp para expirar si tiene más de 24 horas

**Notas técnicas:** Usar key `smartstock_pos_cart_{tenant_id}` para separar por tenant. Serializar con JSON.stringify.

---

## V60-POS-026 — Configuración POS en /configuracion (hecho)

- Tipo: feature
- Módulo: pos
- Prioridad: medium
- Estimación: 3
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-019

**Descripción:** Agregar sección "POS" en `/configuracion` con opciones de personalización del comportamiento del punto de venta.

**Criterios de aceptación:**
- [ ] Sección "POS" visible solo si el módulo `facturador_pos` está activo
- [ ] Toggle: activar/desactivar sonidos de confirmación y error
- [ ] Selector: preferencia de impresión (térmica 80mm, térmica 57mm, A4)
- [ ] Selector: comportamiento ante falta de stock (bloquear vs permitir con warning)
- [ ] Las preferencias se guardan en localStorage del usuario (no en DB, son por dispositivo)
- [ ] Sección en `/configuracion/plan`: el flag `facturador_pos` aparece en el listado de módulos
- [ ] Solo admin puede activar/desactivar el módulo

**Notas técnicas:** Se extiende la página existente `/configuracion/page.tsx`. Las preferencias son locales al dispositivo, no al tenant.

---

## V60-POS-027 — Importador: aceptar columna de código de barras (hecho)

- Tipo: feature
- Módulo: importador
- Prioridad: medium
- Estimación: 2
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-005

**Descripción:** Extender el importador Excel para reconocer y mapear una columna de código de barras a `producto.codigo_barras` durante la importación.

**Criterios de aceptación:**
- [ ] El diccionario de aliases reconoce headers como "código de barras", "barcode", "EAN", "EAN-13", "código barra"
- [ ] El mapeo muestra la nueva columna con confianza según match
- [ ] La ejecución del upsert asigna `codigo_barras` al producto
- [ ] Validación: si el código duplica otro producto del tenant, se reporta como error de fila (no bloquea toda la importación)
- [ ] La plantilla descargable incluye la columna opcional "Código de barras"

**Notas técnicas:** Se extiende `src/lib/normalizador/aliases.ts` y `src/lib/importar/ejecutar-importacion.ts`.

---

## V60-POS-028 — Botón "Enviar al POS" desde pedidos

- Tipo: feature
- Módulo: pos
- Prioridad: low
- Estimación: 3
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-020

**Descripción:** Agregar botón "Enviar al POS" en el detalle de un pedido entregado que carga todos los items del pedido en el carrito POS para cobro rápido.

**Criterios de aceptación:**
- [ ] Botón visible en `/pedidos/[id]` para pedidos en estado `entregado` sin factura
- [ ] Al hacer click, redirige a `/facturacion/pos` con los items pre-cargados en el carrito
- [ ] Pre-selecciona el cliente del pedido
- [ ] Si el POS ya tiene items en el carrito, pregunta si quiere reemplazar o agregar
- [ ] Requiere módulos `facturador_pos` y `pedidos` activos

**Notas técnicas:** Pasar los items via query params o sessionStorage para evitar complejidad en el router.

---

## V60-POS-029 — Tests unitarios y de integración del POS (hecho)

- Tipo: test
- Módulo: pos
- Prioridad: high
- Estimación: 8
- Versión: v6.0
- Estado: done
- Dependencias: V60-POS-018, V60-POS-017, V60-POS-007, V60-POS-006

**Descripción:** Suite de tests que cubren la lógica crítica del POS: librería EAN-13, parser de códigos, flujo de escaneo y emisión de ticket.

**Criterios de aceptación:**
- [x] Unit tests EAN-13: check digit, validación, generación con prefijo 20, formatos inválidos
- [x] Unit tests parser: EAN normales, EAN-8, códigos de balanza reales, SKU alfanuméricos, vacíos
- [x] Unit tests cálculo de vuelto y mixto en modal de pago
- [x] Integration: asignar código de barras a producto y verificar UNIQUE
- [x] Integration: intentar código duplicado y recibir 409
- [x] Integration: generar código interno y verificar EAN-13 válido
- [x] Integration: escanear producto normal → se agrega al carrito (API)
- [x] Integration: escanear código de balanza → se parsea peso correctamente (API)
- [x] Integration: escanear producto inexistente → 404 (API)
- [x] Integration: emitir ticket y verificar comprobante creado con movimientos y PDF
- [x] Integration: aislamiento entre tenants (código de un tenant no encontrado por otro)

**Notas técnicas:** Tests unitarios en `src/test/ean13.test.ts` y `src/test/barcode-parser.test.ts`. Tests de integración en `src/test/pos-integration.test.ts`. Usar Vitest.

---

## Resumen de tickets y esfuerzo

| Fase | Ticket | Descripción | Pts |
|---|---|---|---|
| 1 | V60-POS-001 | Migración: columnas codigo_barras, plu, es_pesable | 3 |
| 1 | V60-POS-002 | Migración: cantidad INTEGER → NUMERIC(12,3) | 5 |
| 1 | V60-POS-003 | Migración: flag facturador_pos en modulo_config | 3 |
| 1 | V60-POS-004 | Actualizar registrar_movimiento para NUMERIC | 2 |
| 1 | V60-POS-005 | Regenerar tipos TypeScript | 1 |
| 1 | V60-POS-006 | Librería EAN-13 (generar, validar, formatear) | 3 |
| 1 | V60-POS-007 | Parser de código escaneado (parseBarcode) | 3 |
| 1 | **Subtotal Fase 1** | | **20** |
| 2 | V60-POS-008 | API: asignar código de barras | 3 |
| 2 | V60-POS-009 | API: generar EAN-13 interno | 3 |
| 2 | V60-POS-010 | Extender PATCH producto con campos barcode | 2 |
| 2 | V60-POS-011 | UI: sección "Códigos y escaneo" en producto | 5 |
| 2 | V60-POS-012 | Extender búsqueda por código de barras | 2 |
| 2 | **Subtotal Fase 2** | | **15** |
| 3 | V60-POS-013 | Impresión de etiquetas individual | 8 |
| 3 | V60-POS-014 | Impresión masiva de etiquetas (lote) | 5 |
| 3 | **Subtotal Fase 3** | | **13** |
| 4 | V60-POS-015 | Migración: tipo ticket + metodo_pago | 3 |
| 4 | V60-POS-016 | Componente `<BarcodeInput />` | 5 |
| 4 | V60-POS-017 | API: búsqueda por código de barras | 3 |
| 4 | V60-POS-018 | Extender API emisión (ticket, pago, decimal) | 5 |
| 4 | **Subtotal Fase 4** | | **16** |
| 5 | V60-POS-019 | POS: layout, barra superior y zona escaneo | 8 |
| 5 | V60-POS-020 | POS: carrito de items y totales | 8 |
| 5 | V60-POS-021 | Modal de cobro | 8 |
| 5 | V60-POS-022 | Impresión de ticket térmico | 5 |
| 5 | **Subtotal Fase 5** | | **29** |
| 6 | V60-POS-023 | Atajos de teclado y ergonomía | 3 |
| 6 | V60-POS-024 | Manejo de casos borde | 5 |
| 6 | V60-POS-025 | Persistencia del carrito en localStorage | 2 |
| 6 | V60-POS-026 | Configuración POS en /configuracion | 3 |
| 6 | **Subtotal Fase 6** | | **13** |
| 7 | V60-POS-027 | Importador: columna código de barras | 2 |
| 7 | V60-POS-028 | "Enviar al POS" desde pedidos | 3 |
| 7 | V60-POS-029 | Tests unitarios y de integración | 8 |
| 7 | **Subtotal Fase 7** | | **13** |
| | **TOTAL BLOQUE F** | **29 tickets** | **119 pts** |

---

## Grafo de dependencias

```text
V60-POS-001 (producto barcode)
  ├── V60-POS-002 (cantidad decimal)
  │     ├── V60-POS-004 (registrar_movimiento NUMERIC)
  │     └── V60-POS-015 (tipo ticket + metodo_pago)
  └── V60-POS-003 (flag facturador_pos)

V60-POS-001 + V60-POS-002 + V60-POS-003 + V60-POS-004
  └── V60-POS-005 (regenerar tipos)
        ├── V60-POS-006 (librería EAN-13)
        │     ├── V60-POS-007 (parser barcode)
        │     │     └── V60-POS-017 (API buscar por barcode)
        │     ├── V60-POS-008 (API asignar código)
        │     └── V60-POS-009 (API generar código)
        ├── V60-POS-010 (PATCH producto + barcode)
        ├── V60-POS-012 (búsqueda por barcode)
        ├── V60-POS-016 (BarcodeInput component)
        └── V60-POS-027 (importador barcode)

V60-POS-008 + V60-POS-009 + V60-POS-010
  └── V60-POS-011 (UI códigos en producto)
        └── V60-POS-013 (etiquetas individual)
              └── V60-POS-014 (etiquetas lote)

V60-POS-015 + V60-POS-005
  └── V60-POS-018 (API emisión extendida)

V60-POS-016 + V60-POS-017 + V60-POS-018
  └── V60-POS-019 (POS layout)
        ├── V60-POS-020 (POS carrito)
        │     ├── V60-POS-021 (modal cobro)
        │     │     └── V60-POS-022 (ticket térmico)
        │     ├── V60-POS-023 (atajos teclado)
        │     ├── V60-POS-024 (casos borde)
        │     ├── V60-POS-025 (localStorage)
        │     └── V60-POS-028 (enviar desde pedidos)
        └── V60-POS-026 (configuración POS)

V60-POS-006 + V60-POS-007 + V60-POS-017 + V60-POS-018
  └── V60-POS-029 (tests)
```

---

## Orden de implementación recomendado

**Sprint 1 (Fase 1 — Fundacional):** POS-001 → POS-002 → POS-003 → POS-004 → POS-005 → POS-006 → POS-007

**Sprint 2 (Fase 2 — Productos):** POS-008 → POS-009 → POS-010 → POS-011 → POS-012

**Sprint 3 (Fase 3 — Etiquetas):** POS-013 → POS-014

**Sprint 4 (Fase 4 — Base POS):** POS-015 → POS-016 → POS-017 → POS-018

**Sprint 5 (Fase 5a — UI POS core):** POS-019 → POS-020 → POS-021

**Sprint 6 (Fase 5b — Impresión + Fase 6):** POS-022 → POS-023 → POS-024 → POS-025 → POS-026

**Sprint 7 (Fase 7 — Integraciones + Tests):** POS-027 → POS-028 → POS-029
