---
estado: 🟡 En progreso
version: v7.0
ultima_actualizacion: 2026-04-28
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

**Notas técnicas:** El campo `mapeo_excel` se llena desde el importador (V10-IMP-004). El proveedor puede dejarse **inactivo** (`proveedor.activo = false`) desde el detalle; el listado en `/proveedores` filtra por defecto solo activos y **`GET /api/proveedores`** admite `?estado=activos|inactivos|todos` (defecto: activos). La migración **`069_proveedor_inactivo_desactiva_productos.sql`** añade el trigger **`proveedor_inactivo_desactiva_productos`**: al desactivar un proveedor, los productos con ese **`producto.proveedor_id`** pasan a **`activo = false`** (mismo tenant); no aplica a vínculos solo por **`producto_proveedor`**; reactivar el proveedor no reactiva productos. Documentado en `docs/stock.md`, `docs/base-de-datos.md` y `smartstock.md`.

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

**Notas técnicas:** Invitación vía `auth.admin.inviteUserByEmail` + insert en `usuario` (service role); alternativa documentada: `createUser`. Límite de cupos (solo plan **`base`**): `USUARIOS_MAX_PLAN_BASE` y `getUsuariosMaxPorPlan` en `src/lib/limits.ts`, validado en `POST /api/configuracion/usuarios`, `POST /api/configuracion/usuarios/local` y al reactivar en `PATCH` (conteo `usuario` con `activo = true` por `tenant_id`). Planes **intermedio** y **completo**: sin tope de usuarios en la app.

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

**Notas técnicas:** Archivo `supabase/migrations/024_producto_barcode.sql` (el índice inicial de barra era único por tenant). **Posterior:** `047_producto_barcode_por_proveedor.sql` reemplaza ese índice por dos parciales que incluyen `proveedor_id` (misma barra permitida entre proveedores distintos; sin proveedor, una sola fila activa por barra). Los 14 dígitos cubren EAN-13 y futura compatibilidad con ITF-14.

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

**Notas técnicas:** Archivo `src/lib/pos/barcode-parser.ts`, tests en `src/test/barcode-parser.test.ts`. El estándar argentino de balanza usa 5 dígitos para PLU y 5 para peso (variante "peso embebido"). **Evolución:** además del SKU “seco”, el parser trata como `ean_normal` códigos texto con espacios internos preservados (tras `trim`), letras Unicode y comillas; el POS y `GET /api/pos/buscar-productos` alinean el mismo criterio para fallback por nombre/código parcial.

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

**Notas técnicas:** API route en `src/app/api/productos/buscar-por-barcode/route.ts`. El visor puede escanear para ver precios pero no puede emitir. **Post v6.0:** query opcional `proveedor_id` (filtro del POS); si hay varios productos activos con la misma `codigo_barras` y no se envía, respuesta **409** con `ambiguous` y lista de candidatos (migración `047` + unicidad por proveedor).

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
- [x] Con ARCA activo y CAE obtenido, el ticket muestra código QR de constatación (verificador AFIP) + CAE + vencimiento (`qr_url` en respuesta de emisión, `ticket-termico.tsx` + bwip-js)

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

---

# BLOQUE G — v7.0 (Cobranza: factura, saldo, recibos y avisos por WhatsApp sin API de pago)

---

## V70-COB-001 — Cuenta corriente por factura, recibos, campana de cobranza y enlace `wa.me` (plantilla) (hecho)

- Tipo: feature
- Módulo: facturación / clientes
- Prioridad: high
- Estimación: 21 (epic; descomponer en PRs por fases)
- Versión: v7.0
- Estado: done
- Dependencias: motor de comprobantes existente (`comprobante`, `cliente`, `facturador_simple`); documentación `docs/facturacion.md`

**Descripción:** Permitir emitir facturas asociadas a cliente con **plazo de pago** (ciclo de 7 días renovable en pagos parciales), registrar **pagos totales o parciales**, emitir **recibos** por cada cobro, y asistir la cobranza con una **campana de notificaciones** en el dashboard. Las notificaciones **no** envían mensajes por API paga (Twilio/Meta): indican que corresponde cobrar y ofrecen un botón que abre WhatsApp con **mensaje prearmado** (`https://wa.me/<e164>?text=...`) usando datos del cliente y de la factura/saldo. Incluye facturas **vencidas**: siguen apareciendo en la campana hasta que el saldo quede en cero (situación regularizada).

**Reglas de negocio (acordadas con el cliente):**

1. Al emitir la factura comienza un vencimiento a **7 días** (configurable a nivel producto en una iteración posterior si hace falta).
2. **48 horas antes** del vencimiento del ciclo actual, el ítem entra en cola de “avisar cobro” (campana).
3. Si el cliente **paga el total**: se emite **recibo** por el monto, se puede reutilizar el mismo flujo de PDF/storage que comprobantes; saldo **cero**; el ítem **sale** de la campana.
4. Si paga **una parte**: recibo por ese monto, saldo pendiente, **nuevo ciclo de 7 días** con el mismo esquema de aviso a las 48 h.
5. Si la fecha de vencimiento **ya pasó** y aún hay saldo: el ítem **sigue** en la campana (prioridad / copy distinto de “vencido”) hasta regularizar.

**Criterios de aceptación:**

**Modelo y datos**

- [x] Existe modelo persistido de **cuenta por cobrar** vinculado a `comprobante` (factura) y `cliente`: total factura, saldo pendiente, `vencimiento_at` del ciclo actual, `tenant_id`, timestamps.
- [x] Existe registro de **pagos** (monto, fecha, medio opcional, usuario) que reduce saldo; soporte de **múltiples pagos** hasta saldar.
- [x] Existe tipo o convención para **recibo** de cobranza (nuevo valor en `tipo_comprobante` o tabla hija; numeración acorde al resto del sistema).
- [x] RLS y políticas alineadas al resto de tablas con `tenant_id`.

**Campana (UI + API)**

- [x] En el layout del dashboard hay un icono de **campana** con contador de ítems pendientes de atención de cobranza.
- [x] Lista desplegable o panel: cada ítem muestra cliente, referencia de factura, saldo, vencimiento, estado (**próximo a venc / vencido**).
- [x] Botón principal **“Abrir WhatsApp”** que construye URL `wa.me` con número del cliente en **E.164** (normalizar desde `cliente.telefono`) y `text` con **plantilla** (nombre, monto adeudado, vencimiento, número de factura, enlace a PDF si existe en Storage). Respetar límite razonable de longitud de URL (plantilla acotada + detalle en pantalla si hace falta).
- [x] Si el cliente no tiene teléfono válido, mostrar aviso y deshabilitar o ocultar el botón con mensaje claro.
- [x] **Sin** integración obligatoria a Twilio ni Cloud API para el cierre de este ticket (el envío lo confirma el usuario en WhatsApp).

**Estado y ergonomía**

- [x] Acción **“Marcar recordatorio enviado”** (o similar) para sacar temporalmente el ítem de la campana o marcar último envío (definir en implementación: snooze 24 h vs persistencia de “último aviso_at”).
- [x] Los ítems **vencidos con saldo** siguen apareciendo hasta saldo cero; distinción visual respecto a “48 h antes”.
- [x] Desde **Clientes** (o detalle de cliente / facturas): flujo para registrar pago parcial/total y generar recibo asociado.

**Tests y docs**

- [x] Tests unitarios: normalización de teléfono, construcción de URL `wa.me`, reglas de inclusión en campana (48 h antes, vencido, saldado).
- [x] Actualizar o crear `docs/cobranza.md` con el flujo, diagrama simple y variables de plantilla.

**Notas técnicas:** Documentación de cierre en `docs/cobranza.md` (flujo, diagrama, plantilla `wa.me`, APIs, migraciones 044–045). Consulta on-read para la campana (sin cron). Orden aplicado: migración + API + campana + cobro/recibo + historial cliente + tests + doc.

**Orden de implementación recomendado (sub-entregas):** (1) migración y tipos, (2) API pagos + recibo, (3) query pendientes de cobranza, (4) campana + plantilla `wa.me`, (5) pantallas cliente/comprobante, (6) tests + `docs/cobranza.md`.

---

# BLOQUE G — v7.0 (MP Point)

El detalle de tickets **V70-MP-*** vive en `docs/PLAN-G.md`.

## V70-MP-008 — UI: Sección Mercado Pago Point en /configuracion (hecho)

- Estado: done
- Nota: Componente `MpPointConfigSection` montado en `configuracion/page.tsx` (admin + `facturador_pos`). Ver `docs/PLAN-G.md`.

## V70-MP-010 — UI: Botón Posnet MP en modal de cobro (hecho)

- Estado: done
- Nota: `cobro-modal.tsx` + config cargada en `facturacion/pos/page.tsx`. Ver `docs/PLAN-G.md`.

## V70-MP-011 — UI: Pantalla de espera + Realtime (hecho)

- Estado: done
- Nota: `mp-point-espera.tsx`. Ver `docs/PLAN-G.md`.

---

# BLOQUE H — v8.0 (Reportes operativos, ventas y Cierre Z)

---

## V80-REP-001 — Área de Reportes: tablero ejecutivo “3 clics” (hecho)

- Tipo: feature
- Módulo: dashboard / reportes
- Prioridad: high
- Estimación: 8
- Versión: v8.0
- Estado: done
- Dependencias: `comprobante`, `cuenta_corriente`, `pago`, `modulo_config`; documentación `docs/facturacion.md`, `docs/base-de-datos.md`

**Descripción:** Crear una sección `Reportes` orientada a operación diaria con métricas clave visibles en hasta tres clics: **cuánto facturé hoy**, **cuánto vendí** (cantidad y monto), **cuánto deben los clientes** (cuenta corriente) y **cuánto gasté en proveedores**.

**Criterios de aceptación:**

- [x] Existe ruta `/(dashboard)/reportes` con cards KPI iniciales.
- [x] Filtros rápidos: hoy, semana, mes, rango personalizado.
- [x] KPI disponibles: facturación total, cantidad de comprobantes emitidos, deuda total de cuenta corriente, gasto total a proveedores.
- [x] Tiempo de carga aceptable para tenant mediano (objetivo UX < 1.5 s en query principal).
- [x] Navegación en 3 clics o menos desde dashboard a cada vista de detalle.

**Notas técnicas:** Resolver agregados en backend (API o RPC) para evitar N+1 en cliente. Reutilizar reglas de tenant actuales (RLS + `current_tenant_id()`).

---

## V80-REP-002 — Reporte de clientes: deuda de cuenta corriente y vencimientos (hecho)

- Tipo: feature
- Módulo: clientes / analizador
- Prioridad: high
- Estimación: 5
- Versión: v8.0
- Estado: done
- Dependencias: `V80-REP-001`, `V70-COB-001`

**Descripción:** Incorporar un reporte centrado en clientes para responder cuánto deben, quiénes están vencidos y cuál es la evolución de cobranza.

**Criterios de aceptación:**

- [x] Tabla con saldo por cliente (ordenable por mayor deuda).
- [x] Segmentación por estado: al día, con deuda, vencido.
- [x] Aging de deuda: 0-30, 31-60, 61+ días (según vencimiento de cobranza).
- [x] Totales visibles: deuda total y cantidad de clientes deudores.
- [x] Drilldown al detalle de cliente existente (`/clientes/[id]`).

**Notas técnicas:** Basar aging en `cobranza_factura.vencimiento_at` y `saldo_pendiente > 0`; si no hay módulo de cobranza activo, fallback a `cuenta_corriente.saldo`.

---

## V80-REP-003 — Reporte de proveedores: gasto por período (hecho)

- Tipo: feature
- Módulo: proveedores / compras
- Prioridad: medium
- Estimación: 5
- Versión: v8.0
- Estado: done
- Dependencias: `V80-REP-001`

**Descripción:** Agregar reporte para visualizar cuánto se gasta por proveedor en un período y detectar concentración de compras.

**Criterios de aceptación:**

- [x] Ranking de proveedores por gasto total.
- [x] Filtro por fechas y proveedor.
- [x] Comparación contra período anterior (variación absoluta y %).
- [x] Export CSV del resultado filtrado.
- [x] Totales consistentes con los comprobantes considerados en la query.

**Notas técnicas:** Definir explícitamente qué tipos de comprobante impactan “gasto en proveedor” para mantener consistencia de negocio.

---

## V80-REP-004 — Reporte de ventas a consumidor final (tickets y órdenes) (hecho)

- Tipo: feature
- Módulo: POS / facturación
- Prioridad: high
- Estimación: 5
- Versión: v8.0
- Estado: done
- Dependencias: `V60-POS-015`, `V80-REP-001`

**Descripción:** Incorporar métricas operativas de venta a consumidor final: cantidad de tickets, monto total, ticket promedio y distribución por franjas horarias/turnos.

**Criterios de aceptación:**

- [x] Indicadores: total tickets, total vendido, ticket promedio.
- [x] Distribución por hora y opción por media jornada.
- [x] Filtros por caja y por usuario operador.
- [x] Vista de detalle con lista de comprobantes incluidos.

**Notas técnicas:** Reutilizar `numero_orden` y `metodo_pago` cuando corresponda para trazabilidad de operación POS.

---

## V80-CAJA-001 — Cierre Z diario por caja (snapshot inmutable) (hecho)

- Tipo: feature
- Módulo: caja / POS
- Prioridad: high
- Estimación: 8
- Versión: v8.0
- Estado: done
- Dependencias: `V80-REP-004`

**Descripción:** Implementar **Cierre Z** diario por caja con snapshot operativo inmutable (auditable) para corte de jornada.

**Criterios de aceptación:**

- [x] Existe acción “Ejecutar Cierre Z” por caja y fecha.
- [x] Se persiste snapshot con: ventas brutas/netas, anulaciones, medios de pago, movimientos de cuenta corriente y metadata de usuario.
- [x] El cierre emitido no cambia aunque ingresen comprobantes posteriores.
- [x] Se puede reabrir visualización histórica del cierre y exportar/imprimir.
- [x] Validación para evitar doble cierre final en mismo rango/caja.

**Notas técnicas:** Crear tabla dedicada (`cierre_z`) + detalle por medio de pago; registrar `created_by`, `created_at` y hash/version de cálculo para auditoría.

---

## V80-CAJA-002 — Cierre parcial por turno / franja horaria (hecho)

- Tipo: enhancement
- Módulo: caja / POS
- Prioridad: medium
- Estimación: 5
- Versión: v8.0
- Estado: done
- Dependencias: `V80-CAJA-001`

**Descripción:** Extender Cierre Z para cortes parciales (por hora o media jornada), sin duplicar montos del cierre final diario.

**Criterios de aceptación:**

- [x] Permite definir rango horario (desde/hasta) para cierre parcial.
- [x] Diferencia claramente cierre parcial vs cierre final.
- [x] Reglas de solapamiento evitan doble conteo.
- [x] Reporte de cierres muestra secuencia cronológica por caja.

**Notas técnicas:** Definir estrategia de idempotencia por `(tenant_id, caja_id, rango_desde, rango_hasta, tipo_cierre)`.

---

## V80-DASH-001 — Atajos en dashboard a “Emitir ticket” y “Cierre Z” (hecho)

- Tipo: enhancement
- Módulo: dashboard / navegación
- Prioridad: medium
- Estimación: 2
- Versión: v8.0
- Estado: done
- Dependencias: `V80-CAJA-001`, flujo POS existente

**Descripción:** Agregar atajos directos en el dashboard principal para acelerar tareas operativas: **Emitir ticket** y **Cierre Z**.

**Criterios de aceptación:**

- [x] Botón directo a flujo de ticket POS.
- [x] Botón directo a pantalla de cierre.
- [x] Respeta permisos por rol (visor sin acciones operativas).
- [x] Diseño consistente con acciones rápidas actuales del dashboard.

**Notas técnicas:** Reutilizar guardas de rol existentes y feature flags de módulos (`facturador_pos`).

---

## V81-REP-001 — Ventas por artículo (SKU) + claridad POS vs SKU (hecho)

- Tipo: feature
- Módulo: reportes / stock / POS
- Prioridad: high
- Estimación: 5
- Versión: v8.1
- Estado: done
- Dependencias: `V80-REP-004`, `comprobante_item`, `producto`, `movimiento`

**Descripción:** Reporte real por producto desde líneas de comprobante; renombrar “por artículo” del listado de tickets a **Ventas POS (tickets)**; agregar pantalla **Ventas por artículo (SKU)** con stock, vencimiento a nivel producto y última entrada de stock; documentar métricas en `docs/reportes.md`.

**Criterios de aceptación:**

- [x] API `GET /api/reportes/ventas-articulo` con período, filtros categoría/proveedor, agregados y CSV.
- [x] UI `/reportes/ventas-articulo` con tabla, KPIs y enlace a detalle de producto.
- [x] Navegación y textos distinguen tickets POS vs ventas por SKU.
- [x] Documentación de fuentes de datos y límites (sin lotes).

**Notas técnicas:** Ver `docs/reportes.md`. Próxima fase opcional: modelo de lotes para vencimiento por partida.

---

## V90-PROV-001 — Migración: descuento de proveedor y snapshot en lista (hecho)

- Tipo: migration
- Módulo: analizador / proveedores
- Prioridad: high
- Estimación: 2
- Versión: v9.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Columnas `proveedor.descuento_pct` y `lista_precios.descuento_proveedor_pct_aplicado` con checks y comentarios SQL.

**Criterios de aceptación:**

- [x] Migración `083_proveedor_descuento_lista_precios_snapshot.sql` lista para aplicar con `supabase db push`.

---

## V90-PROV-002 — API y UI: descuento en ficha y alta de proveedor (hecho)

- Tipo: feature
- Módulo: proveedores
- Prioridad: high
- Estimación: 3
- Versión: v9.0
- Estado: done
- Dependencias: `V90-PROV-001`

**Descripción:** `POST/PATCH /api/proveedores` aceptan y validan `descuento_pct` (0–99.99). UI en `/proveedores/[id]` (acuerdo comercial + última lista aplicada) y en el diálogo de nuevo proveedor.

---

## V90-PROV-003 — Descuento en preview de lista del analizador (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: high
- Estimación: 5
- Versión: v9.0
- Estado: done
- Dependencias: `V90-PROV-001`

**Descripción:** Panel de descuento, totales, recálculo client-side, simulador sobre costo neto, columna costo neto / tooltip.

---

## V90-PROV-004 — Aplicación de lista persiste descuento aplicado (hecho)

- Tipo: feature
- Módulo: analizador
- Prioridad: high
- Estimación: 3
- Versión: v9.0
- Estado: done
- Dependencias: `V90-PROV-003`

**Descripción:** `POST .../aplicar` con `descuento_proveedor_pct_aplicado`; costo neto en catálogo; `precio_historial` coherente; snapshot en `lista_precios`; detalle de lista muestra % aplicado.

---

## V90-PROV-005 — Hint en formulario de productos (hecho)

