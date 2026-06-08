# Cola y worker ARCA

## Flujo

1. El cliente emite un comprobante fiscal (`emitido`, sin CAE).
2. `POST /api/facturacion/:id/arca-encolar` crea o reactiva un registro en `arca_job` y pone el comprobante en `pendiente_arca`.
3. El worker reclama filas con `claim_arca_jobs` (bloqueo `SKIP LOCKED`, adecuado para varios procesos).
4. Tras integrar WSAA/WSFE, `processArcaJob` actualizará CAE y pasará el job a `completed`. Hoy, sin WSFE, reintenta con backoff o falla tras `max_attempts`.

## Migración

```bash
npx supabase db push
```

Aplica `supabase/migrations/017_arca_job_queue.sql`.

## Worker en VPS / cron

```bash
npm run arca-worker
```

Requiere `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en `.env.local`.

## Cron en Vercel / scheduler (Nest)

- Variable `CRON_SECRET` en el backend Nest.
- `GET /api/v1/cron/reintentar-arca` — reintentos síncronos sobre comprobantes `pendiente_arca` (lote 10, máx. 3 intentos por comprobante).
- `POST /api/v1/cron/arca-procesar` — procesa cola `arca_job` (lote configurable, default 5).
- Header: `Authorization: Bearer <CRON_SECRET>`.
- Alternativa interna (mismo worker): `POST /api/v1/internal/arca-jobs/run` con `x-arca-worker-secret`.

Ejemplo Vercel cron (cada 15 min):

```json
{
  "crons": [
    { "path": "/api/v1/cron/reintentar-arca", "schedule": "*/15 * * * *" },
    { "path": "/api/v1/cron/arca-procesar", "schedule": "* * * * *" }
  ]
}
```

En Vercel el cron dispara GET; configurar `CRON_SECRET` en env del servicio Nest y reenviar el header desde un proxy si hace falta.

## Cron en Vercel (opcional, lotes chicos) — legacy Next

- Variable `CRON_SECRET`.
- `POST /api/cron/arca-procesar` con header `Authorization: Bearer <CRON_SECRET>`.
- Configurar en `vercel.json` un cron cada minuto o cada pocos minutos (límite ~5 jobs por invocación).

## Stub de homologación

Con `ARCA_WORKER_STUB=true` y `arca_config.ambiente = homologacion`, el worker asigna un CAE ficticio y registra en `arca_log`. No usar en producción.
