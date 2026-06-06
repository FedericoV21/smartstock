import { MigrationInterface, QueryRunner } from 'typeorm';

/** NB-IMP-002: tabla `idempotency_request` (hist├│rico alineado con migraciones del repo legado). */
export class NbImp002IdempotencyRequest1745104200000 implements MigrationInterface {
  name = 'NbImp002IdempotencyRequest1745104200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.idempotency_request (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  endpoint         TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  request_hash     TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('processing', 'completed')),
  response_json    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_idempotency_request_tenant_endpoint_key
    UNIQUE (tenant_id, endpoint, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_request_tenant_created
  ON public.idempotency_request (tenant_id, created_at DESC);

CREATE TRIGGER set_idempotency_request_updated_at
  BEFORE UPDATE ON public.idempotency_request
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE public.idempotency_request ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select_idempotency_request
  ON public.idempotency_request FOR SELECT
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_insert_idempotency_request
  ON public.idempotency_request FOR INSERT
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY tenant_update_idempotency_request
  ON public.idempotency_request FOR UPDATE
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.idempotency_request CASCADE;
`);
  }
}