- Tipo: feature
- Módulo: productos
- Prioridad: medium
- Estimación: 2
- Versión: v9.0
- Estado: done
- Dependencias: `V90-PROV-001`

**Descripción:** Hint informativo y botón opcional en `/productos/nuevo` y edición de producto cuando el proveedor tiene descuento configurado.

---

## V90-PROV-006 — Documentación descuento proveedor / listas (hecho)

- Tipo: docs
- Módulo: docs
- Prioridad: low
- Estimación: 1
- Versión: v9.0
- Estado: done
- Dependencias: `V90-PROV-004`

**Descripción:** Actualizar `docs/analizador.md`, `docs/base-de-datos.md`, `docs/lector-facturas.md`, `docs/importador.md`, `docs/TICKETS.md`.

---

## Orden de implementación recomendado

**Sprint 1:** `V80-REP-001` → `V80-REP-002`  
**Sprint 2:** `V80-REP-003` → `V80-REP-004`  
**Sprint 3:** `V80-CAJA-001` → `V80-CAJA-002` → `V80-DASH-001`

---

# BLOQUE K — v10.0 (WhatsApp AutoInbox proveedores)

## V100-WA-001 — Ingesta inbound WhatsApp + auditoría de mensajes/adjuntos (hecho)

- Tipo: feature
- Módulo: integraciones / importador / lector-facturas
- Prioridad: high
- Estimación: 8
- Versión: v10.0
- Estado: done
- Dependencias: `docs/importador.md`, `docs/lector-facturas.md`, `docs/base-de-datos.md`

**Descripción:** Implementar el canal de entrada oficial de WhatsApp para recibir mensajes y adjuntos de proveedores (PDF/imagen/Excel/CSV), persistir payload crudo con trazabilidad por tenant y crear jobs de procesamiento asíncrono.

**Criterios de aceptación:**

- [x] Existe endpoint `GET /api/whatsapp/webhook` para validación challenge.
- [x] Existe endpoint `POST /api/whatsapp/webhook` que recibe mensajes inbound y responde `200` sin bloquear por procesamiento pesado.
- [x] Se persisten mensaje inbound y adjuntos con metadata mínima (`wamid`, `from`, `phone_number_id`, `mime_type`, `filename`, `tenant_id`).
- [x] Se guarda payload crudo para auditoría operativa.
- [x] Se crea un job por adjunto para procesamiento posterior (`queued`).
- [x] Hay idempotencia por `wamid` y hash de adjunto para evitar duplicados.

**Notas técnicas:** Implementación inicial en `src/app/api/whatsapp/webhook/route.ts` y parser en `src/lib/whatsapp/inbound.ts`. Migración `091_whatsapp_inbound_ingesta.sql` agrega tablas `whatsapp_channel`, `whatsapp_inbound_message`, `whatsapp_inbound_attachment`, `whatsapp_processing_job`, `whatsapp_job_event` con estado inicial `queued` e idempotencia (`wamid`, `sha256`).

---

## V100-WA-002 — Resolución de sucursal (auto + fallback conversacional) (hecho)

- Tipo: feature
- Módulo: multi-sucursal / integraciones
- Prioridad: high
- Estimación: 8
- Versión: v10.0
- Estado: done
- Dependencias: `V100-WA-001`, `docs/multi-tenancy.md`

**Descripción:** Resolver automáticamente la sucursal destino de cada documento entrante y, cuando sea ambiguo, solicitar confirmación por WhatsApp para continuar el mismo job.

**Criterios de aceptación:**

- [x] Existe pipeline de resolución por reglas (proveedor+número remitente, `phone_number_id`, CUIT/PdV, dirección).
- [x] Si hay una sola candidata confiable, se asigna `sucursal_id` automáticamente.
- [x] Si hay ambigüedad, el job pasa a `awaiting_branch_confirmation` y se envía pregunta por WhatsApp con opciones cortas.
- [x] Al recibir respuesta válida, se reanuda procesamiento del job en la sucursal elegida.
- [x] Si no hay respuesta en ventana definida, queda en bandeja de revisión manual.
- [x] Se audita el motivo de resolución y/o ambigüedad en eventos de job.

**Notas técnicas:** Migración `092_whatsapp_resolucion_sucursal.sql` agrega reglas y estados (`whatsapp_branch_rule`, columnas de resolución en `whatsapp_processing_job`, `whatsapp_outbound_message`). Resolución implementada en `src/lib/whatsapp/branch-resolution.ts`. Webhook actualiza estado auto/manual y audita eventos (`branch_resolved_auto`, `branch_options`, `branch_confirmed_from_reply`). Timeout a revisión manual via `POST /api/cron/whatsapp/branch-timeout` (usa `CRON_SECRET`).

---

## V100-WA-003 — Orquestación automática a flujos existentes (factura/lista) (hecho)

- Tipo: feature
- Módulo: importador / lector-facturas / jobs
- Prioridad: high
- Estimación: 8
- Versión: v10.0
- Estado: done
- Dependencias: `V100-WA-001`, `V100-WA-002`

**Descripción:** Enrutar cada adjunto a los módulos ya implementados: facturas al lector de facturas y listas a importador, manteniendo trazabilidad y estados operativos hasta resultado final.

**Criterios de aceptación:**

- [x] Adjuntos PDF/imagen se enrutan al flujo `lector-facturas`.
- [x] Adjuntos Excel/CSV se enrutan al flujo `importador`.
- [x] El sistema actualiza estado de job (`processing`, `imported`, `review_required`, `error`) y registra eventos.
- [x] Reprocesar el mismo adjunto no duplica impactos de stock/deuda (idempotencia efectiva).
- [x] Se registra vínculo entre job de WhatsApp y entidad destino (`comprobante_id` o `importacion_log_id`).
- [x] Errores de extracción/procesamiento quedan reintentables desde backend.

**Notas técnicas:** Worker de cola en `POST /api/cron/whatsapp/process-queued` (autorizado por `CRON_SECRET`) con routing por MIME (`src/lib/whatsapp/job-routing.ts`). Vínculos persistidos en `whatsapp_processing_job.target_entity_type/target_entity_id` (migración `093_whatsapp_job_vinculos_y_reintentos.sql`) y eventos `routed_to_lector_facturas` / `routed_to_importador`. Reintento manual via `POST /api/whatsapp/jobs/[id]/reprocess`.

---

## V100-WA-004 — Descarga real de media desde Meta + persistencia en Storage (hecho)

- Tipo: feature
- Módulo: integraciones / jobs
- Prioridad: high
- Estimación: 5
- Versión: v10.0
- Estado: done
- Dependencias: `V100-WA-003`

**Descripción:** Descargar adjuntos reales desde Meta Cloud API usando `wa_media_id`, guardarlos en Storage (`facturas-recibidas`/`listas-precios`) y usar esa referencia en la orquestación.

**Criterios de aceptación:**

- [x] El worker consulta metadata del media y descarga bytes con token de WhatsApp.
- [x] El adjunto se guarda en Storage por tenant y se persiste `storage_bucket` + `storage_path`.
- [x] Se persiste estado de descarga (`download_status`, `downloaded_at`, `download_error`).
- [x] El enrutamiento usa el archivo almacenado para completar metadata de destino.
- [x] Si falla descarga/subida, el job pasa a `error` con detalle y es reintentable.

**Notas técnicas:** `src/lib/whatsapp/meta-media.ts` (metadata + download), `src/lib/whatsapp/storage.ts` (upload), mejoras en `POST /api/cron/whatsapp/process-queued`. Migración: `094_whatsapp_attachment_storage.sql`. Requiere env `WHATSAPP_ACCESS_TOKEN` y opcional `WHATSAPP_GRAPH_API_VERSION`.

---

## V100-WA-005 — Envío saliente real (outbound) para preguntas y confirmaciones (hecho)

- Tipo: feature
- Módulo: integraciones / jobs
- Prioridad: high
- Estimación: 3
- Versión: v10.0
- Estado: done
- Dependencias: `V100-WA-002`, `V100-WA-004`

**Descripción:** Procesar la cola `whatsapp_outbound_message` y enviar mensajes reales por Meta Cloud API, actualizando estado de entrega y eventos de job.

**Criterios de aceptación:**

- [x] Existe worker `POST /api/cron/whatsapp/send-outbound` protegido por `CRON_SECRET`.
- [x] El worker toma mensajes `queued`, envía por Graph API y marca `sent` con timestamp.
- [x] En errores, marca `error` con `retry_count`, `last_error`, `last_error_at`.
- [x] Se registra `external_message_id` cuando Meta lo devuelve.
- [x] Se registran eventos `outbound_sent` / `outbound_error` en `whatsapp_job_event`.
- [x] Al confirmar sucursal por reply, se encola mensaje de confirmación al proveedor.

**Notas técnicas:** Implementado en `src/lib/whatsapp/send-message.ts` + `src/app/api/cron/whatsapp/send-outbound/route.ts`. Migración `095_whatsapp_outbound_delivery.sql`.

---

## V100-WA-006 — UI Bandeja WhatsApp (monitor + reintento manual) (hecho)

- Tipo: feature
- Módulo: dashboard / integraciones
- Prioridad: high
- Estimación: 5
- Versión: v10.0
- Estado: done
- Dependencias: `V100-WA-003`, `V100-WA-005`

**Descripción:** Exponer una bandeja operativa en dashboard para listar jobs de WhatsApp, ver estado/errores y disparar reintentos manuales desde UI.

**Criterios de aceptación:**

- [x] Existe ruta `/(dashboard)/whatsapp` accesible desde sidebar.
- [x] API `GET /api/whatsapp/jobs` lista jobs del tenant con metadata relevante.
- [x] API `POST /api/whatsapp/jobs` permite acción `reprocess` (no visor).
- [x] La UI muestra counters por estado y tabla con detalles (archivo, remitente, resolución sucursal, errores, destino).
- [x] Botón `Reintentar` disponible para estados reintentables y refresco de datos.
- [x] Respeta guards de módulo (`importador_excel` o acceso lector facturas).

**Notas técnicas:** UI en `src/components/whatsapp/whatsapp-jobs-client.tsx`, página `src/app/(dashboard)/whatsapp/page.tsx`, API en `src/app/api/whatsapp/jobs/route.ts`, navegación agregada en `src/components/dashboard/dashboard-chrome.tsx`.

---

## V100-WA-007 — Hardening: firma webhook Meta + rate limit inbound (hecho)

- Tipo: hardening
- Módulo: integraciones / seguridad
- Prioridad: high
- Estimación: 3
- Versión: v10.0
- Estado: done
- Dependencias: `V100-WA-001`

**Descripción:** Asegurar la ingesta inbound validando firma HMAC del webhook de Meta y limitando tasa de mensajes por tenant para evitar abuso o picos.

**Criterios de aceptación:**

- [x] Se valida `x-hub-signature-256` contra body raw cuando existe `WHATSAPP_WEBHOOK_APP_SECRET`.
- [x] Si la firma no valida, responde `401` y no procesa payload.
- [x] Se aplica rate limit en memoria por tenant para ventana de 1 minuto.
- [x] Mensajes que superan límite se descartan sin romper el webhook.
- [x] En ausencia de `WHATSAPP_WEBHOOK_APP_SECRET` (dev), no bloquea flujo.

**Notas técnicas:** `src/lib/whatsapp/webhook-signature.ts`, `src/lib/whatsapp/rate-limit.ts`, integración en `src/app/api/whatsapp/webhook/route.ts`.

---

# BLOQUE — v11.0 (Unidad de stock base y presentación de compra: caja, pack, pesable)

*Objetivo de la versión:* `stock_actual` y `registrar_movimiento` siguen en **una sola unidad canónica** por producto (unidad de venta/inventario). Se agregan metadatos opcionales de **presentación de compra** (p. ej. caja de 500 unidades, caja de 20 kg) y heurísticas de texto en **Importar** y **Listas de precios** con preview y override. Reglas de negocio y plan: `.cursor/plans/stock_multi-unidad_compra_venta_9ca0a029.plan.md` (no sustituye `docs/stock.md`).

---

## V110-STOCK-001 — Migración: `unidad_compra` y `contenido_unidad_compra` en `producto` (hecho)

- Tipo: migration
- Módulo: stock / base de datos
- Prioridad: high
- Estimación: 2
- Versión: v11.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Extender la tabla `producto` con la presentación típica del proveedor y el factor a unidades base (p. ej. 500 clavos por caja, o gramos por caja si la base es `gramo`). `stock_actual` sigue expresado solo en `producto.unidad`.

**Criterios de aceptación:**

- [x] Nueva migración SQL (número correlativo en `supabase/migrations/`) agrega columnas acordadas (p. ej. `unidad_compra` nullable referenciando `unidad_medida` o equivalente, `contenido_unidad_compra` `NUMERIC` nullable con precisión adecuada).
- [x] Constraint o check: si `unidad_compra` no es null, `contenido_unidad_compra` &gt; 0; si no hay presentación, ambos null.
- [x] Comentarios en columna o documentación de migración aclarando que el stock no cambia de semántica.
- [x] `supabase db push` / migración aplicable sin romper RLS ni triggers existentes.
- [x] Regenerar tipos TypeScript de Supabase (`src/types/database.ts`) tras aplicar (ticket siguiente puede hacerlo si se empaqueta junto; si no, este ticket incluye regeneración).

**Notas técnicas:** Ver `docs/base-de-datos.md` (tabla `producto`), función `registrar_movimiento` sin cambio de firma: la conversión ocurre en capa de aplicación antes del RPC. Convención pesables: alinear con `es_pesable` y unidad `kg`/`gramo`.

---

## V110-STOCK-002 — API y validación: presentación de compra en productos (hecho)

- Tipo: feature
- Módulo: stock / API
- Prioridad: high
- Estimación: 3
- Versión: v11.0
- Estado: done
- Dependencias: `V110-STOCK-001`

**Descripción:** Exponer y validar los nuevos campos en `GET`/`POST`/`PATCH` de productos (`src/app/api/productos/route.ts` y rutas relacionadas), coherente con reglas de negocio y soft deletes.

**Criterios de aceptación:**

- [x] `POST` y `PATCH` aceptan y validan `unidad_compra` y `contenido_unidad_compra` (rechazar combinaciones inválidas con 400 claro).
- [x] `GET` / listados relevantes devuelven los campos cuando existan.
- [x] Tipos y selects de Supabase alineados con la migración.
- [x] Sin regresiones en creación de producto ni en matching del importador por código/proveedor.

**Notas técnicas:** `docs/stock.md`, rutas bajo `src/app/api/productos/`.

---

## V110-STOCK-003 — UI ficha producto: bloque “Presentación de compra” (hecho)

- Tipo: feature
- Módulo: stock / UI
- Prioridad: high
- Estimación: 4
- Versión: v11.0
- Estado: done
- Dependencias: `V110-STOCK-002`

**Descripción:** En alta y edición de producto, permitir configurar presentación de compra opcional y mostrar ayuda clara: stock y ventas siguen en la **unidad base** del producto; la presentación solo define factor para entradas/compras.

**Criterios de aceptación:**

- [x] Formularios de nuevo producto y edición incluyen campos de presentación de compra (vacíos por defecto).
- [x] Texto de ayuda accesible (no ambiguo con unidad de venta).
- [x] Validación en cliente coherente con API (mensajes de error comprensibles).
- [x] Estilo alineado con el resto del dashboard (shadcn/Tailwind existente).

**Notas técnicas:** `src/app/(dashboard)/productos/nuevo/page.tsx`, páginas de detalle/edición de producto si aplica.

---

## V110-STOCK-004 — Entradas de stock en unidad de compra (conversión a unidad base) (hecho)

- Tipo: feature
- Módulo: stock
- Prioridad: high
- Estimación: 5
- Versión: v11.0
- Estado: done
- Dependencias: `V110-STOCK-002`

**Descripción:** Donde el operador registra **entradas** de stock, permitir indicar cantidad en “unidad de compra” cuando el producto tiene factor configurado; el sistema convierte a unidad base antes de `registrar_movimiento` (entrada). Si no hay factor, comportamiento actual sin cambios.

**Criterios de aceptación:**

- [x] Flujo de movimiento de entrada (UI y/o API interna usada) permite elegir o detectar “entrada en caja/pack” vs “entrada en unidad base” cuando aplica.
- [x] La cantidad persistida en `movimiento.cantidad` y el delta de `stock_actual` reflejan **siempre** la unidad base.
- [x] Casos sin `contenido_unidad_compra` no requieren pasos extra.
- [x] Pruebas manuales o tests automatizados mínimos para conversión (ej. 2 cajas × 500 = 1000 unidades).

**Notas técnicas:** Buscar llamadas a `registrar_movimiento` en entradas; `docs/stock.md` sección movimientos. Lector de facturas / WhatsApp a importador queda fuera salvo que ya comparta la misma API de movimiento.

---

## V110-STOCK-005 — `inferirPresentacionDesdeTexto` + preview en Importar y Listas de precios (hecho)

- Tipo: feature
- Módulo: importador / analizador / stock
- Prioridad: medium
- Estimación: 5
- Versión: v11.0
- Estado: done
- Dependencias: `V110-STOCK-002`

**Descripción:** Implementar función pura compartida (regex/heurísticas ES) que, desde `nombre`/`descripcion`/`nombre_raw`, sugiera `contenido_unidad_compra` y presentación. Integrarla en el flujo de **Importar productos** (`ejecutarImportacionFilas`, preview) y en **cargar listas** del analizador (`extraer-lista`, preview bajo `api/analizador/listas`), mostrando sugerencias con **checkbox / edición**; columnas explícitas del archivo ganan sobre el texto.

**Criterios de aceptación:**

- [x] Módulo único reutilizable (p. ej. bajo `src/lib/producto/` o `src/lib/normalizador/`) con tests unitarios de strings representativos (caja x N, kg, pack, etc.).
- [x] Importar: columnas opcionales `unidad_compra` / `contenido_unidad_compra` en preview; si no se mapean, la inferencia corre en servidor al ejecutar (`resolverPresentacionCompraImport`).
- [x] Listas de precios: columna «Compra (sug.)» en preview (`upload-lista`) desde `presentacion_inferida`.
- [x] No sobrescribir silenciosamente valores ya mapeados en columnas dedicadas.
- [x] Documentar límites (falsos positivos, marketing) en comentario breve o doc técnica.

**Notas técnicas:** `src/lib/importar/ejecutar-importacion.ts`, `src/lib/analizador/extraer-lista.ts`, `docs/importador.md`, componentes de preview del analizador.

---

## V110-STOCK-006 — Documentación: unidad base vs compra y pesables (hecho)

- Tipo: documentation
- Módulo: stock
- Prioridad: medium
- Estimación: 2
- Versión: v11.0
- Estado: done
- Dependencias: `V110-STOCK-001`, `V110-STOCK-005` (para describir también heurísticas)

**Descripción:** Actualizar `docs/stock.md` y la sección de tabla `producto` en `docs/base-de-datos.md` con la convención de unidad canónica, campos de presentación de compra, ejemplos (clavos por caja; pesable en gramos con caja en kg) y referencia al preview del importador/listas.

