# Mudanza Supabase ÔåÆ Nest + PostgreSQL (DDL)

## Objetivo

Un ├║nico Postgres gestionado por vos (o cloud), con el **DDL versionado en el repo del backend** (`apps/backend/src/database/migrations`), para que Next deje de depender de Supabase como ÔÇ£due├▒oÔÇØ del esquema y pase a consumir la **API Nest**.

## Qu├® hay hoy

1. **`1742000000000-nb-baseline-core-schema.ts`**
   Crea el n├║cleo alineado con las **entidades TypeORM** actuales del Nest: `tenant`, `producto`, `comprobante`, ├¡tems, `movimiento`, `pedido`, ARCA (`arca_config`, `arca_log`, `arca_job` + `claim_arca_jobs` / `reset_stale_arca_jobs`), `precio_historial`, `importacion_log`, enums y helpers (`moddatetime`, stub `current_tenant_id`).

2. **Migraciones posteriores** (orden cronol├│gico): barcodes dedicados, `idempotency_request`, grants ARCA worker.

3. **Migraciones SQL del repo** (`supabase/migrations`, etc.) siguen siendo la historia del producto con **Supabase** (auth, storage, RLS con `auth.jwt()`). No las mezcles en la misma base ÔÇ£Nest limpiaÔÇØ sin revisar: muchas asumen helpers de Supabase.

## Base nueva (recomendado para arrancar Nest-first)

1. Crear base vac├¡a en Postgres (pgAdmin o `CREATE DATABASE ...`).
2. Configurar `.env` del backend (`DB_*`, `JWT_SECRET`).
3. Desde `apps/backend`:

```bash
npm run build
npm run migration:run
```

Con rol **superuser** (t├¡pico `postgres` en local), las pol├¡ticas RLS de migraciones posteriores no bloquean la API.

## Si ya probaste migraciones y solo ten├®s la tabla `migrations`

En una base de prueba pod├®s borrar todo y volver:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
```

Luego `migration:run` de nuevo.

## No duplicar con Supabase cloud

Si el front sigue usando **la misma** instancia Supabase como Postgres, **no** ejecutes el baseline ah├¡: ya existe un esquema distinto. Para la mudanza gradual, opciones t├¡picas:

- **Dump** desde Supabase ÔåÆ restaurar en Postgres propio ÔåÆ ajustar drift con migraciones Nest; o
- **Fresh Nest DB** para desarrollo del API mientras el front sigue en Supabase hasta el corte.

## Conectar el front ÔÇ£cuando llegue el momentoÔÇØ

- Misma URL de API (`NEXT_PUBLIC_*` o similar), JWT emitido con el mismo `JWT_SECRET` / claims que espera Nest (`tenant_id`, roles).
- El front deja de usar el cliente Supabase para datos de negocio y usa `fetch`/cliente HTTP contra Nest.
