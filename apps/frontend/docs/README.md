---
estado: 🔴 Pendiente
version: v0.1
ultima_actualizacion: 2026-05-06
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
| IA de precios / lector de facturas | Gemini (API REST) | Listas de precios y comprobantes escaneados: extracción estructurada (ver `ia-precios.md`, `lector-facturas.md`) |
| Integración fiscal | ARCA (ex-AFIP) — WSAA + WSFE | Facturación electrónica obligatoria en Argentina. Homologación y producción |
| Deploy | Vercel (inicial) → VPS con Docker (escalado) | Vercel para arrancar rápido, VPS cuando se necesita más control |

---

## Planes y módulos por perfil

### Plan Base
- **Stock** — control en tiempo real, movimientos, alertas, vencimientos (siempre activo)
- **Importador Excel/CSV** — normalizador inteligente, mapeo, preview, upsert (siempre activo); opción en preview para marcar productos **pesables** por patrones en el nombre y guardar código de lista como **PLU** (`importador.md`)
- **Facturador simple** — PDF en blanco y negro, sin integración fiscal

### Plan Completo (incluye todo lo del Base más)
- **Pedidos y presupuestos** — estados, conversión a factura, reserva de stock
- **IA de precios** — extracción automática desde PDF/imagen con Gemini
- **Lector de facturas (IA)** — importar facturas/tickets escaneados a `comprobante` importado (ver `lector-facturas.md`, `PLAN-H.md`)
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
| [autenticacion.md](./autenticacion.md) | Flujos de auth, JWT, roles, middleware, invitación (`inviteUserByEmail` → callback → `/invitacion/completar`), Redirect URLs en Supabase |
| [permisos-usuario-y-rbac.md](./permisos-usuario-y-rbac.md) | RBAC (`permiso`, `rol_permiso`, `usuario_permiso`), `has_permiso`, checklist para agregar claves y permisos asignables desde Usuarios |
| [modulos.md](./modulos.md) | Sistema de feature flags, modulo_config, guard de API |
| [stock.md](./stock.md) | CRUD productos, movimientos, alertas, vencimientos, foto miniatura para POS (Storage) |
| [fusiones-proveedor-producto.md](./fusiones-proveedor-producto.md) | Unificación de proveedores y productos duplicados (UI, API, RPC, simulación, irreversible) |
| [importador.md](./importador.md) | Importación Excel/CSV, normalizador, pipeline, IA |
| [facturacion.md](./facturacion.md) | Facturador simple, PDF, numeración, stock; **presupuesto** (PDF cotización, número sin punto de venta); **descuentos/recargos** por ítem y global + ARCA; POS (búsqueda `imagen_url`, proveedor, 409 ambiguo, **cuenta corriente / pago pendiente** en caja) |
| [cobranza.md](./cobranza.md) | Cobranza por comprobante (`cobranza_factura`), campana WhatsApp, **tickets POS** y saldos; historial en ficha de cliente |
| [medios-de-pago-y-financiacion.md](./medios-de-pago-y-financiacion.md) | Atajos del POS, opciones por medio, pago mixto, migraciones 038/039 |
| [pedidos.md](./pedidos.md) | Pedidos, presupuestos, estados, conversión a factura |
| [ia-precios.md](./ia-precios.md) | Extracción con Gemini, prompt, preview, historial |
| [lector-facturas.md](./lector-facturas.md) | Lector de facturas con IA: rutas, APIs, acceso, migración 046, integración con facturación/stock |
| [lector-facturas-api.md](./lector-facturas-api.md) | API dual del lector de facturas IA: SmartStock async con matching y Extractor sync sin tenant |
| [PLAN-H.md](./PLAN-H.md) | Plan bloque H: diseño, diagramas, tickets y estado vs. implementación |
| [analizador.md](./analizador.md) | Listas de proveedores, matching, simulación de márgenes, forecast y rentabilidad |
| [arca.md](./arca.md) | WSAA, WSFE, CAE, reintentos, certificados; **TLS/OpenSSL 3** y cliente `https.request` hacia AFIP (Vercel/producción) |
| [deploy.md](./deploy.md) | Vercel, VPS, migraciones en producción, checklist go-live |
| [TICKETS.md](./TICKETS.md) | Backlog completo con 104 tickets organizados por versión |
| [reportes.md](./reportes.md) | Reportes operativos: rutas, APIs, métricas y límites (ventas por SKU vs tickets POS) |
| [whatsapp-chatbot.md](./whatsapp-chatbot.md) | Indice del chatbot WhatsApp: canales, requisitos, mapa de docs y prueba rapida en sandbox |
| [whatsapp-chatbot-reportes.md](./whatsapp-chatbot-reportes.md) | Catalogo de reportes disponibles desde el chatbot WhatsApp/sandbox, tools, ejemplos y limitaciones |
| [whatsapp-chatbot-acciones.md](./whatsapp-chatbot-acciones.md) | Acciones transaccionales WhatsApp (pago, cobro, stock) con doble confirmacion |
| [whatsapp-chatbot-facturas.md](./whatsapp-chatbot-facturas.md) | Facturas en sandbox: ticket conversacional, comandos y confirmacion de impacto |
| [whatsapp-chatbot-capacidades.md](./whatsapp-chatbot-capacidades.md) | Inventario de capacidades del chatbot (referencia / export PDF) |
| [whatsapp-chatbot-roadmap-v14.4.md](./whatsapp-chatbot-roadmap-v14.4.md) | Roadmap v14.4: adjuntos, capa asistente, memoria conversacional |
| [whatsapp-agentico-runbook.md](./whatsapp-agentico-runbook.md) | Runbook operativo: rollout piloto, rollback, monitoreo y checklist pre-produccion |
| [whatsapp-agent-evals.md](./whatsapp-agent-evals.md) | Evaluacion continua del agente (fixture v14.9, metricas y QA manual) |