**Criterios de aceptación:**

- [x] `docs/base-de-datos.md` refleja nuevas columnas y restricciones.
- [x] `docs/stock.md` explica flujo operativo para el usuario final y enlaces a importador/listas si aplica.
- [x] Fecha de actualización y estado del doc revisados.

**Notas técnicas:** Coherente con implementación real de nombres de columnas y rutas.

---

# BLOQUE V11.1 — Producto único (decisiones 2026-04-28)

Ver **`docs/plan producto unico.md`** (sección *Decisiones registradas*): alcance **todos los tenants**; fusión automática **solo** si catálogo idéntico en todas las filas del grupo.

## V110-PROD-F01 — Fase 0: archivar resumen por tenant (todo)

- Tipo: operación / datos
- Módulo: stock / tenant
- Prioridad: high
- Estimación: 1
- Versión: v11.1
- Estado: todo
- Dependencias: ninguna

**Descripción:** Ejecutar la **primera query** (resumen por `tenant_id`, buckets `limpio` / `trivial` / etc.) del script `supabase/scripts/auditoria-producto-unico.sql` y guardar CSV/Excel con nombre claro (ej. `auditoria-producto-unico-resumen-tenants.csv`).

**Criterios de aceptación:**

- [ ] Archivo de resumen por tenant archivado junto al export de detalle de grupos.
- [ ] Enlace o ruta documentada en el plan o wiki interna.

**Notas técnicas:** `docs/plan producto unico.md` fase 0.

---

## V110-PROD-F02 — Fase 4: job fusión solo grupos catálogo idéntico (todo)

- Tipo: migration / backend
- Módulo: stock
- Prioridad: critical
- Estimación: 13
- Versión: v11.1
- Estado: todo
- Dependencias: `V110-PROD-F01` (dimensionamiento), decisiones en plan

**Descripción:** Implementar migración/RPC y runner por tenant que fusione **únicamente** grupos `(tenant_id, codigo normalizado, unidad)` donde todas las filas activas coinciden en los campos acordados en el plan. Excluir el resto sin modificar. Incluir `merged_into`, repunte de FKs y log.

**Criterios de aceptación:**

- [ ] Criterios de “idéntico” implementados y testeados con fixtures.
- [ ] Dry-run o modo reporte que liste cuántos grupos fusionaría vs excluidos.
- [ ] Documentación en `docs/plan producto unico.md` o `docs/base-de-datos.md` actualizada al merge.

**Notas técnicas:** Esqueleto SQL en `docs/plan producto unico.md` fase 4.

---

## V110-PROD-F03 — Export de grupos excluidos (duplicados no fusionables) (todo)

- Tipo: feature / ops
- Módulo: stock
- Prioridad: medium
- Estimación: 5
- Versión: v11.1
- Estado: todo
- Dependencias: `V110-PROD-F02` (misma definición de grupo)

**Descripción:** Script o endpoint admin que liste grupos con más de una fila activa **pero** catálogo no idéntico, para priorizar corrección en importador o edición masiva.

**Criterios de aceptación:**

- [ ] Salida CSV o JSON con `tenant_id`, clave grupo, conteos y motivo de exclusión (primer campo distinto).
- [ ] Sin mutar datos en modo solo lectura.

**Notas técnicas:** Reutilizar lógica de agrupación del script de auditoría.

---

## V120-CAT-001 — DB: `business_prefs`, `producto_lote_ingreso`, `movimiento.proveedor_id` (hecho)

- Tipo: feature
- Módulo: catálogo / importador / lector-facturas
- Prioridad: high
- Estimación: 8
- Versión: v12.0
- Estado: hecho
- Dependencias: ninguna

**Descripción:** Migraciones que sostienen la preferencia de unificación entre proveedores:

- `118_business_prefs_unificar_proveedor.sql`: agrega `tenant.business_prefs jsonb NOT NULL DEFAULT '{}'` y `sucursal.business_prefs jsonb NULL` (override).
- `119_producto_lote_ingreso.sql`: nueva tabla con RLS, índices, función `fecha_vencimiento_proxima_lote(producto_id)` y trigger que refresca `producto.fecha_vencimiento` con el `MIN(fecha_vencimiento)` de los lotes vivos.
- `120_movimiento_proveedor_id.sql`: agrega `movimiento.proveedor_id` y reescribe `registrar_movimiento` con un parámetro opcional `p_proveedor_id` al final (compatibilidad hacia atrás con todos los callers PL/pgSQL existentes).

**Criterios de aceptación:**

- [x] Las tres migraciones ejecutan en orden sin warnings.
- [x] `producto.fecha_vencimiento` queda sincronizado al insertar/actualizar/borrar lotes.
- [x] `registrar_movimiento` sigue funcionando con la firma vieja (10 args posicionales) y agrega `proveedor_id` cuando se pasa el 11.º argumento.

---

## V120-CAT-002 — API y prefs (`/api/configuracion/business-prefs`, helpers) (hecho)

- Tipo: feature
- Módulo: configuración
- Prioridad: high
- Estimación: 5
- Versión: v12.0
- Estado: hecho
- Dependencias: `V120-CAT-001`

**Descripción:** Capa de aplicación para leer y escribir `business_prefs`:

- `src/lib/business-prefs/prefs.ts`: tipo `BusinessPrefs`, defaults, normalización y merge tenant ⊕ sucursal.
- `src/lib/business-prefs/server.ts`: `loadEffectiveBusinessPrefs(supabase, tenantId, sucursalId)`.
- `src/lib/business-prefs/fetch.ts`: cliente con la misma forma que `fetchPosPrefsFromApi`.
- `src/app/api/configuracion/business-prefs/route.ts`: GET (con `for_config=1` opcional) y PATCH (`scope=tenant`, `sucursal_id+business_prefs`, o `sucursal_id+inherit_from_tenant`).

**Criterios de aceptación:**

- [x] Solo admin/super-admin edita los defaults del tenant.
- [x] Override por sucursal requiere admin o `sucursales.gestionar`.
- [x] El servidor normaliza siempre el JSON antes de guardar.

---

## V120-CAT-003 — Lógica upsert con proveedor + lotes en todos los flujos (hecho)

- Tipo: feature
- Módulo: importador / lector-facturas / productos / facturación
- Prioridad: high
- Estimación: 13
- Versión: v12.0
- Estado: hecho
- Dependencias: `V120-CAT-001`, `V120-CAT-002`

**Descripción:** Helpers compartidos en `src/lib/productos/upsert-con-proveedor.ts` (match estricto código + barcode, costo solo sube, registrar lote) y wiring en los cuatro flujos:

- `src/lib/importar/ejecutar-importacion.ts` y `src/app/api/importar/preflight/route.ts`: precarga tenant-wide cuando la pref está activa, match estricto código + barcode, `entrada` (no `ajuste`) en cross-proveedor, `p_proveedor_id` en `registrar_movimiento`, lote por ingreso (`importacionLogId`).
- `src/lib/lector-facturas/ejecutar-confirmacion-importado.ts`: `p_proveedor_id` en cada entrada de compra, regla "costo solo sube" en `actualizar_costos`, lote con `lectorFacturaLogId`.
- `src/app/api/productos/route.ts` (POST manual): detección de duplicado cross-proveedor (409) y lote inicial.
- `src/lib/facturacion/emitir-producto-borrador.ts` (POS al vuelo): mismo chequeo cross-proveedor y lote `origen=pos`.

**Criterios de aceptación:**

- [x] Con la pref OFF, el comportamiento es idéntico al anterior (regresión 0).
- [x] Con la pref ON y código + barcode coincidentes, el producto existente se actualiza sin pisar `proveedor_id`.
- [x] El stock cross-proveedor entra como `entrada` y queda en `producto_lote_ingreso` con vencimiento.

---

## V120-CAT-004 — UI configuración + ficha producto «Lotes / Vencimientos» + docs (hecho)

- Tipo: feature
- Módulo: ui / docs
- Prioridad: medium
- Estimación: 5
- Versión: v12.0
- Estado: hecho
- Dependencias: `V120-CAT-002`, `V120-CAT-003`

**Descripción:**

- `/configuracion`: nueva sección **Catálogo y proveedores** con tres toggles (`unificarProductosEntreProveedores`, `precioCostoSoloSube`, `registrarLotesPorIngreso`) y override por sucursal.
- Ficha producto (`/productos/[id]`): nueva sección **Lotes / Vencimientos** que lista `producto_lote_ingreso` (proveedor, sucursal, cantidad, costo, vencimiento, origen, fecha de ingreso). Endpoint nuevo: `GET /api/productos/[id]/lotes`.
- Docs actualizados: `docs/importador.md`, `docs/lector-facturas.md`, `docs/stock.md`, `docs/base-de-datos.md`.

**Criterios de aceptación:**

- [x] Toggles persisten en backend con tenant defaults y override de sucursal.
- [x] La ficha de producto muestra todos los lotes (incluso de proveedores distintos) ordenados por fecha de ingreso descendente.
- [x] La pref está apagada por defecto y solo aplica hacia adelante; los duplicados existentes no se tocan.

---

# BLOQUE — v13.0 (Hardening UX + bugs operativos front-first)

*Objetivo de la versión:* resolver observaciones de uso real sin romper flujos existentes. Priorizar cambios en frontend (estados, validaciones, microcopy, layout y componentes) y usar backend solo cuando sea estrictamente necesario para consistencia funcional.

**Plan sugerido por sprints (orden de ejecución):**

- **Sprint 1 (estabilidad crítica):** `V130-POS-001`, `V130-LIST-001`, `V130-STOCK-001`, `V130-IMP-001`, `V130-PROMO-001`.
- **Sprint 2 (claridad operativa y UX núcleo):** `V130-UI-001`, `V130-UI-002`, `V130-PROV-001`, `V130-IMP-002`, `V130-PROMO-002`, `V130-A11Y-001`, `V130-PROD-002`, `V130-SUC-001`.
- **Sprint 3 (mejoras de flujo y expansión):** `V130-IMP-003`, `V130-IMP-004`, `V130-NAV-001`, `V130-LAYOUT-001`, `V130-ONB-001`, `V130-PROD-001`, `V130-REP-001`, `V130-PROV-002`, `V130-CLI-001`, `V130-COMP-001`, `V130-FACT-001`.

**Regla de seguridad para todo el bloque v13.0:** cada ticket debe incluir prueba de no regresión del flujo actual antes de marcarse como `(hecho)`.

---

## V130-POS-001 — POSNET: permitir cobro en montos <= 1500 (hecho)

- Tipo: bug
- Módulo: pos / cobro
- Prioridad: critical
- Estimación: 3
- Versión: v13.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Corregir la validación que bloquea ventas por posnet cuando el importe es menor o igual a 1500.

**Criterios de aceptación:**

- [x] Cobro posnet funciona para montos 1499, 1500 y 1501.
- [x] No cambia el comportamiento de efectivo/transferencia/mixto.
- [x] Se muestra mensaje claro si existe otra regla de bloqueo (distinta al monto).
- [x] Sin regresiones en emisión y cierre de venta POS.

---

## V130-LIST-001 — Estado vacío confiable en listados con filtros (hecho)

- Tipo: bug
- Módulo: listados / filtros
- Prioridad: critical
- Estimación: 5
- Versión: v13.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Evitar que la UI muestre “no hay resultados” cuando en realidad hubo error de carga o timeout.

**Criterios de aceptación:**

- [x] Estados separados: loading, error y empty real.
- [x] “Reintentar” visible en estado error.
- [x] Mensajes de error no ambiguos para usuario.
- [x] Mantener filtros aplicados al reintentar.

---

## V130-STOCK-001 — Transferir stock: buscador por código/nombre sin falsos negativos (hecho)

- Tipo: bug
- Módulo: stock / transferencia
- Prioridad: critical
- Estimación: 5
- Versión: v13.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Mejorar búsqueda de productos en transferencia de stock para código exacto/parcial y nombre.

**Criterios de aceptación:**

- [x] Match por código y nombre (incluye parcial).
- [x] Normalización básica (mayúsculas/minúsculas y tildes).
- [x] Estado vacío solo cuando realmente no hay coincidencias.
- [x] La selección de producto mantiene la referencia correcta en el formulario.

---

## V130-IMP-001 — Mapeo guardado incompatible: detección y recuperación guiada (hecho)

- Tipo: bug
- Módulo: importador
- Prioridad: critical
- Estimación: 8
- Versión: v13.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Si un proveedor tiene mapeo guardado y llega un archivo con estructura distinta, detectar incompatibilidad y pedir reajuste sin romper el flujo.

**Criterios de aceptación:**

- [x] Detecta columnas faltantes/sobrantes respecto del mapeo guardado.
- [x] No ejecuta importación con mapeo inválido.
- [x] Ofrece re-mapear y continuar desde el mismo flujo.
- [x] Mensaje explica qué columnas fallaron y cómo resolver.

---

## V130-PROMO-001 — Validar motor de descuentos en múltiplos de promoción (hecho)

- Tipo: bug
- Módulo: promociones
- Prioridad: critical
- Estimación: 8
- Versión: v13.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Corregir/validar cálculo de ahorro y total cuando una promo aplica más de una vez por cantidad comprada.

**Criterios de aceptación:**

- [x] Cálculo correcto en casos base y múltiplos.
- [x] “Ahorro” y total final son coherentes con reglas de promo.
- [x] Se agregan pruebas automatizadas de regresión para promociones por unidad.

**Implementación:** En `n_x_m`, `porcentaje_unidad_n` y reparto `combo_precio_fijo`, el precio unitario efectivo ya no sale de `round2(totalPago / Q)` (que puede desalinear `round2(Q×PU)` con el total promocional). Se usa `precioUnitarioQueDaSubtotalLinea2Dec` para que el subtotal de línea coincide con el importe tras promo, alineado con `emitir-comprobante` y POS.

---

## V130-UI-001 — Reemplazar confirmaciones nativas del navegador por modal del sistema (hecho)

- Tipo: ux
- Módulo: ui
- Prioridad: high
- Estimación: 5
- Versión: v13.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Estandarizar confirmaciones de acciones críticas con modal propio (no `window.confirm`).

**Criterios de aceptación:**

- [x] No se usan confirmaciones nativas en flujos críticos.
- [x] Modal consistente con diseño del sistema.
- [x] Soporte teclado/ESC/foco accesible.

**Implementación:** Hook `useConfirm` (`src/hooks/use-confirm.tsx`) con `Dialog` del sistema (`confirm`, `alert` modo un botón). Navegación con cambios sin guardar: `useWarnUnsavedChanges` usa `confirmLeave` + `router.push` (sin `window.confirm`). Reemplazo en configuración (tenant/sucursales/usuarios/MP), producto detalle, import preview, IA precios, cajas MP, MP QR/Point, detalle comprobante; además proveedores, medios de pago, bandeja ARCA, categorías, cuenta corriente cliente, productos (lote). Cierre/recarga de pestaña sigue usando `beforeunload` (browser). **Seguimiento tooling:** codemod Next 16 `next-lint-to-eslint-cli`; `npm run lint` = `eslint .` + `check:native-dialogs`; `npm run check` = `tsc --noEmit` + diálogos; script `scripts/check-no-native-browser-dialogs.mjs`; CI en `.github/workflows/ci.yml` (lint + tsc). Varias reglas ESLint ruidosas están en `warn` hasta endurecer en otro ticket.

---

## V130-UI-002 — Inputs de monto inteligentes reutilizables (done)

- Tipo: ux
- Módulo: ui / formularios
- Prioridad: high
- Estimación: 5
- Versión: v13.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Crear un patrón único para inputs monetarios con formateo de miles y parsing robusto.

**Criterios de aceptación:**

- [x] Componente reutilizable para montos.
- [x] Formateo visual en escritura y pegado.
- [x] Valor enviado correcto (numérico) sin redondeos inesperados.

**Implementación:** `MontoInput` (`src/components/ui/monto-input.tsx`) controlado con `value: number | null` y formato editable vía `formatearMontoArgentinoEditable` (`src/lib/ui/monto-argentino.ts`), usando `parsearPrecioArgentino` para pegado/edición sin redondeos raros. Usos: editor de gastos de cierre (`gastos-caja-lineas-editor`), apertura/cierre de caja en dashboard (`cierre-caja-panel`, `pos-abrir-caja-modal`, `pos-cierre-caja-modal`). Tests: `src/test/monto-argentino.test.ts`.

---

## V130-PROV-001 — Alta de proveedor: feedback claro y sin recarga confusa (done)

- Tipo: ux
- Módulo: proveedores
- Prioridad: high
- Estimación: 3
- Versión: v13.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Mejorar experiencia al crear proveedor con feedback inmediato y refresco no disruptivo.

**Criterios de aceptación:**

- [x] Toast de éxito/error al finalizar alta.
- [x] El listado refleja el nuevo proveedor sin perder contexto del usuario.
- [x] Botón “Nuevo proveedor” alineado visualmente con acciones pares.

**Implementación:** Dependencia **`sonner`** (`Toaster` en `dashboard-chrome.tsx`, estilos en `globals.css`). `CrearProveedorDialog` dispara **`toast.success` / `toast.error`** según resultado (incluye fallo de red y payload inválido); `onCreado` pasa **`{ id, nombre }`** desde la respuesta del `POST`. **Proveedores** (`proveedores/page.tsx`): tras crear se hace **`load({ silent: true })`** para no enseñar spinner de tabla; cabecera con **`flex flex-wrap gap-2`**. **Importar** (`importar/page.tsx`): reemplazo de **`window.location.reload()`** por refetch de `/api/proveedores`, actualización de estado y **selección automática** del proveedor nuevo. **IA precios** (`ia-precios-client.tsx`): mismo diálogo in situ (antes link a `/proveedores?nuevo=1`); botón **outline `size="lg"`** alineado al select como en Importar.

---

## V130-IMP-002 — Deshabilitar “Usar mapeo guardado” sin mapeo previo (done)

- Tipo: bug
- Módulo: importador
- Prioridad: high
- Estimación: 2
- Versión: v13.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Evitar opción inválida cuando el proveedor nunca guardó mapeo.

**Criterios de aceptación:**

- [x] Control deshabilitado si no hay mapeo.
- [x] Texto aclaratorio visible para usuario.
- [x] No permite submit en estado inválido.

**Implementación:** `perfilTieneMapeoDeColumnas()` en `src/lib/normalizador/compatibilidad-perfil-import.ts` (requiere ≥1 campo con encabezado no vacío). En `src/app/(dashboard)/importar/page.tsx` se consulta `GET /api/proveedores/:id` al elegir proveedor; la casilla solo se habilita si **`proveedorTieneMapeoGuardado === true`**; durante la consulta queda deshabilitada y se muestra “Consultando perfil guardado…”; si no hay mapeo, texto explicando guardar desde importación anterior. En `onArchivoParsed`, el atajo solo corre si esa verificación (**`proveedorTieneMapeoGuardado === true`**) coincide con la casilla. Tests en `src/test/compatibilidad-perfil-import.test.ts`.

