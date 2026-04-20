---
estado: 🔴 Pendiente
version: v0.1
ultima_actualizacion: 2026-04-13
---

# Nexus — Deploy y operaciones

## Estrategia de deploy

| Fase | Plataforma | Versiones | Justificación |
|---|---|---|---|
| Inicial | **Vercel** | v0.1 → v2.0 | Zero-config para Next.js, deploy por push, SSL, CDN, preview por branch. Ideal para validar el producto sin invertir en infraestructura |
| Escalado | **VPS con Docker** | v3.0+ | Mayor control sobre costos a escala, cron jobs nativos (cola ARCA), persistencia de archivos, sin límites de serverless en funciones de larga duración (WSAA/WSFE) |

### ¿Por qué Vercel primero?

- Deploy automático desde GitHub en cada push a `main`.
- Preview deployments para cada pull request.
- SSL automático, CDN global, Edge Functions.
- Tier gratuito incluye: 100 GB de bandwidth, 100 horas de serverless function.
- Perfecto para los primeros 1-10 clientes.

### ¿Por qué migrar a VPS después?

- Costos predecibles (no billing por función/request).
- Cron jobs nativos sin depender de Supabase Edge Functions.
- Funciones sin límite de tiempo (WSAA puede tardar 10-20s, WSFE hasta 30s).
- Mayor control de logs, monitoreo, backups.
- Posibilidad de correr Supabase self-hosted si se necesita.

---

## Variables de entorno

### Completas con descripción

| Variable | Descripción | Pública | Ejemplo | Requerida desde |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | Sí | `https://xxxxx.supabase.co` | v0.1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anónima de Supabase (safe para browser, respeta RLS) | Sí | `eyJhbGci...` | v0.1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (bypass RLS, solo servidor) | **No** | `eyJhbGci...` | v0.1 |
| `NEXT_PUBLIC_APP_URL` | URL pública de la aplicación | Sí | `https://smartstock.app` | v0.1 |
| `GEMINI_API_KEY` | API key de Google Gemini para extracción IA | **No** | `AIza...` | v3.0 |
| `ARCA_ENCRYPTION_KEY` | Clave AES-256 para encriptar certificados ARCA en DB (exactamente 32 caracteres) | **No** | `a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6` | v4.0 |

### Ejemplo de `.env.local`

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Gemini (solo si se usa el módulo IA, v3.0+)
# GEMINI_API_KEY=AIza...

# ARCA (solo si se usa facturación electrónica, v4.0+)
# ARCA_ENCRYPTION_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

### Variables en Supabase Edge Functions

Las Edge Functions (como `reintentar-arca`) necesitan sus propias variables:

| Variable | Cómo setearla |
|---|---|
| `SUPABASE_URL` | Automática en Edge Functions |
| `SUPABASE_SERVICE_ROLE_KEY` | Setear via `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...` |
| `ARCA_ENCRYPTION_KEY` | Setear via `supabase secrets set ARCA_ENCRYPTION_KEY=...` |

---

## Pasos para configurar en Vercel desde cero

### 1. Preparar el repositorio

```bash
# Asegurar que el proyecto buildea correctamente
npm run build

# Verificar que no hay errores de TypeScript
npx tsc --noEmit

# Commitear todo
git add . && git commit -m "Ready for deploy"
git push origin main
```

### 2. Crear proyecto en Vercel

