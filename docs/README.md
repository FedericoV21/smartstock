---
estado: 🔴 Pendiente
version: v0.1
ultima_actualizacion: 2026-04-13
---

# Nexus — Documentación del proyecto

## Qué es Nexus

Nexus es un sistema de gestión de stock inteligente, modular y multi-tenant, diseñado para comercios argentinos de todos los tamaños. Desde un kiosco de barrio hasta una distribuidora o fábrica, cada cliente (tenant) activa únicamente los módulos que su negocio necesita, pagando una suscripción mensual ajustada a su perfil.

El modelo de negocio se basa en dos planes de suscripción — Base y Completo — que controlan qué módulos están habilitados para cada tenant. La arquitectura es de deploy único: un mismo codebase y una misma instancia sirven a todos los clientes simultáneamente, con aislamiento de datos garantizado por Row Level Security (RLS) a nivel de PostgreSQL.

La filosofía central es que el sistema se adapta al negocio, no al revés. Un almacén no necesita facturación electrónica ni inteligencia artificial; una distribuidora necesita todo. La modularidad es arquitectónica (controlada en base de datos por la tabla `modulo_config`), no cosmética.

---

## Stack tecnológico

| Componente | Tecnología | Justificación |
|---|---|---|
| Frontend + Backend | Next.js 14+ (App Router, TypeScript) | Full-stack en un solo framework. SSR, API routes, deploy simple en Vercel |
| Base de datos | Supabase (PostgreSQL 15+) | Auth integrado, RLS nativo, Storage para archivos, Realtime, SDK para JS |
| Autenticación | Supabase Auth | JWT con claims custom (`tenant_id`), magic link, email/password |
| Storage | Supabase Storage | PDFs de comprobantes, logos de negocios, imágenes de productos |
| Facturación PDF | jsPDF | Generación de PDFs en el servidor sin dependencias externas pesadas |
| Lectura Excel | SheetJS (xlsx) | Parseo de .xlsx/.csv en el frontend, rápido, sin necesidad de servidor |
| IA de precios | Gemini 1.5 Pro (API REST) | Visión: lee PDFs e imágenes de listas de precios y extrae datos estructurados |
| Integración fiscal | ARCA (ex-AFIP) — WSAA + WSFE | Facturación electrónica obligatoria en Argentina. Homologación y producción |
| Deploy | Vercel (inicial) → VPS con Docker (escalado) | Vercel para arrancar rápido, VPS cuando se necesita más control |

---

## Planes y módulos por perfil

### Plan Base
- **Stock** — control en tiempo real, movimientos, alertas, vencimientos (siempre activo)
- **Importador Excel/CSV** — normalizador inteligente, mapeo, preview, upsert (siempre activo)
- **Facturador simple** — PDF en blanco y negro, sin integración fiscal

### Plan Completo (incluye todo lo del Base más)
- **Pedidos y presupuestos** — estados, conversión a factura, reserva de stock
- **IA de precios** — extracción automática desde PDF/imagen con Gemini 1.5 Pro
- **Integración ARCA** — facturación electrónica con CAE (WSAA + WSFE)
- **Analizador de rentabilidad** — listas de proveedores, simulación de márgenes, forecast, ranking y cuenta corriente

### Perfiles de cliente

| Perfil | Stock | Excel | Facturación | Pedidos | IA precios | ARCA | Analizador |
|---|---|---|---|---|---|---|---|
| Almacén de barrio | Si | Si | Simple (PDF) | No | No | No | No |
| Kiosco / maxikiosco | Si | Si | No | No | No | No | No |
| Distribuidora | Si | Si | Electrónica | Si | Si | Si | Si |
| Fábrica | Si | Si | Simple o electrónica | Si | No | Opcional | Si |
| Área de ventas | No | No | Electrónica | Si (presup.) | No | Si | Si |

---

## Levantar el proyecto localmente

### Requisitos previos
- Node.js 18+ y npm/pnpm
- Supabase CLI (`npm install -g supabase`)
- Cuenta en Supabase con un proyecto creado

### Pasos

```bash
# 1. Clonar el repositorio
git clone <url-del-repo> smartstock
cd smartstock

# 2. Instalar dependencias
npm install

# 3. Copiar variables de entorno
cp .env.local.example .env.local
# Editar .env.local con las credenciales de Supabase

# 4. Vincular Supabase al proyecto remoto
npx supabase link --project-ref <project-ref>

# 5. Ejecutar migraciones
npx supabase db push

# 6. (Opcional) Cargar datos de prueba
npx supabase db seed

# 7. Levantar el servidor de desarrollo
npm run dev
```

El proyecto estará disponible en `http://localhost:3000`.

---

## Variables de entorno

| Variable | Descripción | Pública | Ejemplo |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | Si | `https://xxxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anónima de Supabase (safe para el browser) | Si | `eyJhbGci...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (solo servidor, bypass RLS) | No | `eyJhbGci...` |
| `GEMINI_API_KEY` | API key de Google Gemini para el módulo IA | No | `AIza...` |
| `ARCA_ENCRYPTION_KEY` | Clave AES para encriptar certificados ARCA en DB | No | `una-clave-larga-y-segura-de-32-chars` |
| `NEXT_PUBLIC_APP_URL` | URL pública de la aplicación | Si | `https://smartstock.app` |

---

## Documentación del proyecto

| Archivo | Contenido |
|---|---|
| [README.md](./README.md) | Este archivo — visión general, stack, planes, setup |
| [arquitectura.md](./arquitectura.md) | Diagrama de capas, flujo de requests, estructura de carpetas, decisiones de diseño, riesgos, roadmap |
| [activeContext.md](./activeContext.md) | Estado actual del desarrollo, próximos tickets, decisiones pendientes, bloqueos |
| [base-de-datos.md](./base-de-datos.md) | ERD, ENUMs, tablas, funciones SQL, migraciones |
| [multi-tenancy.md](./multi-tenancy.md) | Modelo shared DB, RLS, custom_access_token_hook, tests de aislamiento |
| [autenticacion.md](./autenticacion.md) | Flujos de auth, JWT, roles, middleware, protección de rutas |
| [modulos.md](./modulos.md) | Sistema de feature flags, modulo_config, guard de API |
| [stock.md](./stock.md) | CRUD productos, movimientos, alertas, vencimientos |
| [importador.md](./importador.md) | Importación Excel/CSV, normalizador, pipeline, IA |
| [facturacion.md](./facturacion.md) | Facturador simple, PDF, numeración, descuento de stock |
| [pedidos.md](./pedidos.md) | Pedidos, presupuestos, estados, conversión a factura |
| [ia-precios.md](./ia-precios.md) | Extracción con Gemini, prompt, preview, historial |
| [analizador.md](./analizador.md) | Listas de proveedores, matching, simulación de márgenes, forecast y rentabilidad |
| [arca.md](./arca.md) | WSAA, WSFE, CAE, reintentos, certificados |
| [deploy.md](./deploy.md) | Vercel, VPS, migraciones en producción, checklist go-live |
| [TICKETS.md](./TICKETS.md) | Backlog completo con 104 tickets organizados por versión |