---

## V130-IMP-003 — Clarificar “Descargar plantilla” como ejemplo editable (done)

- Tipo: ux-content
- Módulo: importador
- Prioridad: medium
- Estimación: 2
- Versión: v13.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Mejorar copy y ayudas para que el usuario entienda la plantilla como archivo base para completar.

**Criterios de aceptación:**

- [x] CTA y texto explicativo más explícitos.
- [x] Se indica en UI que la plantilla es editable.

**Implementación:** Bloque «Ejemplo editable en Excel» en `src/app/(dashboard)/importar/page.tsx`: aclara que el .xlsx es opcional, editable (reemplazar muestras, guardar como .xlsx o CSV), encabezados orientativos y mapeo posterior. CTA con icono `Download` y estilo `buttonVariants({ outline })`: «Descargar ejemplo para completar (.xlsx)».

---

## V130-PROMO-002 — UX de selección y detalle de promociones (done)

- Tipo: ux
- Módulo: promociones
- Prioridad: high
- Estimación: 5
- Versión: v13.0
- Estado: done
- Dependencias: `V130-PROMO-001`

**Descripción:** Hacer más clara la selección de promociones y mostrar días habilitados en detalle.

**Criterios de aceptación:**

- [x] Estado seleccionado/no seleccionado visualmente inequívoco.
- [x] Detalle de promoción muestra días vigentes en lenguaje claro.
- [x] Sin cambios de negocio en reglas de aplicación.

**Implementación:** Helpers `textoDiasHabilesPromocion`, `textoDiasHabilesPromocionCorto`, `ordenDiasSemanaPromocion`, `etiquetaDiaPromocion` en `src/lib/promociones/dias-semana-ui.ts` (solo presentación; vigencia y motor sin cambios). **Listado** (`promociones/page.tsx`): fila con borde lateral y fondo distinto activa/inactiva; control “Activa en catálogo” en caja con estado legible y `aria-label`. **Detalle** (`promociones/[id]/page.tsx`): sección “Días en que aplica” con frase (“Lunes a viernes”, etc.) y chips por día. **Alta/edición** (`promocion-form.tsx`): modo día con botones tipo segmento + días con estilo alto contraste al seleccionar. **Ficha producto**: sublínea de promo con días en texto corto (`producto-detalle-client.tsx`, normaliza `dias_semana` desde API). Tests en `src/test/promociones.test.ts`.

---

## V130-NAV-001 — Sidebar colapsable con iconografía no ambigua (done)

- Tipo: feature
- Módulo: navegación / ui
- Prioridad: medium
- Estimación: 8
- Versión: v13.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Implementar menú lateral plegable y corregir íconos duplicados/confusos.

**Criterios de aceptación:**

- [x] Sidebar expandido/colapsado con transición estable.
- [x] Persistencia de estado por usuario/sesión.
- [x] Íconos de “Movimientos” y “Transferir stock” diferenciados.

**Implementación:** `dashboard-chrome.tsx`: barra lateral desktop (`md+`) con **`transition-[width]`** (`w-60` ↔ ~`3.625rem`). Preferencia **`localStorage`** (`nexus.dashboard.sidebarCollapsed` = `'1'`/`'0'`). Botón inferior **ChevronsLeft / ChevronsRight**. Modo colapsado: ítems hoja sólo ícono + `sr-only`/`title`; grupos abren **panel flotante** junto al borde (`DesktopCollapsedFlyoutPanel`) con backdrop, cierre clic fuera y **Escape**; **`viewportMdUp`** con `matchMedia` para no usar panel en drawer móvil. **Movimientos** → icono **`History`**; **Transferir stock** → **`Route`** (quitados `ArrowLeftRight`/`ArrowRightLeft` en NAV).

---

## V130-LAYOUT-001 — Ajustes de layout, jerarquía visual y CTAs principales (hecho)

- Tipo: ux
- Módulo: ui global
- Prioridad: medium
- Estimación: 8
- Versión: v13.0
- Estado: done ✅
- Dependencias: ninguna

**Descripción:** Rebalancear uso de ancho de contenido, jerarquía visual y ubicación de CTAs principales.

**Criterios de aceptación:**

- [x] Menor espacio muerto lateral en vistas desktop.
- [x] CTA principal ubicado de forma consistente como acción de cierre.
- [x] Sin desbordes de inputs/contenedores en formularios críticos.

---

## V130-ONB-001 — Onboarding modal: copy por paso y simplificación de acciones (hecho)

- Tipo: ux-content
- Módulo: onboarding
- Prioridad: medium
- Estimación: 3
- Versión: v13.0
- Estado: done ✅
- Dependencias: ninguna

**Descripción:** Mejorar claridad de pasos y reducir acciones redundantes del modal introductorio.

**Criterios de aceptación:**

- [x] “Paso X de Y” incluye contexto de la tarea actual.
- [x] Mensaje de omitir/cerrar reubicado en zona secundaria.
- [x] CTAs principales sin duplicar intención.

---

## V130-A11Y-001 — Contraste y legibilidad de textos (hecho)

- Tipo: accesibilidad
- Módulo: ui global
- Prioridad: high
- Estimación: 5
- Versión: v13.0
- Estado: done ✅
- Dependencias: ninguna

**Descripción:** Corregir combinaciones de texto/fondo con contraste insuficiente en pantallas operativas.

**Criterios de aceptación:**

- [x] Textos de alta importancia cumplen contraste mínimo objetivo.
- [x] Tokens/clases ajustados sin romper tema visual.

---

## V130-PROD-001 — Productos: copy y simplificación de acciones redundantes (hecho)

- Tipo: ux-content
- Módulo: productos
- Prioridad: medium
- Estimación: 3
- Versión: v13.0
- Estado: done ✅
- Dependencias: ninguna

**Descripción:** Ajustar microcopy (“Agregar producto”) y reducir acciones duplicadas respecto del sidebar.

**Criterios de aceptación:**

- [x] Label principal actualizado a “Agregar producto”.
- [x] Se eliminan o relegan acciones redundantes sin perder acceso.
- [x] Se corrige overflow visual en contenedores de inputs.

---

## V130-PROD-002 — Mostrar valor real de IVA default del tenant (hecho)

- Tipo: ux
- Módulo: productos / configuración
- Prioridad: high
- Estimación: 2
- Versión: v13.0
- Estado: done ✅
- Dependencias: ninguna

**Descripción:** En UI, mostrar el porcentaje efectivo (ej. 21%) en lugar del texto genérico de IVA default.

**Criterios de aceptación:**

- [x] Se ve el valor real de IVA default vigente.
- [x] Formato consistente con el resto de porcentajes.

---

## V130-SUC-001 — Mostrar nombre de sucursal seleccionada (todo)

- Tipo: ux
- Módulo: selector de sucursal
- Prioridad: high
- Estimación: 2
- Versión: v13.0
- Estado: todo
- Dependencias: ninguna

**Descripción:** Reemplazar representaciones ambiguas por nombre legible de sucursal en filtros y encabezados.

**Criterios de aceptación:**

- [ ] El usuario siempre ve nombre de sucursal en estado seleccionado.
- [ ] Se conserva id interno para consultas/API.

---

## V130-REP-001 — Formato de fecha en actividades a `dd/mm/aaaa` (hecho)

- Tipo: ux
- Módulo: reportes / actividades
- Prioridad: medium
- Estimación: 2
- Versión: v13.0
- Estado: done ✅
- Dependencias: ninguna

**Descripción:** Estandarizar formato de fecha orientado a AR en listas de actividad.

**Criterios de aceptación:**

- [x] Fechas visibles en formato `dd/mm/aaaa`.
- [x] Orden cronológico correcto y sin roturas de parsing.

---

## V130-IMP-004 — Unificar entrada de importación IA + Excel en una sola pantalla (todo)

- Tipo: feature
- Módulo: importador / ia
- Prioridad: medium
- Estimación: 13
- Versión: v13.0
- Estado: todo
- Dependencias: `V130-IMP-001`, `V130-IMP-002`, `V130-IMP-003`

**Descripción:** Rediseñar UX de importación para decidir flujo por tipo de archivo en una experiencia unificada.

**Criterios de aceptación:**

- [ ] Una sola entrada soporta PDF/JPG/PNG/WEBP y Excel/CSV.
- [ ] El flujo adecuado se selecciona automáticamente por tipo de archivo.
- [ ] Se mantiene compatibilidad de validaciones y preview actuales.
- [ ] No se rompen rutas/API existentes en etapa inicial (feature flag opcional).

---

## V130-PROV-002 — Ficha proveedor: mostrar últimos pagos en resumen (hecho)

- Tipo: feature
- Módulo: proveedores
- Prioridad: medium
- Estimación: 5
- Versión: v13.0
- Estado: done
- Dependencias: ninguna

**Descripción:** En `/proveedores/[id]`, agregar bloque de últimos pagos como referencia rápida.

**Criterios de aceptación:**

- [x] Se listan últimos pagos con fecha, medio e importe.
- [x] Enlace claro a reportes para ver historial completo.

---

## V130-CLI-001 — Registrar pagos de clientes desde su cuenta corriente (hecho)

- Tipo: feature
- Módulo: clientes / cobranza / caja
- Prioridad: high
- Estimación: 13
- Versión: v13.0
- Estado: done
- Dependencias: ninguna

**Descripción:** Permitir cargar pagos de clientes para descontar deuda desde la propia sección de cuenta corriente.

**Criterios de aceptación:**

- [x] Registrar pago reduce deuda correctamente.
- [x] Si medio es efectivo, impacta caja; otros medios registran pago sin sumar caja.
- [x] Se deja trazabilidad del movimiento y confirmación visual.

---

# BLOQUE WhatsApp agéntico — v14.0 (consultas por texto/audio + identidad + acciones)

Contrato funcional, guía en lenguaje sencillo y detalle técnico viven en el **plan maestro** del equipo (Cursor Plan *WhatsApp Agéntico SmartStock*). Este bloque resume los tickets ejecutables; al publicar el plan en el repo, enlazarlo desde `docs/` (p. ej. `docs/PLAN-WA-AGENTICO.md`).

Código existente: `src/app/api/whatsapp/webhook/route.ts`, `src/lib/whatsapp/*`, `src/app/api/cron/whatsapp/*`, migraciones `whatsapp_*` en `supabase/migrations/`.

---

## V140-WA-001 — Migración: identidad WhatsApp (`whatsapp_actor`, `whatsapp_auth_challenge`) (hecho)

- Tipo: migration
- Módulo: whatsapp / seguridad
- Prioridad: critical
- Estimación: 5
- Versión: v14.0
- Estado: done
- Dependencias: tablas `whatsapp_channel` y multitenancy existentes

**Descripción:** Crear tablas para vincular el número de WhatsApp del remitente con un `usuario` del tenant, y para gestionar códigos OTP con hash (no guardar código en claro). Incluir índices únicos por tenant para actor activo por `from_wa_id`, campos `trust_level`, `replaced_by_actor_id`, estados de challenge y contadores de intento/reenvío según contrato del plan.

**Criterios de aceptación:**

- [x] Migración SQL versionada en `supabase/migrations/` con RLS/policies coherentes con el resto de `whatsapp_*`.
- [x] Restricciones: al menos un único actor activo por `(tenant_id, from_wa_id)` cuando `activo = true`.
- [x] `whatsapp_auth_challenge` soporta estados `pending|verified|expired|blocked|cancelled` y campos para expiración, intentos y bloqueo.
- [x] Tipos regenerados (`npm run gen:types` o script del repo) si aplica al flujo del equipo (comando validado; en este entorno faltan credenciales Supabase para ejecutar la generación remota).
- [x] Documentar en `docs/base-de-datos.md` (o doc vinculada) el significado de cada campo y la política de cambio de número (nuevo actor + OTP + desactivar anterior).

**Notas técnicas:** Implementado en migración `supabase/migrations/156_whatsapp_actor_auth_challenge.sql`. Parámetros OTP del contrato: expiración 10 min, máx. 5 intentos, cooldown bloqueo 15 min, máx. 3 reenvíos / 30 min. Política cambio de número: no migrar en caliente; nuevo registro `unverified` → OTP → anterior `activo=false` y enlace `replaced_by_actor_id`.

---

## V140-WA-002 — Panel + APIs: vincular número WhatsApp a usuario (onboarding OTP) (hecho)

- Tipo: feature
- Módulo: whatsapp / auth operativo
- Prioridad: critical
- Estimación: 13
- Versión: v14.0
- Estado: done
- Dependencias: `V140-WA-001`

**Descripción:** Flujo para owner/admin: ingresar número a vincular, disparar envío de código por WhatsApp (reutilizar `sendWhatsAppTextMessage` u outbound queue), endpoint para validar código y marcar `whatsapp_actor` como `verified`. Manejar reintentos y bloqueo según contrato.

**Criterios de aceptación:**

- [x] Solo roles autorizados pueden iniciar vinculación para un usuario de su tenant.
- [x] OTP nunca se persiste en claro; solo hash + salt (o equivalente seguro).
- [x] Tras verificación exitosa: `trust_level=verified`, `verified_at` seteado.
- [x] Cambio de número: crea nuevo actor, verifica, desactiva el anterior y enlaza reemplazo.
- [x] UX clara en panel (mensajes de error por expirado, bloqueado, intentos agotados).

**Notas técnicas:** Implementado con API `src/app/api/whatsapp/actors/route.ts`, helper `src/lib/whatsapp/otp.ts` y panel en `src/components/whatsapp/whatsapp-jobs-client.tsx`. Reutiliza cola `whatsapp_outbound_message` (`phone_number_id` del canal activo) para envío OTP.

---

## V140-WA-003 — Cron: expirar challenges OTP `pending` vencidos (hecho)

- Tipo: chore
- Módulo: whatsapp
- Prioridad: medium
- Estimación: 2
- Versión: v14.0
- Estado: done
- Dependencias: `V140-WA-001`

**Descripción:** Job programado (cada 5–10 min) que marca `expired` los registros `whatsapp_auth_challenge` con `status=pending` y `expires_at < now()`, para no acumular filas huérfanas.

**Criterios de aceptación:**

- [x] Ruta cron protegida con `CRON_SECRET` (mismo patrón que `src/app/api/cron/whatsapp/*`).
- [x] Actualización idempotente y acotada (batch razonable o índice por `expires_at`).
- [x] Log o métrica mínima de filas actualizadas (opcional pero recomendado).

**Notas técnicas:** Implementado en `src/app/api/cron/whatsapp/expire-otp/route.ts` con `limit` configurable por querystring (default 500, max 2000), actualización por lote e `info log` de expirados.

---

## V140-WA-004 — Agente consultas (solo lectura): texto, clasificación, tools y telemetría (hecho)

- Tipo: feature
- Módulo: whatsapp / ia
- Prioridad: critical
- Estimación: 21
- Versión: v14.0
- Estado: done
- Dependencias: `V140-WA-001`, `V140-WA-002`

**Descripción:** Tras verificar `whatsapp_actor`, procesar mensajes de texto libres: entender intención (reglas determinísticas primero, modelo de texto solo para ambiguos), completar datos faltantes con repregunta, ejecutar **solo consultas** a datos reales reutilizando lógica/API existente (deuda clientes/proveedores, stock, reportes acotados). Cada ejecución valida explícitamente `tenantId` (y sucursal cuando aplique) antes de consultar; no confiar solo en RLS para el aislamiento del agente. Registrar telemetría desde el primer release: intent detectado, confianza, fallback, herramienta usada, latencia.

**Criterios de aceptación:**

- [x] Sin actor verificado: no exponer datos sensibles del negocio; mensaje guía hacia vinculación (o respuesta mínima acordada).
- [x] Catálogo inicial de consultas: deuda proveedor, deuda cliente / cuenta corriente, stock por producto, al menos un reporte acotado.
- [x] Ejemplos negativos en prompts/reglas para no invocar “herramientas” fuera de catálogo.
- [x] Respuestas en español claro, montos/fechas alineados a formatos del producto.
- [x] Eventos de telemetría persistidos o enviados a log estructurado (definir destino en implementación).

**Notas técnicas:** Implementado en `src/lib/whatsapp/read-only-agent.ts` e integrado a `src/app/api/whatsapp/webhook/route.ts`. Usa validación de actor (`whatsapp_actor` verificado), herramientas read-only con `tenant_id` explícito, y telemetría vía `console.info` estructurado (`intent`, `confidence`, `tool`, `fallbackReason`).

---

## V140-WA-005 — Audio y notas de voz: ingesta, formato WhatsApp, STT, mismo flujo que texto (hecho)

- Tipo: feature
- Módulo: whatsapp / ia
- Prioridad: high
- Estimación: 13
- Versión: v14.0
- Estado: done
- Dependencias: `V140-WA-004`

**Descripción:** Extender parser de mensajes entrantes para tipos `audio` / `voice`, encolar procesamiento, descargar media (patrón existente), convertir si hace falta desde `.ogg/opus` a formato aceptado por el proveedor STT, transcribir y pasar el texto al mismo pipeline que mensajes de texto.

**Criterios de aceptación:**

- [x] Nota de voz y audio tratados de forma unificada post-transcripción.
- [x] Manejo de error claro al usuario si el audio no se puede transcribir.
- [x] Misma política de identidad que texto (`V140-WA-002`).
- [x] No duplicar lógica de negocio: un solo “manejador de texto” tras STT.

**Notas técnicas:** Implementado en `src/lib/whatsapp/inbound.ts` (tipos audio/voice), `src/lib/whatsapp/job-routing.ts` (flujo `audio_transcription`), `src/app/api/cron/whatsapp/process-queued/route.ts` (STT + enrutado al text-handler), `src/lib/whatsapp/stt.ts` (transcripción) y `src/lib/whatsapp/text-handler.ts` (handler único compartido con texto).

---

## V140-WA-006 — Acciones por WhatsApp: confirmación doble, firma idempotente y auditoría (hecho)

- Tipo: feature
- Módulo: whatsapp / cobranza / stock
- Prioridad: high
- Estimación: 21
- Versión: v14.0
- Estado: done
- Dependencias: `V140-WA-004`

**Descripción:** Habilitar acciones transaccionales (p. ej. registrar pago, movimiento de stock) solo tras confirmación explícita en dos pasos en el chat. Definir `action_signature` reproducible: hash estable de `wamid + tool_name + params_canonicalizados + tenant_id` con JSON de parámetros con claves ordenadas; unique por tenant para deduplicar. Persistir auditoría (quién, qué, params, resultado, timestamp).

**Criterios de aceptación:**

- [x] Ninguna acción sensible en un solo mensaje sin confirmación.
- [x] Reintentos de red / duplicados de webhook no ejecutan la acción dos veces.
- [x] Permisos alineados a rol del `whatsapp_actor` y módulos del tenant.
- [x] Al menos una acción piloto end-to-end con tests o checklist QA documentado.