1. Ir a [vercel.com](https://vercel.com) → "New Project".
2. Importar el repositorio de GitHub.
3. Vercel detecta Next.js automáticamente.
4. **Framework Preset:** Next.js (auto-detected).
5. **Root Directory:** `.` (raíz del repo).
6. **Build Command:** `npm run build` (default).
7. **Output Directory:** `.next` (default).

### 3. Configurar variables de entorno

En Vercel → Settings → Environment Variables, agregar:

| Key | Value | Environment |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxx.supabase.co` | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | Production, Preview, Development |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Production, Preview (no Development — usar .env.local) |
| `NEXT_PUBLIC_APP_URL` | `https://smartstock.app` | Production |
| `NEXT_PUBLIC_APP_URL` | `https://smartstock-preview.vercel.app` | Preview |
| `GEMINI_API_KEY` | `AIza...` | Production (cuando se active el módulo) |
| `ARCA_ENCRYPTION_KEY` | `a1b2c3...` | Production (cuando se active ARCA) |

### 4. Configurar dominio custom (opcional)

1. Vercel → Settings → Domains → Add `smartstock.app`.
2. Configurar DNS: CNAME `smartstock.app` → `cname.vercel-dns.com`.
3. Vercel provee SSL automáticamente.

### 5. Deploy

```bash
# El deploy se hace automáticamente al pushear a main
git push origin main

# Para deploy manual
npx vercel --prod
```

---

## Migraciones con Supabase CLI en producción

### Primera vez

```bash
# 1. Instalar Supabase CLI
npm install -g supabase

# 2. Login
supabase login

# 3. Vincular al proyecto remoto
supabase link --project-ref <project-ref>

# 4. Ejecutar todas las migraciones
supabase db push
```

### Agregar una nueva migración

```bash
# 1. Crear archivo de migración
supabase migration new nombre_descriptivo
# Crea: supabase/migrations/TIMESTAMP_nombre_descriptivo.sql

# 2. Escribir el SQL en el archivo creado

# 3. Testear localmente (si se usa Supabase local)
supabase db reset

# 4. Aplicar en producción
supabase db push
```

### Verificar estado de migraciones

```bash
# Ver qué migraciones están aplicadas
supabase migration list

# Ver diferencias entre local y remoto
supabase db diff
```

### Rollback

Supabase CLI no tiene rollback automático. Para revertir:

1. Crear una nueva migración que deshaga los cambios.
2. Ejecutar `supabase db push`.

---

## Registrar `custom_access_token_hook` en Supabase Dashboard

Este paso es **manual** y obligatorio después de ejecutar las migraciones:

1. Ir al **Supabase Dashboard** del proyecto.
2. Navegar a **Authentication** → **Hooks**.
3. En la sección **"Customize Access Token (JWT) Claims"**, activar el hook.
4. Seleccionar el schema `public` y la función `custom_access_token_hook`.
5. Click en **Save**.

### Verificar que funciona

1. Hacer login con un usuario que tenga registro en la tabla `usuario`.
2. Ir a **Authentication** → **Users** → click en el usuario.
3. Verificar que en "Last Sign In Token" aparece el claim `tenant_id`.

### Permisos necesarios (ya incluidos en migración 011)

```sql
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
GRANT SELECT ON TABLE public.usuario TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;
```

---

## Checklist de go-live antes del primer cliente

### Infraestructura

- [ ] Proyecto Supabase creado en tier adecuado (al menos Pro para producción)
- [ ] Todas las migraciones requeridas por el entorno objetivo aplicadas exitosamente (base `001-012`, extendido hasta `022` si se despliega el analizador)
- [ ] `custom_access_token_hook` registrado en Supabase Dashboard
- [ ] Verificar RLS activo en las 16 tablas: `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';`
- [ ] Proyecto desplegado en Vercel con build exitoso
- [ ] Dominio custom configurado con SSL
- [ ] Variables de entorno configuradas en Vercel (no usar valores de desarrollo)

### Seguridad

- [ ] `SUPABASE_SERVICE_ROLE_KEY` solo está en variables de entorno del servidor, nunca en código cliente
- [ ] `ARCA_ENCRYPTION_KEY` es única para producción (no la misma que en desarrollo)
- [ ] RLS policies verificadas con tests de aislamiento entre tenants
- [ ] No hay queries con `service_role` expuestas a endpoints públicos
- [ ] Rate limiting configurado en Supabase (Auth → Rate Limits)
- [ ] Email templates personalizados en Supabase (Authentication → Email Templates)

### Datos

- [ ] Seed de producción NO ejecutado (solo para desarrollo)
- [ ] Al menos un tenant de prueba creado y verificado
- [ ] Flujo completo testeado: registro → login → crear producto → importar Excel → emitir factura
- [ ] Verificar que el segundo tenant no ve datos del primero

### Storage

- [ ] Bucket `comprobantes` creado en Supabase Storage
- [ ] Policies de Storage configuradas (solo el tenant dueño puede leer sus PDFs)
- [ ] Bucket `listas-precios` creado en Supabase Storage para guardar PDFs, Excels e imágenes originales del analizador
- [ ] Policies de Storage configuradas para que cada tenant solo acceda a sus propias listas cargadas

```sql
-- Policy de Storage para comprobantes
CREATE POLICY "tenant_read_comprobantes"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'comprobantes'
  AND (storage.foldername(name))[1] = auth.tenant_id()::text
);

CREATE POLICY "tenant_upload_comprobantes"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'comprobantes'
  AND (storage.foldername(name))[1] = auth.tenant_id()::text
);
```

### Monitoreo

- [ ] Vercel Analytics habilitado (detectar errores 500, latencia)
- [ ] Supabase Dashboard → Logs activos para Auth, Database, Edge Functions
- [ ] Alertas configuradas para errores críticos (opcional: integrar con un servicio de alertas)

### Documentación

- [ ] README actualizado con instrucciones de setup
- [ ] Variables de entorno documentadas
- [ ] Proceso de onboarding de nuevo tenant documentado

---

## ARCA en homologación para testing end-to-end

Antes de activar ARCA en producción, todo el flujo se testea contra el ambiente de **homologación**:

### Obtener certificado de homologación

1. Ir a [ARCA - Administración de Certificados Digitales](https://wsaa.afip.gob.ar/).
2. Generar un CSR (Certificate Signing Request) con OpenSSL:

```bash
# Generar clave privada
openssl genrsa -out smartstock_homo.key 2048

# Generar CSR
openssl req -new -key smartstock_homo.key -out smartstock_homo.csr -subj "/C=AR/O=Nexus/CN=smartstock/serialNumber=CUIT XXXXXXXXXXX"
```

3. Subir el CSR al portal de ARCA.
4. Descargar el certificado firmado (.crt/.pem).
5. Asociar el certificado al servicio `wsfe` en el portal de ARCA.

### Configurar en Nexus

1. Login como admin del tenant de prueba.
2. Ir a `/configuracion/arca`.
3. Subir el certificado (.pem) y la clave privada (.key).
4. Ingresar CUIT, punto de venta, seleccionar ambiente "Homologación".
5. Click en "Probar conexión" → verifica que WSAA devuelve un ticket válido.

### Tests end-to-end contra homologación

- [ ] Obtener ticket WSAA con certificado de homologación
- [ ] Consultar último comprobante con `FECompUltimoAutorizado`
- [ ] Emitir Factura C y obtener CAE
- [ ] Emitir Factura B y obtener CAE
- [ ] Emitir Nota de Crédito y obtener CAE
- [ ] Verificar que el PDF incluye el CAE
- [ ] Simular timeout y verificar que entra a cola de reintentos
- [ ] Verificar que después de 3 reintentos pasa a `error_arca`
- [ ] Verificar logs completos en `arca_log`

---

## Rotación de certificados ARCA cuando vencen

Los certificados de ARCA tienen un vencimiento (generalmente 2 años). Nexus debe gestionar la renovación:

### Alerta de vencimiento

```typescript
// src/lib/facturacion/arca/certificado-check.ts
import * as crypto from 'crypto';

export function verificarVencimientoCertificado(
  certificadoPem: string
): { valido: boolean; venceEn: Date | null; diasRestantes: number | null } {
  try {
    const cert = new crypto.X509Certificate(certificadoPem);
    const vence = new Date(cert.validTo);
    const ahora = new Date();
    const diasRestantes = Math.ceil((vence.getTime() - ahora.getTime()) / (1000 * 60 * 60 * 24));

    return {
      valido: diasRestantes > 0,
      venceEn: vence,
      diasRestantes,
    };
  } catch {
    return { valido: false, venceEn: null, diasRestantes: null };
  }
}
```

### Proceso de renovación

1. El sistema alerta al admin cuando faltan **30 días** para el vencimiento.
2. El admin genera un nuevo CSR y lo sube al portal de ARCA.
3. ARCA firma el nuevo certificado.
4. El admin sube el nuevo certificado en `/configuracion/arca`.
5. El sistema encripta y guarda el nuevo certificado, reemplazando el anterior.
6. El ticket de acceso se invalida automáticamente (se regenerará en la próxima operación).

### Notificación en el dashboard

```typescript
// En el dashboard, verificar vencimiento del certificado
const { data: arcaConfig } = await supabase
  .from('arca_config')
  .select('certificado_pem')
  .single();

if (arcaConfig?.certificado_pem) {
  const certPem = desencriptarCampo(arcaConfig.certificado_pem);
  const { diasRestantes } = verificarVencimientoCertificado(certPem);

  if (diasRestantes !== null && diasRestantes <= 30) {
    // Mostrar alerta en el dashboard
  }
}
```

---

## Estructura de deploy con Docker (v3.0+)

Cuando se migre a VPS, el deploy será con Docker Compose:

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
      - NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - ARCA_ENCRYPTION_KEY=${ARCA_ENCRYPTION_KEY}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  # Cron para reintentos ARCA (reemplaza Edge Function)
  cron:
    build:
      context: .
      dockerfile: Dockerfile.cron
    environment:
      - SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
      - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
      - ARCA_ENCRYPTION_KEY=${ARCA_ENCRYPTION_KEY}
    restart: unless-stopped
```

```dockerfile
# Dockerfile
FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
```