**Notas técnicas:** Acción piloto implementada: `registrar_pago_cuenta_proveedor` con doble confirmación (`SI <token>`), tabla de auditoría/idempotencia `whatsapp_action_log` (migración `157_whatsapp_action_log.sql`), firma canónica SHA-256 (`wamid + tool + payload + tenant`) y ejecución desde `src/lib/whatsapp/action-handler.ts`.

---

## V140-WA-007 — Rollout y hardening: feature flag por tenant, métricas y runbook (hecho)

- Tipo: chore
- Módulo: whatsapp / ops
- Prioridad: medium
- Estimación: 8
- Versión: v14.0
- Estado: done
- Dependencias: `V140-WA-004`

**Descripción:** Activación gradual por tenant (flag en config o tabla), alertas básicas sobre colas/cron, consolidación de métricas capturadas desde `V140-WA-004`, documentación operativa para soporte (qué hacer si OTP falla, bloqueos, desvincular número).

**Criterios de aceptación:**

- [x] Comercio piloto puede tener el canal activo sin afectar al resto.
- [x] Documento breve en `docs/` (runbook + criterios de activación).
- [x] Lista de verificación pre-producción (seguridad, rate limits, costos STT/LLM).

**Notas técnicas:** Implementado con tabla `whatsapp_agent_feature_flag` (migración `158_whatsapp_agent_feature_flag.sql`), API `src/app/api/whatsapp/feature-flag/route.ts`, toggle en `src/components/whatsapp/whatsapp-jobs-client.tsx`, gating en `src/lib/whatsapp/text-handler.ts` y `src/app/api/cron/whatsapp/process-queued/route.ts`. Runbook en `docs/whatsapp-agentico-runbook.md`.

---

# BLOQUE WhatsApp agéntico — v14.1 (iteración conversacional: memoria + semántica + utilidad)

Objetivo: llevar el agente de WhatsApp de “intents aislados” a conversación útil y natural, manteniendo respuestas basadas en tools/DB reales. Esta iteración se enfoca en memoria corta por chat, semántica de consultas genéricas vs exactas, y UX de reportes masivos.

---

## V141-WA-001 — Memoria conversacional por actor (contexto corto + slots) (hecho)

- Tipo: feature
- Módulo: whatsapp / ia
- Prioridad: critical
- Estimación: 13
- Versión: v14.1
- Estado: done
- Dependencias: `V140-WA-004`

**Descripción:** Persistir contexto corto por actor/tenant para que el agente recuerde qué tema se estaba tratando (stock/deuda cliente/deuda proveedor), la última entidad mencionada y opciones desambiguadas recientes.

**Criterios de aceptación:**

- [x] Se guarda estado conversacional por `(tenant_id, actor_id|from_wa_id)` con TTL configurable (ej. 30 min).
- [x] Slots mínimos: `topic`, `last_intent`, `last_entity_type`, `last_entity_name`, `last_options`.
- [x] Mensajes de seguimiento como “ese”, “el primero”, “proveedor”, “el de arriba” se resuelven usando contexto antes de caer en fallback.
- [x] Si no hay contexto válido (expirado o inconsistente), repregunta clara sin inventar resultados.

**Notas técnicas:** Implementado con migración `supabase/migrations/161_whatsapp_conversation_state.sql` + helper `src/lib/whatsapp/conversation-memory.ts`. Integración en `src/lib/whatsapp/text-handler.ts` para cargar estado, resolver follow-ups contextuales y persistir slots con TTL configurable (`WHATSAPP_CONVERSATION_TTL_MINUTES`).

---

## V141-WA-002 — Semántica de stock útil: “más bajo hoy” vs “stock bajo por mínimo” (hecho)

- Tipo: feature
- Módulo: whatsapp / stock / ia
- Prioridad: high
- Estimación: 8
- Versión: v14.1
- Estado: done
- Dependencias: `V141-WA-001`

**Descripción:** Separar explícitamente dos consultas que hoy se confunden: (a) producto(s) con menor stock real actual y (b) reporte de stock bajo contra `stock_minimo`.

**Criterios de aceptación:**

- [x] Intent nuevo para “producto con menos stock / stock más bajo hoy”.
- [x] Tool nueva: ranking por `stock_actual` ascendente (controlando negativos y cero) con variante singular/plural.
- [x] Intent actual “stock bajo” mantiene semántica por `stock_minimo`.
- [x] Respuesta explica criterio usado (“menor stock real” vs “bajo mínimo”) para evitar ambigüedad.

**Notas técnicas:** Implementado en `src/lib/whatsapp/read-only-agent.ts` con intent `stock_mas_bajo` + tool `getProductLowestStock` (`runStockMasBajoTool`) y copy explicativa. Se mantiene `reporte_stock_bajo` con criterio por `stock_minimo`.

---

## V141-WA-003 — Continuidad de tema en deuda proveedor/cliente (hecho)

- Tipo: feature
- Módulo: whatsapp / ia
- Prioridad: high
- Estimación: 8
- Versión: v14.1
- Estado: done
- Dependencias: `V141-WA-001`

**Descripción:** Evitar “reseteos” de contexto en flujo de deuda. Si el usuario venía hablando de proveedores, frases elípticas (“pasame la deuda de GinkGo”, “PROVEEDOR”) deben respetar el tema actual sin pedir de nuevo la misma aclaración.

**Criterios de aceptación:**

- [x] Si el tema actual es proveedores, “deuda de X” se interpreta por defecto como proveedor (salvo evidencia fuerte en contra).
- [x] Respuestas de una sola palabra (`proveedor`, `cliente`) aplican al hilo activo y avanzan el flujo.
- [x] Cuando falte entidad puntual, repregunta en lenguaje natural con 1 ejemplo útil (no listado rígido).
- [x] Telemetría registra cuando se usó contexto para resolver intención.

**Notas técnicas:** Implementado con resolución contextual en `src/lib/whatsapp/text-handler.ts` (follow-ups: “deuda de X” sin scope, “PROVEEDOR/CLIENTE”, referencias elípticas) priorizando estado conversacional antes de fallback. Telemetría: `interpretedConversationMemory`.

---

## V141-WA-004 — Reportes masivos por WhatsApp: documento adjunto + enlace corto estable (hecho)

- Tipo: mejora
- Módulo: whatsapp / reporting
- Prioridad: medium
- Estimación: 8
- Versión: v14.1
- Estado: done
- Dependencias: `V140-WA-007`

**Descripción:** Mejorar UX de reportes largos (stock general, deuda proveedores/clientes): formato numérico correcto, entrega como documento WhatsApp cuando aplique, y fallback con enlace corto del sistema.

**Criterios de aceptación:**

- [x] Cantidades de stock se muestran sin ceros basura (ej. `30` en vez de `30.000` si entero).
- [x] Para reportes grandes, se puede enviar `document` por WhatsApp Cloud API (PDF) con caption útil.
- [x] Si no se envía adjunto, se devuelve enlace corto propio (`/api/whatsapp/report/download?...`) en lugar de URL firmada extensa.
- [x] Mensaje siempre incluye resumen breve + CTA para drill-down exacto.

**Notas técnicas:** Implementado en `src/lib/whatsapp/send-message.ts` (envío `type=document`), `src/lib/whatsapp/outbound-worker.ts` (procesa `message_type=document`), `src/lib/whatsapp/text-handler.ts` (extrae `PDF completo: ...` y encola adjunto), migración `supabase/migrations/162_whatsapp_outbound_document_message.sql` (columnas outbound doc) y enlace corto firmado en `src/lib/whatsapp/report-pdf.ts` + `src/app/api/whatsapp/report/download/route.ts`.

---

## V141-WA-005 — Suite de “preguntas clásicas” y evaluación conversacional continua (hecho)

- Tipo: chore
- Módulo: whatsapp / qa / ia
- Prioridad: high
- Estimación: 5
- Versión: v14.1
- Estado: done
- Dependencias: `V141-WA-002`, `V141-WA-003`

**Descripción:** Definir un set de pruebas realistas para medir utilidad y naturalidad del agente antes de cada release.

**Criterios de aceptación:**

- [x] Dataset versionado con al menos 80 casos: consultas genéricas, exactas, follow-up, ambigüedades y errores comunes.
- [x] Para cada caso: intención esperada, tool esperada, y patrón mínimo de respuesta (no necesariamente texto exacto).
- [x] Script de evaluación que emita métricas (accuracy intent, tool hit-rate, fallback-rate, continuidad de contexto).
- [x] Checklist QA manual para validar tono humano y claridad operativa en WhatsApp real.

**Notas técnicas:** Implementado con guía `docs/whatsapp-agent-evals.md`, fixture `src/test/fixtures/whatsapp-agent-evals.v141.json` (122 casos, version `v14.9`) y runner `src/test/whatsapp-agent-evals.test.ts` sobre `runWhatsAppReadOnlyAgent` con métricas de `intentAccuracy`, `toolHitRate`, `fallbackRate`, `contextContinuityRate`, `followupResolutionRate` y `clarificationEfficiency`. Indice de documentacion del chatbot: `docs/whatsapp-chatbot.md`.

---

# BLOQUE WHATSAPP v14.2 — Catálogo ampliado (agente)

## V142-WA-001 — Acciones WhatsApp: parsers ampliados, catálogo y evals (hecho)

- Tipo: feature
- Módulo: whatsapp / acciones
- Prioridad: high
- Estimación: 5
- Versión: v14.2
- Estado: done
- Dependencias: `V140-WA-006`

**Descripción:** Ampliar frases aceptadas para pago proveedor, cobro cliente y ajuste de stock; documentar catálogo de acciones; copy orientado en read-only cuando la intención es acción; evals y runbook.

**Criterios de aceptación:**

- [x] Parsers aceptan sinónimos rioplatenses y variantes de orden monto/entidad.
- [x] Catálogo en `docs/whatsapp-chatbot-acciones.md`.
- [x] Read-only sugiere frase correcta en lugar de “próxima fase” genérico.
- [x] Casos eval en fixture v142 para acciones.
- [x] Runbook actualizado con las tres acciones piloto.

**Notas técnicas:** `src/lib/whatsapp/action-parsers.ts`, `action-handler.ts`, `read-only-agent.ts`, `docs/whatsapp-chatbot-acciones.md`, `docs/whatsapp-agentico-runbook.md`.

---

## V142-WA-002 — Reportes chatbot P1: resumen comercial y vencimientos (hecho)

- Tipo: feature
- Módulo: whatsapp / reportes
- Prioridad: high
- Estimación: 8
- Versión: v14.2
- Estado: done
- Dependencias: `V141-WA-005`

**Descripción:** Exponer resumen de ingresos del período y alerta de vencimientos como tools read-only del agente.

**Criterios de aceptación:**

- [x] Intents `reporte_resumen` y `reporte_vencimientos` con reglas + LLM.
- [x] Tools `getReport:resumen` y `getReport:vencimientos` con guard de módulo.
- [x] Lógica compartida en `src/lib/whatsapp/report-tools.ts`.
- [x] Documentación y evals actualizados.

**Notas técnicas:** Reutiliza consultas de `src/app/api/reportes/resumen` y `src/app/api/alertas/vencimientos`.

---

## V142-WA-003 — Reportes chatbot P2: ventas POS y recibos (hecho)

- Tipo: feature
- Módulo: whatsapp / reportes
- Prioridad: medium
- Estimación: 8
- Versión: v14.2
- Estado: done
- Dependencias: `V142-WA-002`

**Descripción:** Exponer ventas por tickets POS y reporte de recibos/cobranzas vía WhatsApp.

**Criterios de aceptación:**

- [x] Intents `reporte_ventas_pos` y `reporte_recibos`.
- [x] Guards `facturador_pos` y `facturador_simple`.
- [x] Evals y catálogo de reportes actualizado.

---

## V142-WA-004 — NLU acciones: action-intent + memoria de slots (hecho)

- Tipo: feature
- Módulo: whatsapp / ia
- Prioridad: high
- Estimación: 8
- Versión: v14.2
- Estado: done
- Dependencias: `V142-WA-001`

**Descripción:** Detector híbrido (reglas + LLM) para extraer slots de acciones transaccionales sin saltar confirmación doble.

**Criterios de aceptación:**

- [x] `src/lib/whatsapp/action-intent.ts` integrado en `action-handler.ts`.
- [x] Read-only no bloquea con `unsupported_action` cuando hay intent de acción confiable.
- [x] Memoria conversacional para completar entidad faltante en acciones.

---

## V142-WA-005 — Reportes chatbot P3: libro IVA y gasto por proveedor (hecho)

- Tipo: feature
- Módulo: whatsapp / reportes
- Prioridad: medium
- Estimación: 8
- Versión: v14.2
- Estado: done
- Dependencias: `V142-WA-002`

**Descripción:** Exponer libro IVA y ranking de gasto por proveedor para tenants con `analizador_rentabilidad`.

**Criterios de aceptación:**

- [x] Intents `reporte_libro_iva` y `reporte_gasto_proveedores`.
- [x] Evals v142 y documentación completa del catálogo ampliado.

---

# BLOQUE WHATSAPP v14.3 — NLU y catálogo ampliado (chatbot)

Orden sugerido: `V143-WA-001` → `V143-WA-002` (entendimiento) → reportes/acciones `V143-WA-003`…`V143-WA-009` → `V143-WA-010` (canal live). Indice: `docs/whatsapp-chatbot.md`.

## V143-WA-001 — NLU: pasar contexto de memoria al clasificador LLM (hecho)

- Tipo: mejora
- Módulo: whatsapp / ia
- Prioridad: high
- Estimación: 5
- Versión: v14.3
- Estado: done
- Dependencias: `V142-WA-004`, `V141-WA-001`

**Descripción:** Cuando `resolveFollowupFromConversationMemory` no reescribe el mensaje, el LLM de intent solo ve texto crudo. Inyectar slots recientes (`topic`, `lastIntent`, `lastEntityName`, `lastReportKey`) en `classifyIntentWithLlm` para mejorar follow-ups ambiguos sin cambiar la arquitectura tool-first.

**Criterios de aceptación:**

- [x] `classifyIntentWithLlm` recibe contexto opcional desde `text-handler` (estado de `conversation-memory`).
- [x] El prompt incluye reglas explícitas: si `lastIntent` es reporte de ventas y el usuario dice “y ayer/mes anterior/mayo”, mantener familia de reporte.
- [x] No se envía historial completo ni datos sensibles extra; máximo 4–5 campos del estado.
- [x] Al menos 8 casos nuevos en fixture eval (follow-ups que hoy dependen solo de memoria determinística).
- [x] `intentAccuracy` y `followupResolutionRate` no empeoran vs. baseline v14.9 (fixture v14.10: 130 casos; nuevos casos `WAE-123`…`WAE-130`).

**Notas técnicas:** `src/lib/whatsapp/intent-context.ts`, `read-only-agent.ts`, `text-handler.ts`, `intent-context.test.ts`, fixture `whatsapp-agent-evals.v141.json` v14.10.

---

## V143-WA-002 — NLU: reglas ampliadas y few-shots desde evals (hecho)

- Tipo: mejora
- Módulo: whatsapp / ia
- Prioridad: high
- Estimación: 8
- Versión: v14.3
- Estado: done
- Dependencias: `V143-WA-001`

**Descripción:** Reducir dependencia del LLM en frases frecuentes del comercio minorista: ampliar `detectIntentByRules` con sinónimos locales y agregar 5–10 few-shots al prompt de clasificación derivados de casos `WAE-*` con más fallos en piloto.

**Criterios de aceptación:**

- [x] Nuevas reglas para variantes comunes (ej. `como venimos`, `cuanto vendimos`, typos de mes, mezclas stock/deuda sin scope).
- [x] Prompt LLM con sección “ejemplos” (JSON intent/target) sin duplicar todo el catálogo.
- [x] Opcional: usar LLM solo si reglas devuelven `unknown` o `confidence` en banda 0.4–0.87 (documentar umbral en código).
- [x] Fixture eval ampliado (mín. +15 casos) y `mismatches = 0` en CI.
- [x] Documentar palancas env: `WHATSAPP_AGENT_INTENT_LLM`, `WHATSAPP_AGENT_INTENT_LLM_PROVIDER`, `WHATSAPP_AGENT_INTENT_LLM_MODEL` en `docs/whatsapp-agent-evals.md`.

**Notas técnicas:** `intent-classifier-examples.ts`, `detectIntentByRules`, `classifyIntentWithLlm`, fixture `whatsapp-agent-evals.v141.json` v14.11 (145 casos, fecha anclada `2026-06-01` en runner).

---

## V143-WA-003 — Reportes chatbot: cierre de caja (read-only) (hecho)

- Tipo: feature
- Módulo: whatsapp / reportes
- Prioridad: high
- Estimación: 8
- Versión: v14.3
- Estado: done
- Dependencias: `V142-WA-002`, `V143-WA-002`

**Descripción:** Exponer consulta de cierre/arqueo de caja por WhatsApp y sandbox: efectivo sistema vs contado, estado del turno, sin ejecutar cierre desde el chat.

**Criterios de aceptación:**

- [x] Intent `reporte_cierre_caja` con reglas + LLM.
- [x] Tool read-only reutiliza lógica de `/api/caja/cierre-z` o helper compartido en `src/lib/caja/*`.
- [x] Guard `facturador_simple`; mensaje claro si no hay turno abierto o no hay cierre del día.
- [x] Soporte periodo relativo (`hoy`, `ayer`) si la API lo permite; si no, documentar limitación en catálogo.
- [x] Evals (mín. 4 casos), actualizar `docs/whatsapp-chatbot-reportes.md` y quitar ítem de “no disponible”.

**Notas técnicas:** `src/lib/caja/whatsapp-cierre-caja.ts` (`calcularSnapshot`, `obtenerAperturaVigente`), `runReporteCierreCajaTool`, evals `WAE-146`…`WAE-149`, fixture v14.12.

---

## V143-WA-004 — Reportes chatbot: ventas por artículo (top SKU) (hecho)

- Tipo: feature
- Módulo: whatsapp / reportes
- Prioridad: high
- Estimación: 8
- Versión: v14.3
- Estado: done
- Dependencias: `V142-WA-002`, `V143-WA-002`

**Descripción:** Complementar `reporte_ventas_productos` con ranking desde `/api/reportes/ventas-articulo` (unidades, importe, margen estimado) para el mismo modelo de periodos que ventas.

**Criterios de aceptación:**

- [x] Intent `reporte_ventas_articulo` (o extensión documentada de `reporte_ventas_productos` si se unifica).
- [x] Tool con paginación/top N (ej. 10) y totales del periodo; sin filtros avanzados categoría/proveedor en v1.
- [x] Guard `analizador_rentabilidad` + `facturador_simple` alineado a la API web.
- [x] Respuesta acotada en WhatsApp; PDF opcional si supera umbral de filas (mismo patrón que stock/deuda).
- [x] Evals y catálogo actualizados.

**Notas técnicas:** `runReporteVentasArticuloTool` en `report-tools.ts`, evals `WAE-150`…`WAE-153`, fixture v14.13; fix periodo `\bmes\b` vs subcadena en `articulo`.

---

## V143-WA-005 — Consultas chatbot: extracto cuenta corriente cliente (done)

- Tipo: feature
- Módulo: whatsapp / reportes
- Prioridad: medium
- Estimación: 8
- Versión: v14.3
- Estado: done
- Dependencias: `V141-WA-003`, `V143-WA-002`

**Descripción:** Además de saldo puntual (`cliente_deuda`), permitir “extracto / movimientos” de un cliente en cuenta corriente (últimos movimientos o resumen del periodo).

**Criterios de aceptación:**

- [x] Intent `cliente_extracto_cc` con target cliente obligatorio.
- [x] Tool read-only `getClienteExtractoCc` vía `fetchExtractoCuentaCorriente` (cliente + periodo default mes actual).
- [x] Guard `facturador_simple`; repregunta si cliente ambiguo o genérico.
- [x] En listas largas: resumen + enlace PDF si aplica (umbral 40 movimientos).
- [x] Evals `WAE-154`…`158` (fixture v14.14) y documentación.

**Notas técnicas:** `docs/reportes.md` (extracto CC), `docs/cobranza.md`, `read-only-agent.ts`.

---

## V143-WA-006 — Acción WhatsApp: cobranza por factura (`registrar_pago_cobranza`) (done)

- Tipo: feature
- Módulo: whatsapp / acciones
- Prioridad: high
- Estimación: 13
- Versión: v14.3
- Estado: done
- Dependencias: `V142-WA-001`, `V142-WA-004`

**Descripción:** Cuarta acción piloto: registrar cobro imputado a una factura/ticket específico, con doble confirmación e idempotencia, reutilizando RPC y validaciones de `docs/cobranza.md`.

**Criterios de aceptación:**

- [x] Parser + `action-intent` para frases con cliente, monto y referencia de comprobante (número, tipo o “última factura” según alcance acordado).
- [x] `action-handler` ejecuta `registrar_pago_cobranza` en live; `simulate` en sandbox.
- [x] Rol operador+; guard `facturador_simple`.
- [x] Read-only orienta con hint cuando detecta intención de cobranza por factura.
- [x] Evals de hint (read-only) + tests de integración del handler (mock RPC).
- [x] `docs/whatsapp-chatbot-acciones.md` y runbook actualizados.

**Notas técnicas:** `docs/cobranza.md`, `action-parsers.ts`, `action-handler.ts`, `whatsapp_action_log`.

---

## V143-WA-007 — Reportes chatbot: ventas POS por caja u operador (hecho)

- Tipo: feature
- Módulo: whatsapp / reportes
- Prioridad: medium
- Estimación: 5
- Versión: v14.3
- Estado: done
- Dependencias: `V142-WA-003`, `V143-WA-002`

**Descripción:** Extender `reporte_ventas_pos` con slots opcionales `caja` y/o `operador` cuando la API `ventas-consumidor` ya filtra por esos campos.

**Criterios de aceptación:**

- [x] Detección de entidad caja/operador en reglas o LLM (`targetName` o slots dedicados).
- [x] Tool pasa filtros a la consulta existente; mensaje si no hay datos.
- [x] Sin filtro: comportamiento actual de `reporte_ventas_pos`.
- [x] Evals (mín. 3 casos) y catálogo.

**Notas técnicas:** `src/app/api/reportes/ventas-consumidor/route.ts`, `runReporteVentasPosTool`, `src/lib/whatsapp/ventas-pos-report.ts`. Evals `WAE-161`…`163`, fixture `v14.16`.

---

## V143-WA-008 — Consultas chatbot: contacto de proveedor (hecho)

- Tipo: feature
- Módulo: whatsapp / consultas
- Prioridad: low
- Estimación: 5
- Versión: v14.3
- Estado: done
- Dependencias: `V143-WA-002`

**Descripción:** Espejo de `cliente_contacto` para proveedores: teléfono, email, dirección o datos de contacto cuando existan en catálogo.

**Criterios de aceptación:**

- [x] Intent `proveedor_contacto` con `contactField` análogo.
- [x] Tool `getProveedorContact` con búsqueda fuzzy y desambiguación.
- [x] Reglas + LLM + memoria (“teléfono del primero” tras ranking de deuda proveedores, si aplica).
- [x] Evals (mín. 6 casos) y fila en catálogo de reportes/consultas.

**Notas técnicas:** Patrón `getClienteContact` en `read-only-agent.ts`, tabla `proveedor`. Evals `WAE-164`…`170`, fixture `v14.17`.

---

## V143-WA-009 — Reportes chatbot: comparativo vs periodo anterior (hecho)

- Tipo: feature
- Módulo: whatsapp / reportes
- Prioridad: medium
- Estimación: 8
- Versión: v14.3
- Estado: done
- Dependencias: `V142-WA-002`, `V143-WA-004`

**Descripción:** Responder “cómo venimos vs mes pasado” con delta calculado en servidor (dos periodos), sin que el LLM aritmétique porcentajes.

**Criterios de aceptación:**

- [x] Intent `reporte_comparativo_ventas` (o extensión de `reporte_resumen` con flag comparativo).
- [x] Tool ejecuta dos consultas (periodo actual + anterior) y devuelve variación absoluta y % en texto fijo.
- [x] Alcance v1: ventas netas y/o resumen comercial; no todos los reportes a la vez.
- [x] Evals (mín. 4 casos) y documentación de limitaciones.

**Notas técnicas:** `runReporteComparativoVentasTool` + `computeVentasNetasPeriod` en `report-tools.ts`. Evals `WAE-171`…`174`, fixture `v14.18`.

---

## V143-WA-010 — Factura por WhatsApp live: confirmación conversacional post-job (hecho)

- Tipo: feature
- Módulo: whatsapp / facturas
- Prioridad: medium
- Estimación: 13
- Versión: v14.3
- Estado: done
- Dependencias: `V140-WA-005`, `V142-WA-004`

**Descripción:** Tras procesar adjunto en `lector_factura_job`, ofrecer en WhatsApp real un flujo equivalente al sandbox: resumen de impacto, revisar ítems pendientes (buscar/enlazar) y confirmar con token, reutilizando `confirmacion-chatbot` y patrones de `whatsapp_sandbox_invoice_ticket`.

**Criterios de aceptación:**

- [x] Al completar job `source=whatsapp`, outbound con resumen + token (mismo formato que sandbox).
- [x] Comandos de ticket activos en `text-handler` para actor verificado (no solo sandbox UI).
- [x] Persistencia de ticket por `from_wa_id` + tenant (`whatsapp_sandbox_invoice_ticket`).
- [x] Rol readonly: solo revisión; operador+ confirma y enlaza.
- [x] Runbook y `docs/whatsapp-chatbot-facturas.md` actualizados (sección live).
- [x] Tests de integración del flujo comando → confirmar (mock DB).

**Notas técnicas:** `docs/whatsapp-chatbot-facturas.md`, `src/lib/lector-facturas/confirmacion-chatbot.ts`, `src/lib/whatsapp/sandbox.ts` (extraer comandos compartidos), cron `process-queued`, migración si hace falta tabla ticket WA live.

---

# BLOQUE WhatsApp agéntico — v14.4 (conversacional, memoria y adjuntos)

Objetivo: que el chatbot se perciba como **asistente** (descubrimiento de capacidades, continuidad conversacional) y que **adjuntos** (factura imagen/PDF, audio) no queden bloqueados por resolución de sucursal ni pipeline pasivo.

Documentación: [`docs/whatsapp-chatbot-roadmap-v14.4.md`](./whatsapp-chatbot-roadmap-v14.4.md).  
Catálogo de producto: [`docs/whatsapp-chatbot-capacidades.md`](./whatsapp-chatbot-capacidades.md).

**Orden sugerido:** `V144-WA-001` → `004` (Fase 0, crítico) → `005`/`006` (asistente) → `007`/`008`/`009` (memoria) → `010` (evals) → `011` (opcional polish).

---

## V144-WA-001 — Adjuntos: fallback sucursal principal en branch-resolution (hecho)

- Tipo: bugfix / mejora
- Módulo: whatsapp / adjuntos
- Prioridad: critical
- Estimación: 5
- Versión: v14.4
- Estado: done
- Dependencias: ninguna (incidente producción: `multiple_active_branches_without_rule`)

**Descripción:** Cuando el tenant tiene varias sucursales activas sin reglas en `whatsapp_branch_rule`, los adjuntos de factura quedan en `awaiting_branch_confirmation`. Si existe **una sola** sucursal con `es_principal = true`, resolver automáticamente en lugar de pedir elección manual.

**Criterios de aceptación:**

- [x] `resolveBranchByRules` devuelve `resolved_auto` + `reason: principal_branch_default` cuando aplica.
- [x] Sin regresión: una sucursal → `single_active_branch`; reglas explícitas → `matched_branch_rule`.
- [x] Tests unitarios en `branch-resolution` (múltiples activas + una principal).
- [x] Jobs JPEG/PDF encolados a `queued` con `branch_id` sin intervención del usuario en caso principal único.

**Notas técnicas:** `src/lib/whatsapp/branch-resolution.ts`, `src/test/branch-resolution.test.ts`, `src/app/api/whatsapp/webhook/route.ts` (disparo `process-queued` tras auto-resolve).

---

## V144-WA-002 — Adjuntos: UI reglas `whatsapp_branch_rule` en `/whatsapp` (hecho)

- Tipo: feature
- Módulo: whatsapp / ui
- Prioridad: high
- Estimación: 8
- Versión: v14.4
- Estado: done
- Dependencias: `V144-WA-001`

**Descripción:** Pantalla o sección en `whatsapp-jobs-client.tsx` para configurar sucursal por defecto por canal/número/actor (`whatsapp_branch_rule`). Hoy solo se puede editar en BD.

**Criterios de aceptación:**

- [x] Listar reglas activas del tenant (sucursal, `from_wa_id` opcional, prioridad).
- [x] Alta/edición/baja de regla (owner/admin).
- [x] Copy: sin regla y varias sucursales, el usuario debe responder 1/2/3 por WhatsApp.
- [x] Documentado en runbook y roadmap v14.4.

**Notas técnicas:** `src/app/api/whatsapp/branch-rules/route.ts`, `src/components/whatsapp/whatsapp-branch-rules-panel.tsx`, migración `194_whatsapp_branch_rule_rls_write.sql`.

---

## V144-WA-003 — Adjuntos: mensajes sucursal + disparo process-queued post-confirmación (hecho)

- Tipo: mejora
- Módulo: whatsapp / adjuntos
- Prioridad: high
- Estimación: 5
- Versión: v14.4
- Estado: done
- Dependencias: `V144-WA-001`

**Descripción:** Mejorar UX del prompt de sucursal y no depender solo del cron para procesar el adjunto tras confirmar sucursal por texto.

**Criterios de aceptación:**

- [x] `buildBranchPromptMessage` explica factura + comandos ticket (`revisar`, `buscar`, `SI token`).
- [x] Tras `handleBranchConfirmationReply`, invocar procesamiento del job (`runWhatsAppProcessQueuedJobs`).
- [x] Mismo disparo cuando webhook resuelve sucursal auto al insertar job.
- [x] Outbound post-confirmación vía ack existente + procesamiento inmediato.
- [x] Runbook: verificar `send-outbound` para prompt inicial de sucursal.

**Notas técnicas:** `src/lib/whatsapp/process-queued-runner.ts`, `branch-confirmation.ts`, `webhook/route.ts`, `branch-resolution.ts`.

---

## V144-WA-004 — Adjuntos: audio STT errores visibles + reprocess + jobs legacy (hecho)

- Tipo: bugfix / mejora
- Módulo: whatsapp / audio
- Prioridad: high
- Estimación: 8
- Versión: v14.4
- Estado: done
- Dependencias: `V144-WA-003`

**Descripción:** Audio no percibido como funcional: jobs legacy en `awaiting_branch_confirmation`, feature flag/STT silencioso, reintentar UI sin `branch_id` para facturas.

**Criterios de aceptación:**

- [x] Si `whatsapp_agent_feature_flag` deshabilitado: outbound al usuario (no solo `review_required` en panel).
- [x] Si STT falla: outbound amigable + sugerir texto.
- [x] Reprocess UI: audio legacy en `awaiting_branch_confirmation` limpia campos branch; factura sin `branch_id` devuelve 400 con mensaje claro.
- [x] Checklist audio en runbook v14.4.

**Notas técnicas:** `process-queued-runner.ts`, `POST /api/whatsapp/jobs` reprocess. Script SQL legacy opcional fuera de alcance v1.

---

## V144-WA-005 — Conversacional: módulo `capabilities-catalog.ts` (hecho)

- Tipo: feature
- Módulo: whatsapp / ia
- Prioridad: high
- Estimación: 5
- Versión: v14.4
- Estado: done
- Dependencias: `V144-WA-004` (recomendado: adjuntos estables antes de prometer facturas en menú)

**Descripción:** Fuente única del catálogo de capacidades por tenant: módulos activos, rol WhatsApp, canal sandbox/live. Reemplaza catálogos dispersos en composer y switch default.

**Criterios de aceptación:**

- [x] API interna: secciones Consultas / Acciones / Facturas / Voz con 2–3 ejemplos cada una.
- [x] Filtra por `modulo_config` y oculta acciones/facturas para `readonly`/`visor`.
- [x] Test snapshot o unitario del catálogo mínimo.
- [x] Alineado con `docs/whatsapp-chatbot-capacidades.md`.

**Notas técnicas:** `src/lib/whatsapp/capabilities-catalog.ts`, `src/test/capabilities-catalog.test.ts`.

---

## V144-WA-006 — Conversacional: intents assistant + respuestas greeting/help (hecho)

- Tipo: feature
- Módulo: whatsapp / ia
- Prioridad: high
- Estimación: 8
- Versión: v14.4
- Estado: done
- Dependencias: `V144-WA-005`

**Descripción:** Intents meta `assistant_greeting`, `assistant_help`, `assistant_examples` por reglas (conf alta). Respuestas con `capabilities-catalog` en `response-composer`.

**Criterios de aceptación:**

- [x] Reglas antes del ladder de reportes; no disparan `unsupported_action`.
- [x] `composeGreetingReply`, `composeHelpReply`, `composeExamplesReply`.
- [x] `unknown` + `not_in_catalog` usa catálogo dinámico (no saludos).
- [x] Tests unitarios hola/ayuda (`src/test/assistant-intent-rules.test.ts`).
- [x] Evals fixture +18 casos (`V144-WA-010`, v14.4 → 192 casos).
- [ ] Opcional: bienvenida primer turno (`turn_count` — ver `V144-WA-007`).

**Notas técnicas:** `read-only-agent.ts`, `response-composer.ts`, `text-handler.ts` (rol/canal).

---

## V144-WA-007 — Memoria: migración conversation_state v2 (hecho)

- Tipo: mejora
- Módulo: whatsapp
- Prioridad: medium
- Estimación: 5
- Versión: v14.4
- Estado: done
- Dependencias: `V141-WA-001`

**Descripción:** Extender `whatsapp_conversation_state` con campos de sesión y resumen de turno.

**Criterios de aceptación:**

- [x] Migración SQL: `last_user_message`, `last_bot_summary`, `last_contact_field`, `turn_count`, `session_started_at`.
- [x] Tipos y load/save en `conversation-memory.ts`.
- [x] TTL slots (30 min) vs sesión larga documentado.

**Notas técnicas:** `supabase/migrations/195_whatsapp_conversation_state_v2.sql`, `conversation-memory.ts` (`WHATSAPP_CONVERSATION_TTL_MINUTES`, `WHATSAPP_CONVERSATION_SESSION_HOURS`), persistencia de turno en `text-handler.ts`.

---

## V144-WA-008 — Memoria: `conversation-resolver.ts` unificado (hecho)

- Tipo: refactor / mejora
- Módulo: whatsapp / ia
- Prioridad: high
- Estimación: 8
- Versión: v14.4
- Estado: done
- Dependencias: `V144-WA-007`, `V143-WA-001`

**Descripción:** Una sola función de expansión de follow-ups usada por `text-handler` y `read-only-agent`; eliminar duplicación handler vs `intent-context`.

**Criterios de aceptación:**

- [x] `resolveConversationMessage(text, state)` centralizado.
- [x] `pendingPrompt` incluido en contexto LLM (`conversationStateToIntentContext`).
- [x] Patrones nuevos: anáforas, post-acción («y su saldo»).
- [x] Evals follow-up no regresan vs v14.18 (validado en `V144-WA-010`).

**Notas técnicas:** `conversation-resolver.ts`, `conversation-followup-memory.ts`, `text-handler.ts`, `read-only-agent.ts`, `intent-context.ts`.

---

## V144-WA-009 — Memoria: persistir en acciones/facturas + suggestNextStep (hecho)

- Tipo: mejora
- Módulo: whatsapp
- Prioridad: medium
- Estimación: 8
- Versión: v14.4
- Estado: done
- Dependencias: `V144-WA-008`

**Descripción:** Guardar slots tras acciones confirmadas y cierre de ticket factura; sugerir siguiente paso tras reportes frecuentes (V2).

**Criterios de aceptación:**

- [x] `saveWhatsAppConversationState` tras action-handler éxito/cancelación (patch mínimo).
- [x] Patch tras ticket factura aplicado/cerrado.
- [x] `suggestNextStep(intent, catalog)` en top intents (máx. 1 línea).
- [x] Evals 8 casos anáfora / post-acción (`conversation-persistence.test.ts`).

**Notas técnicas:** `conversation-persistence.ts`, `suggest-next-step.ts`, `text-handler.ts`, `capabilities-catalog.ts` (`loadWhatsAppCapabilitiesCatalog`).

---

## V144-WA-010 — v14.4: evals, docs y gates de release (hecho)

- Tipo: chore
- Módulo: whatsapp / qa
- Prioridad: medium
- Estimación: 5
- Versión: v14.4
- Estado: done
- Dependencias: `V144-WA-006`, `V144-WA-008`

**Descripción:** Consolidar evals y documentación del bloque v14.4.

**Criterios de aceptación:**

- [x] Fixture evals +18 casos (`WAE-175`…`192`: assistant, anáfora, `pendingPrompt`, intent context).
- [x] `docs/whatsapp-chatbot.md` índice y roadmap v14.4.
- [x] `docs/whatsapp-agent-evals.md` versión v14.4 (192 casos) y gates.
- [x] Runner mapea `intentContext` → `conversationState`; métricas CI: `intentAccuracy`/`toolHitRate`/`followupResolutionRate` = 1, `mismatches` = 0.

**Notas técnicas:** `whatsapp-agent-evals.v141.json`, `whatsapp-agent-evals.test.ts`, prefijos follow-up ventas POS/recibos en `conversation-followup-memory.ts`, strip `cliente`/`proveedor` en deuda (`read-only-agent.ts`).

---

## V144-WA-011 — Opcional: pulido LLM de respuesta (saludo/ayuda) (hecho)

- Tipo: mejora
- Módulo: whatsapp / ia
- Prioridad: low
- Estimación: 5
- Versión: v14.4
- Estado: done
- Dependencias: `V144-WA-006`, piloto Fase 1–2

**Descripción:** Reformular tono de respuestas ya generadas sin agregar datos; flag `WHATSAPP_AGENT_REPLY_POLISH`.

**Criterios de aceptación:**

- [x] Solo entradas sin cifras o con cifras congeladas en prompt (`extractFrozenTokens` + `validatePolishedReply`).
- [x] Fallback a plantilla si LLM falla o validación rechaza.
- [x] No aplicar a cuerpos de reportes largos (`isPolishableTemplateReply`: tope chars/líneas y ≥2 líneas con `$`).
- [x] Documentar costo/latencia en runbook.

**Notas técnicas:** `src/lib/whatsapp/reply-llm-polish.ts` (`composeReplyWithLlmPolish`); integrado en `read-only-agent` (assistant + `unknown_catalog`); off por default; tests `reply-llm-polish.test.ts`.

---

## V130-COMP-001 — Compra proveedor: mejorar alta a catálogo con detección de presentación/pesable (todo)

- Tipo: mejora
- Módulo: facturación compra / catálogo
- Prioridad: high
- Estimación: 8
- Versión: v13.0
- Estado: todo
- Dependencias: `V110-STOCK-005`, `V120-CAT-003`

**Descripción:** Fortalecer alta desde `/facturacion/compra-proveedor` con heurísticas ya existentes (presentación, pesable, unidad).

**Criterios de aceptación:**

- [ ] Detecta mejor cantidad por caja/pack cuando aplica.
- [ ] Respeta detección actual de pesables.
- [ ] Mantiene consistencia con reglas de upsert por proveedor.

---

## V130-FACT-001 — OCR/lectura de CUIT receptor con mayor precisión y edición asistida (todo)

- Tipo: mejora
- Módulo: lector facturas / facturación
- Prioridad: medium
- Estimación: 8
- Versión: v13.0
- Estado: todo
- Dependencias: ninguna

**Descripción:** Mejorar captura de CUIT receptor y experiencia de corrección manual en caso ambiguo.

**Criterios de aceptación:**

- [ ] Menor tasa de error en CUIT extraído.
- [ ] Campo prellenado editable con validación de CUIT.
- [ ] Mensaje claro cuando la lectura no es confiable.

---

# BLOQUE AUDITORÍA UX/UI — v13.1

*Fuente:* `docs/auditoria-ux-ui-smart-stock.md` (informe Sincronia Marketing, consolidado en repo).

*Objetivo de la versión:* convertir los hallazgos de la auditoría en mejoras medibles de usabilidad, arquitectura de información, design system y accesibilidad — sin romper flujos operativos ya validados en v13.0.

**Plan sugerido por sprints (orden de ejecución):**

- **Sprint 1 (fundación visual):** `V131-UXAUD-010`, `V131-UXAUD-011`, `V131-UXAUD-014`, `V131-UXAUD-015`, `V131-UXAUD-018`.
- **Sprint 2 (navegación y lenguaje):** `V131-UXAUD-002`, `V131-UXAUD-005`, `V131-UXAUD-003`, `V131-UXAUD-016`.
- **Sprint 3 (dashboard y prevención):** `V131-UXAUD-001`, `V131-UXAUD-004`, `V131-UXAUD-012`, `V131-UXAUD-013`.
- **Sprint 4 (journeys operativos):** `V131-UXAUD-007`, `V131-UXAUD-008`, `V131-UXAUD-009`.
- **Sprint 5 (cierre y guía equipo):** `V131-UXAUD-006`, `V131-UXAUD-017`.

**Regla de seguridad:** cada ticket incluye prueba de no regresión del flujo actual antes de marcarse `(hecho)`. Los criterios de las proto-personas (§5) se usan como checklist de validación manual (`V131-UXAUD-006`).

---

## V131-UXAUD-001 — Dashboard: jerarquía, métricas compactas y alertas visibles (hecho)

- Tipo: ux
- Módulo: dashboard
- Prioridad: high
- Estimación: 8
- Versión: v13.1
- Estado: done
- Dependencias: `V131-UXAUD-010`, `V131-UXAUD-012`

**Descripción:** Rediseñar la vista general (`/`) según §3.1 del informe: acciones arriba, métricas densas, alertas priorizadas y copy de estado dinámico.

**Criterios de aceptación:**

- [x] Los **accesos rápidos** (venta, caja, etc.) quedan *above the fold*, antes del bloque de métricas de lectura.
- [x] Las tarjetas de métricas usan layout **compacto u horizontal**; en desktop, grilla de **4 columnas en una fila** cuando el ancho lo permita.
- [x] Las **alertas críticas** (stock bajo, caja, ARCA) son visibles sin scroll largo: panel lateral superior derecho o **banner** persistente reutilizable.
- [x] El saludo genérico “Bienvenido” se reemplaza por un **resumen de estado dinámico** (ej. caja abierta con monto, alertas pendientes).
- [x] Los accesos rápidos tienen affordance de **botón** (primario/secundario, hover, sombra) y no parecen tags/etiquetas.
- [x] Sin regresiones en datos mostrados (mismas APIs/métricas que hoy).

**Notas técnicas:** `src/app/(dashboard)/page.tsx`, componentes de métricas/alertas del dashboard, `src/components/dashboard/arca-resolver-banner.tsx`. Referencia informe §3.1 (Ley de Fitts, Gestalt, Nielsen #4).

**Implementación:** `DashboardExecutiveHeader` (estado dinámico vía APIs caja/stock/AFIP), `DashboardQuickActions` (action cards con variantes loud/quiet), métricas compactas 4 col, orden: banner ARCA → header → acciones → alertas → métricas.

---

## V131-UXAUD-002 — Sitemap: reorganizar navegación por relevancia operativa

- Tipo: ux
- Módulo: navegación
- Prioridad: high
- Estimación: 13
- Versión: v13.1
- Estado: todo
- Dependencias: `V131-UXAUD-005`

**Descripción:** Alinear sidebar y agrupación de rutas con el sitemap propuesto (§4): operaciones diarias arriba, configuración al final, eliminación de silos percibidos.

**Criterios de aceptación:**

- [ ] **Nivel 1:** Dashboard ejecutivo como entrada principal sin cambiar URL base.
- [ ] **Nivel 2:** Inventario/stock y POS/caja en zonas superiores del menú (orden: uso diario antes que análisis).
- [ ] **Nivel 3:** Ventas y pedidos agrupan workflow, comprobantes y centro de errores fiscal (sin duplicar entradas huérfanas).
- [ ] **Nivel 4:** Clientes y proveedores bajo un grupo “Directorio” o equivalente claro.
- [ ] **Nivel 5–6:** Reportes y **Ajustes del sistema** en la parte inferior del menú.
- [ ] Movimientos de stock e ingresos/egresos/transferencias accesibles sin saltos innecesarios (objetivo §4.2.2).
- [ ] Feature flags y módulos deshabilitados no muestran ítems vacíos ni rutas rotas.
- [ ] Validación con al menos un usuario por proto-persona (Martín, Lucía, Nicolás) sin guía externa.

**Notas técnicas:** `src/components/dashboard/dashboard-chrome.tsx` (`NAV_ENTRIES`), guards de módulo en `docs/modulos.md`. Mapa completo en `docs/auditoria-ux-ui-smart-stock.md` §4.

---

## V131-UXAUD-003 — Pilar limpieza visual: ocultar ruido técnico en UI (hecho)

- Tipo: ux
- Módulo: ui global
- Prioridad: high
- Estimación: 8
- Versión: v13.1
- Estado: done
- Dependencias: ninguna

**Descripción:** Aplicar el pilar 1 del informe (§2): eliminar ceros innecesarios, UUIDs, slugs y agrupar opciones por impacto en el negocio.

**Criterios de aceptación:**

- [x] En pantallas operativas (listados, fichas, configuración visible al dueño) **no se muestran** UUIDs, slugs de tenant ni identificadores internos salvo modo soporte explícito.
- [x] Montos y cantidades sin **ceros de relleno** confusos (formato AR consistente con el resto del sistema).
- [x] Opciones de configuración agrupadas por **impacto** (operación diaria / fiscal / avanzado) en al menos Configuración y una pantalla crítica adicional acordada en PR.
- [x] Inventario de pantallas tocadas documentado en el PR (rutas afectadas).

**Notas técnicas:** Revisar `configuracion`, listados de productos/clientes, importador. Informe §2 pilar 1 y §3 (limpieza visual).

**Implementación:** `formatQuantity` en `formatters.ts`; modo soporte (`useSupportMode` / superadmin) oculta slugs y webhook IDs en `/configuracion/pedidos/estados`, `/configuracion/pasarelas`, `/configuracion/usuarios`; `ConfigImpactGroup` en `/configuracion` y workflow de pedidos; cantidades en POS (`CantidadEditor`) y `/movimientos`. Rutas: `/configuracion`, `/configuracion/pedidos/estados`, `/configuracion/pasarelas`, `/configuracion/usuarios`, `/facturacion/pos`, `/movimientos`.

---

## V131-UXAUD-004 — Pilar prevención de errores: prellenado IA y validación CUIT temprana

- Tipo: feature
- Módulo: facturación / importador / clientes
- Prioridad: high
- Estimación: 13
- Versión: v13.1
- Estado: todo
- Dependencias: `V130-FACT-001` (recomendado, no bloqueante)

**Descripción:** Implementar el pilar 2 del informe (§2): el sistema anticipa errores con prellenado inteligente y validación fiscal antes de acciones irreversibles.

**Criterios de aceptación:**

- [ ] **CUIT/CUIL:** validación en cliente (formato + dígito verificador) y feedback antes de emitir o reintentar ARCA; mensaje en lenguaje administrativo.
- [ ] Donde exista lector IA (facturas/compras), los campos extraídos llegan **prellenados** con estado de confianza (alta/media/baja) y edición inline.
- [ ] Acciones destructivas o de emisión fiscal muestran **confirmación** con resumen del error detectado si aplica.
- [ ] No aumentar la tasa de emisiones rechazadas en homologación/producción (métrica manual en QA).

**Notas técnicas:** `docs/lector-facturas.md`, `resolver-arca-client.tsx`, APIs bandeja ARCA, flujos de alta cliente. Informe §2 pilar 2 y Journey 3 (§6).

---

## V131-UXAUD-005 — Pilar lenguaje humano: renombrar secciones y etiquetas del menú (hecho)

- Tipo: ux-content
- Módulo: navegación / copy global
- Prioridad: high
- Estimación: 5
- Versión: v13.1
- Estado: done
- Dependencias: ninguna

**Descripción:** Renombrar tecnicismos por términos del comercio (§2 pilar 3 + §4), sin romper URLs internas si no es necesario.

**Criterios de aceptación:**

- [x] “Tickets” (o equivalente en menú) pasa a **“Caja”** o “Punto de venta” según contexto del ítem.
- [x] “Resolver ARCA” / bandeja técnica pasa a **“Centro de errores”** o “Errores de factura” con subtítulo que mencione AFIP solo si hace falta.
- [x] No quedan labels visibles con “slug”, “UUID”, “tenant” para roles `admin`/`dueño` en navegación principal.
- [x] Glosario de reemplazos (antes → después) en `docs/auditoria-ux-ui-smart-stock.md` o nota al pie del PR.
- [x] `aria-label` y títulos de página coherentes con los nuevos nombres.

**Notas técnicas:** `dashboard-chrome.tsx`, títulos en `layout.tsx` de rutas de facturación y POS. Informe §2 y §4.3.

**Implementación:** Menú en `dashboard-chrome.tsx` (Centro de errores, Punto de venta, Directorio, Datos fiscales). Título y copy en `resolver-arca/page.tsx`, banner y badges. Glosario en `docs/auditoria-ux-ui-smart-stock.md`. Rutas sin cambio.

---

## V131-UXAUD-006 — Proto-personas: checklist de validación por rol

- Tipo: chore
- Módulo: qa / producto
- Prioridad: medium
- Estimación: 3
- Versión: v13.1
- Estado: todo
- Dependencias: `V131-UXAUD-001`, `V131-UXAUD-007`, `V131-UXAUD-008`, `V131-UXAUD-009`

**Descripción:** Formalizar el uso de las proto-personas (§5) como criterio de aceptación transversal de la versión v13.1.

**Criterios de aceptación:**

- [ ] Checklist publicado en `docs/auditoria-ux-ui-smart-stock.md` (o anexo) con **3 escenarios** mínimos: Martín (dashboard + compras), Lucía (POS + cierre), Nicolás (errores + pedidos).
- [ ] Cada escenario tiene pasos, resultado esperado y pantallas involucradas.
- [ ] Al cerrar v13.1, al menos un recorrido por persona queda marcado en el PR de release o en `activeContext.md`.
- [ ] Mejoras que no resuelven dolor de ninguna persona quedan explícitamente **diferidas** con motivo.

**Notas técnicas:** Informe §5 (Martín, Lucía, Nicolás). No requiere código salvo enlaces desde README interno o `activeContext.md`.

---

## V131-UXAUD-007 — Journey 1: ingreso de mercadería con lector IA y ajuste de margen

- Tipo: feature
- Módulo: lector facturas / stock
- Prioridad: high
- Estimación: 13
- Versión: v13.1
- Estado: todo
- Dependencias: `V130-IMP-004` (recomendado), `V131-UXAUD-004`

**Descripción:** Optimizar el flujo de abastecimiento (§6 Journey 1): foto → lista precargada → alerta de costo → ajuste PVP → confirmar ingreso.

**Criterios de aceptación:**

- [ ] Entrada clara **“Ingreso de mercadería”** desde inventario o importación unificada (mobile-friendly).
- [ ] Tras extracción IA, lista de ítems editable con cantidades, descripción y costo visibles.
- [ ] Productos con **subida de costo** resaltados (semántica alerta) con acción **“Ajustar PVP”** que propone precio según margen configurado del tenant.
- [ ] Botón **“Confirmar ingreso”** actualiza stock en una sola acción con feedback de éxito.
- [ ] Tiempo objetivo de operador informado: carga típica en **&lt; 5 min** para remito mediano (validación manual).

**Notas técnicas:** `docs/lector-facturas.md`, rutas `/lector-facturas`, compra proveedor, APIs `extraer`/`confirmar`. Informe §6 Journey 1.

---

## V131-UXAUD-008 — Journey 2: POS hora pico — contraste, cobro combinado y CTA COBRAR (hecho)

- Tipo: ux
- Módulo: pos / facturador_pos
- Prioridad: critical
- Estimación: 13
- Versión: v13.1
- Estado: done
- Dependencias: `V131-UXAUD-011`, `V131-UXAUD-013`, `V130-POS-001`

**Descripción:** Alinear terminal POS con Journey 2 (§6): tipografía de alto contraste, total destacado, cobro mixto fluido y botón COBRAR dominante (F2).

**Criterios de aceptación:**

- [x] Lista de ítems y totales cumplen contraste **AA** mínimo (objetivo AAA en total y botón COBRAR).
- [x] **Total** en peso bold y ~40 % mayor que textos secundarios del ticket.
- [x] Flujo **“Cobro combinado”**: solapas o campos para efectivo + transferencia con autocompletado del saldo.
- [x] Botón **COBRAR** es el control más grande de la pantalla; atajo **F2** documentado y funcional.
- [x] Tras cobrar, pantalla se **limpia** automáticamente para el siguiente cliente (sin pasos extra).
- [x] Modo alto contraste existente (`business-prefs`) sigue compatible.

**Notas técnicas:** Pantalla POS en `src/app/(dashboard)/facturacion/pos/` (o ruta vigente), `docs/modulos.md` (`facturador_pos`). Informe §6 Journey 2 y §7.2.

**Implementación:** Utilidades `.pos-shell`, `.pos-btn-cobrar`, `.text-pos-total` en `globals.css`; lista de ítems con contraste reforzado; CTA COBRAR ampliado; `CobroModal` con método «Cobro combinado» (solapas efectivo/transferencia + autocompletado de saldo) y cierre automático del carrito tras venta exitosa (~900 ms + toast); F2 sin cambios (`keyboard-shortcuts.tsx`). Compatible con `.pos-topbar-light-ui` en dark mode.

---

## V131-UXAUD-009 — Journey 3: centro de errores fiscal con diagnóstico humano y reintento (hecho)

- Tipo: ux
- Módulo: facturación / arca
- Prioridad: high
- Estimación: 8
- Versión: v13.1
- Estado: done
- Dependencias: `V131-UXAUD-005`, `V131-UXAUD-004`

**Descripción:** Mejorar resolución de comprobantes rechazados (§6 Journey 3): alerta en menú, errores traducidos, edición de datos y reintento con semáforo de estado.

**Criterios de aceptación:**

- [x] Indicador visible en navegación cuando hay errores pendientes (badge/punto rojo hacia centro de errores).
- [x] Listado con **diagnóstico en lenguaje humano** (no solo código AFIP); mapa mínimo de 10 códigos frecuentes.
- [x] Edición de CUIT/DNI del receptor con **validación en tiempo real** antes de “Autorizar comprobante”.
- [x] Estados **Rojo → Verde** claros tras reintento exitoso.
- [x] Acción opcional: enviar PDF por WhatsApp desde la misma vista (si módulo WA activo).

**Notas técnicas:** `src/app/(dashboard)/facturacion/resolver-arca/`, `bandeja-arca` APIs, `docs/arca.md`. Informe §6 Journey 3 y §4.3.

**Implementación:** Badge de pendientes ARCA en sidebar/flyout (`dashboard-chrome.tsx` + `bandeja-arca/alerta`); bandeja fiscal con diagnóstico humano via `diagnostico-humano.ts` (mapa de códigos frecuentes), edición inline de CUIT/DNI con validación en tiempo real (incluye dígito verificador CUIT) y guardado por `PATCH /api/clientes/[id]`; botón “Autorizar comprobante” con semáforo visual rojo/ámbar→verde al éxito; acción opcional “Enviar PDF por WhatsApp” visible cuando el canal WA está activo y hay teléfono + PDF.

---

## V131-UXAUD-010 — Design tokens adaptativos (light/dark) sin colores hardcodeados (hecho)

- Tipo: design-system
- Módulo: ui global
- Prioridad: high
- Estimación: 8
- Versión: v13.1
- Estado: done
- Dependencias: ninguna

**Descripción:** Implementar tokens del informe (§7.1, §7.5.10): `bg-main`, `bg-surface`, `text-primary`, `accent-primary`, `border-subtle` con modo espejo light/dark.

**Criterios de aceptación:**

- [x] Variables CSS centralizadas en `globals.css` (o capa de tokens) para los pares del informe; **sin** `#FFF`/`#000` puros en fondos de app.
- [x] Componentes nuevos o refactorizados en el sprint usan `var(--*)` / tokens Tailwind mapeados, no hex sueltos.
- [x] `data-theme` o estrategia actual (`next-themes`) alterna tokens sin parpadeo visible.
- [x] Documentación de tokens en `docs/arquitectura.md` (tabla resumida).

**Notas técnicas:** `src/app/globals.css`, tema en `layout.tsx`. Informe §7.1 y §7.5.10.

**Implementación:** Capa semántica en `globals.css` (`--bg-main`, `--bg-surface`, etc.) enlazada a tokens shadcn (`--background`, `--card`, …) y expuesta en `@theme inline` como `bg-bg-main`, `text-semantic-arca-error-fg`, etc. POS topbar reutiliza la misma capa en `.dark .pos-topbar-light-ui`.

---

## V131-UXAUD-011 — Tipografía Inter y jerarquía numérica en POS (hecho)

- Tipo: design-system
- Módulo: ui global / pos
- Prioridad: medium
- Estimación: 5
- Versión: v13.1
- Estado: done
- Dependencias: `V131-UXAUD-010`

**Descripción:** Adoptar Inter (§7.2, §7.5.5) y escala tipográfica con énfasis en números de caja.

**Criterios de aceptación:**

- [x] Fuente **Inter** cargada globalmente (Google Fonts o self-host) con fallback system-ui.
- [x] Escala documentada: body, label, total POS, título de sección.
- [x] En POS, precio total cumple regla de tamaño/peso del informe (bold, ≥40 % vs. líneas de ítem).
- [x] Sin regresión de layout en mobile (overflow controlado).

**Notas técnicas:** `src/app/layout.tsx`, `tailwind.config`, pantalla POS. Informe §7.2 y §7.5.5.

**Implementación:** Inter como `--font-sans` en `layout.tsx`; utilidades `.text-pos-total` y `.text-pos-item` en `globals.css`; total POS usa `text-pos-total` (clamp responsive).

---

## V131-UXAUD-012 — UI kit: botones loud/quiet, estados semánticos y tablas zebra (hecho)

- Tipo: design-system
- Módulo: ui / componentes
- Prioridad: medium
- Estimación: 8
- Versión: v13.1
- Estado: done
- Dependencias: `V131-UXAUD-010`

**Descripción:** Estandarizar componentes §7.3 en shadcn/ui existente: botón primario de acción, secundario outlined, estados éxito/alerta, tablas con zebra y hover.

**Criterios de aceptación:**

- [x] Variantes **loud** (sólido) y **quiet** (outline) documentadas y usadas en al menos POS, dashboard y un formulario de configuración.
- [x] Tokens de **éxito** y **error/ARCA** legibles en light y dark (no solo color: icono o texto).
- [x] `DataTable` / tablas críticas con **zebra striping** sutil y **hover** en fila (`bg-hover` o equivalente).
- [x] Storybook o sección en `docs/arquitectura.md` con capturas o referencia de variantes (si no hay Storybook, tabla markdown).

**Notas técnicas:** `src/components/ui/button.tsx`, `table.tsx`, patrones en listados de inventario y facturación. Informe §7.3.

**Implementación:** Variantes `loud`/`quiet` en `button.tsx`; `--bg-hover` + zebra en `table.tsx`; `StockBajoCard` con tokens semánticos; uso en POS, dashboard quick actions y Guardar en configuración. Tabla en `docs/arquitectura.md`.

---

## V131-UXAUD-013 — Accesibilidad operativa: focus, targets táctiles y iconos con texto (hecho)

- Tipo: accesibilidad
- Módulo: ui global / pos
- Prioridad: high
- Estimación: 8
- Versión: v13.1
- Estado: done
- Dependencias: `V131-UXAUD-010`, `V130-A11Y-001`

**Descripción:** Cerrar brechas §7.4 y §7.5.3/9: foco de teclado visible, área táctil 44×44 en caja, iconos nunca solos.

**Criterios de aceptación:**

- [x] `:focus-visible` con anillo de alto contraste (≥3:1) en inputs, botones y enlaces del shell y POS.
- [x] Botones principales del POS ≥ **44×44 px** de área clickeable.
- [x] Iconos destructivos o de acción llevan **texto visible** o `aria-label` + tooltip en desktop.
- [x] Landmarks semánticos (`main`, `nav`, `section`) en layout dashboard sin proliferación de `motion.div` sin rol.

**Notas técnicas:** `dashboard-chrome.tsx`, POS, componentes `Button`/`IconButton`. Informe §7.4 y §7.5.3.

**Implementación:** Estilo global `:focus-visible` de alto contraste en `globals.css`; utility `.pos-action-btn` aplicada a CTAs críticos del POS para asegurar target táctil mínimo 44×44; iconos de acción con `aria-label`/`title` en cierre y eliminación (`cobro-modal.tsx`, `keyboard-shortcuts.tsx`, POS); landmarks semánticos reforzados en layout dashboard (`section` + `nav` + `main`) en `dashboard-chrome.tsx`.

---

## V131-UXAUD-014 — Contraste WCAG: mapeo de pares y checklist pre-release (hecho)

- Tipo: accesibilidad
- Módulo: ui global
- Prioridad: high
- Estimación: 5
- Versión: v13.1
- Estado: done
- Dependencias: `V131-UXAUD-010`

**Descripción:** Validar y documentar ratios §7.5.1–2 y checklist §7.5.4 / §8 para releases que toquen UI.

**Criterios de aceptación:**

- [x] Pares prioritarios del informe mapeados en `globals.css`: `--foreground`, `--primary`/`--brand-primary`, `--destructive`, `--semantic-arca-error-*` (crear si faltan).
- [x] Tabla de ratios (AA/AAA) en `docs/arquitectura.md` con valores light y dark.
- [x] Checklist **pre-release**: Adobe Color Contrast Analyzer (o APCA en navegador) + simulación daltonismo (Chrome DevTools).
- [x] Estados éxito/error no dependen **solo** del color (icono o etiqueta).

**Notas técnicas:** `src/app/globals.css`, `docs/arquitectura.md`. Informe §7.5.1–2, §7.5.4, §8.

**Implementación:** `--semantic-success-*` y `--semantic-arca-error-*` en `globals.css`; sección *Design system — tokens semánticos* y checklist pre-release en `docs/arquitectura.md`. Banner y badges del centro de errores usan etiquetas de texto explícitas.

---

## V131-UXAUD-015 — Grid y espaciado: sistema de 8px y grillas 12/4 (hecho)

- Tipo: design-system
- Módulo: ui global
- Prioridad: medium
- Estimación: 5
- Versión: v13.1
- Estado: done
- Dependencias: `V131-UXAUD-010`

**Descripción:** Aplicar reglas de layout §7.5.6 en Tailwind y contenedores principales.

**Criterios de aceptación:**

- [x] Escala de espaciado documentada (múltiplos de **8px**) referenciada en `tailwind.config` o tokens (`space-m`, `space-l` si se crean).
- [x] Contenedor principal del dashboard y una vista de formulario usan **grid 12 col** desktop / **4 col** mobile.
- [x] PR de UI no introduce márgenes arbitrarios (7px, 13px) en archivos tocados — revisión en checklist.
- [x] Guía breve en `docs/arquitectura.md` § layout.

**Notas técnicas:** `tailwind.config.ts`, `dashboard-shell`, páginas de configuración. Informe §7.5.6.

**Implementación:** Se definió escala de espaciado de 8px en tokens CSS (`--space-1` a `--space-5` + alias `--space-m`, `--space-l`, `--space-xl`) en `src/app/globals.css`, junto con la utility `layout-grid-12-4` (4 columnas mobile / 12 desktop). La grilla se aplica al contenedor de la home del dashboard (`src/app/(dashboard)/page.tsx`) y a la vista de formulario de configuración (`src/app/(dashboard)/configuracion/page.tsx`). Se agregó guía y checklist de layout (incluida revisión de márgenes arbitrarios) en `docs/arquitectura.md`.

---

## V131-UXAUD-016 — UX copy: errores y etiquetas en lenguaje administrativo (hecho)

- Tipo: ux-content
- Módulo: ui global
- Prioridad: medium
- Estimación: 5
- Versión: v13.1
- Estado: done
- Dependencias: `V131-UXAUD-005`

**Descripción:** Política de copy §7.5.8: traducir errores técnicos, tono profesional cercano, sin MAYÚSCULAS sostenidas ni exclamaciones excesivas.

**Criterios de aceptación:**

- [x] Helper o convención documentada (`docs/arquitectura.md` o `docs/auditoria-ux-ui-smart-stock.md`) con ejemplos bueno/malo.
- [x] Al menos **15 mensajes** de error/toast críticos actualizados (ARCA, stock, importador, POS, auth).
- [x] Mensajes de API expuestos al usuario pasan por capa de copy (no `error.message` crudo de stack).
- [x] Revisión de tono en español rioplatense neutro (voseo opcional consistente con el resto de la app).

**Notas técnicas:** `src/lib/errors` o patrones existentes de toast, `resolver-arca`, importador. Informe §7.5.8.

**Implementación:** Capa de copy reusable en `src/lib/errors/user-copy.ts` (`userFacingErrorCopy` + `apiErrorPayload`) con reglas por módulo (ARCA, stock, importador, POS, auth) y sanitización de mensajes técnicos; guía de convención y ejemplos bueno/malo agregada en `docs/arquitectura.md`; adopción en APIs y UI críticas (`bandeja-arca`, `movimientos`, `importar/preflight`, `auth/register`, `auth/local-login`, `resolver-arca-client`, `cobro-modal`, `extraer-precios`, `productos`, login/registro) para evitar exposición de `error.message` crudo.

---

## V131-UXAUD-017 — Guía clean code UX-adjacent para el equipo

- Tipo: docs
- Módulo: desarrollo
- Prioridad: low
- Estimación: 3
- Versión: v13.1
- Estado: todo
- Dependencias: ninguna

**Descripción:** Documentar convenciones §7.5.7 para mantener UI y lógica legibles al escalar v13.1+.

**Criterios de aceptación:**

- [ ] Sección en `docs/arquitectura.md`: nombres semánticos (`isInvoiceValid` vs `check1`), comentarios “por qué”, límite ~20 líneas por función en UI crítica.
- [ ] Checklist de PR UI: tokens, copy, A11y, 8px grid (enlace a `V131-UXAUD-014` y `V131-UXAUD-016`).
- [ ] Referencia cruzada desde `docs/auditoria-ux-ui-smart-stock.md` §8.

**Notas técnicas:** Solo documentación; sin cambio funcional obligatorio. Informe §7.5.7.

---

## V131-UXAUD-018 — Trazabilidad informe ↔ tickets y checklist de cierre v13.1

- Tipo: chore
- Módulo: producto
- Prioridad: medium
- Estimación: 2
- Versión: v13.1
- Estado: todo
- Dependencias: ninguna

**Descripción:** Cerrar el loop §1 y §8: el informe en repo queda enlazado al backlog y al proceso de release visual.

**Criterios de aceptación:**

- [ ] Tabla §8 de `docs/auditoria-ux-ui-smart-stock.md` apunta a IDs `V131-UXAUD-*` (verificar/enlazar tras crear bloque).
- [ ] `docs/activeContext.md` lista los **próximos 3 tickets** de v13.1 cuando se inicie el bloque (o al cerrar v14 pendientes).
- [ ] Checklist de release visual (contraste + daltonismo) copiado en `docs/arquitectura.md` y referenciado en template de PR si existe.
- [ ] Versión `v13.1` mencionada en cabecera de bloque de `TICKETS.md` cuando el primer ticket pase a `done`.

**Notas técnicas:** `docs/auditoria-ux-ui-smart-stock.md`, `docs/activeContext.md`, `docs/arquitectura.md`. Informe §1 y §8.

---

# BLOQUE POS+ — v13.2 (Mejoras post-auditoría)

---

## V132-POS-001 — Multi-venta en POS: carritos en espera con pestañas rápidas (hecho)

- Tipo: feature
- Módulo: facturador_pos
- Prioridad: medium
- Estimación: 8
- Versión: v13.2
- Estado: done ✅
- Dependencias: `V60-POS-022` (carrito y persistencia POS), `V70-MP-008/010/011` (MP Point/QR)

**Descripción:** Permitir al cajero abrir **varias ventas en paralelo** en el POS sin perder lo cargado de la venta anterior, para responder a la realidad de mostrador: mientras un cliente busca la tarjeta, se le cobra a otro y se vuelve. Patrón estándar de POS retail (Square / Lightspeed / Toast): mini-pestañas dentro del POS, sin requerir abrir pestañas del navegador (que romperían caja activa, terminal MP y emisión ARCA).

**UX objetivo:**

- Barra de **pestañas** sobre el carrito (`Venta 1 · $4.520 · 🟢`, `Venta 2 · $0`, `+ Nueva`).
- Tope **4 ventas** simultáneas en la misma caja (más se desordena).
- Atajos: `Alt+N` Nueva venta paralela · `Alt+1..4` saltar entre ventas · `Alt+W` cerrar pestaña activa.
- Etiqueta **opcional** por pestaña (apodo libre tipo `Juan tarjeta`, `Cliente 3`); sin obligar a tipear.
- Al cobrar con éxito, la pestaña se cierra y queda activa la siguiente (o una nueva vacía).
- Contador permanente "N ventas en espera" en el header del POS y en la sidebar (badge similar al de ARCA) para que sea visible al volver de otras pantallas.

**Criterios de aceptación:**

- [x] Refactor del estado del carrito a `ventasEnEspera: Cart[]` + `ventaActivaId`, scoped por **caja + cajero**; persistencia en `localStorage` (compatible con el carrito actual al migrar — sin pérdida de datos en el primer deploy).
- [x] UI de mini-pestañas funcional con tope 4, etiqueta opcional, atajos `Alt+N`/`Alt+1..4`/`Alt+W` y `aria-label` por pestaña.
- [x] El `CobroModal` opera solo sobre la **venta activa** (sin cambios en `/api/facturacion/emitir`).
- [x] Reglas de **MP Point/QR**: mientras hay un cobro en curso en una pestaña, el cambio de pestañas y la apertura de nuevas se deshabilitan (la barra entra en modo bloqueado con tooltip). Implementación pragmática equivalente al criterio original: como el `CobroModal` es modal/exclusivo, no se puede iniciar otro cobro digital en paralelo desde otra slice sin antes cancelar el actual.
- [x] **Cierre de caja seguro**: el botón "Cierre de caja" del POS detecta si hay ventas en espera con ítems y muestra un diálogo bloqueante con la lista (etiqueta, total e ítems) en lugar de abrir el cierre Z. El cierre Z desde otras pantallas no se altera (siguen su flujo habitual).
- [x] Indicador "N ventas en espera" en header del POS y badge en la entrada `Punto de venta` del menú lateral (`dashboard-chrome.tsx`), sincronizado vía custom event + `storage`.
- [x] **Recuperación post-recarga**: las slices se rehidratan automáticamente al volver al POS para el mismo (tenant, caja, cajero); si no hay slices pero existe carrito legacy, se conserva el flujo `showRestorePrompt` actual.
- [x] No se reserva stock al suspender (igual que hoy); el `stock_bloqueante` se valida recién en `COBRAR`.
- [x] Atajos no colisionan con los existentes (`F1`, `F2`, `F3`, `F4`, `F8`, `F9`, `F12`); la ayuda `keyboard-shortcuts.tsx` lista los nuevos.
- [ ] Tests automatizados (unidad + integración): **diferido a follow-up**. La estructura del store en `src/lib/pos/ventas-en-espera.ts` es pura y testeable de forma directa cuando se priorice.

**Notas técnicas:**

- Estado: extiende el carrito del POS (`src/app/(dashboard)/facturacion/pos/page.tsx`) con un store paralelo de slices serializables (`VentaSliceState`); el snapshot incluye `items`, `clienteId`, `tipoComprobante`, `pedidoOrigenId`, `turnoOrigenId`, `turnoOrigenLabel`, `turnoSenaMonto`, `ajusteModo`, `descuentoTipo`, `descuentoValor`.
- Persistencia: clave `nexus.pos.ventasEnEspera.v1.{tenant}.{caja}.{user}` con schema versionado y expiración a 24 h (alineado con `cart-persistence`). El carrito legacy (`smartstock_pos_cart_*`) se migra silenciosamente la primera vez que el POS encuentra slices nuevas.
- UI pestañas: nuevo `src/components/pos/ventas-en-espera-tabs.tsx` con tokens `--brand-tint` / `--brand-soft` / `--brand-accent`, focus-visible accesible y altura mínima 36 px.
- Atajos: `src/components/pos/keyboard-shortcuts.tsx` agrega handlers `onNuevaVentaEnEspera`, `onSaltarAVentaEnEspera(idx)`, `onCerrarVentaEnEspera`; respeta inputs/textareas.
- Cierre de caja: guard cliente en POS (`Dialog` que lista slices pendientes). El cierre Z desde `/facturacion/cierre-caja` no se modificó porque ahí no hay sesión POS activa.
- Sidebar: extiende `navBadgeCountForLeaf` en `dashboard-chrome.tsx` para `/facturacion/pos`, leyendo el conteo via `countVentasEnEsperaParaTenant` y `subscribeVentasEnEsperaChanges` (custom event + `storage`).
- Perfil: `SessionProfile.userId` y `/api/perfil` expusieron el `userId` para hacer el scope `(tenant, caja, usuario)` y evitar mezcla de carritos entre cajeros del mismo navegador.
- Doc relacionada: `docs/facturacion.md` (sección *Multi-venta en el POS*), `docs/Plan cajas usuario.md` (cajas/cajeros).

**Por qué no pestañas del navegador:** romperían caja activa + terminal MP única; varios `cobro-modal` simultáneos pueden pisarse con stock, ARCA y numeración; agrega fricción al cajero (alt-tab del SO). El patrón intra-app es el estándar de POS retail.

**Implementación:** Nuevo módulo `src/lib/pos/ventas-en-espera.ts` (slices versionadas, scope por tenant/caja/usuario, helpers reducer-style, sub/pub para sidebar). Nueva UI `src/components/pos/ventas-en-espera-tabs.tsx`. Integración en `pos/page.tsx`: snapshot/restore por slice, hidratación al cargar, persistencia debounced, handlers `abrirNuevaVentaEnEspera`/`cambiarAVentaEnEspera`/`saltarAVentaPorIndice`/`cerrarVentaEnEspera`/`renombrarVentaEnEspera`/`cerrarSliceActivaTrasCobroExitoso`, contador en topbar y guard de cierre de caja con `Dialog` que lista las pestañas pendientes. Sidebar: `dashboard-chrome.tsx` agregó estado `posVentasEnEspera` con subscriber del custom event para refrescar el badge sin polling. `keyboard-shortcuts.tsx` agregó atajos `Alt+N`/`Alt+1..4`/`Alt+W`. Perfil: `SessionProfile.userId` + `/api/perfil` para scoping correcto. Tests automatizados quedan diferidos como follow-up.

---

