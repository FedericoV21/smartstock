import { MigrationInterface, QueryRunner } from 'typeorm';

export class NbPub001InvoiceExtractorApi1750130000000 implements MigrationInterface {
  name = 'NbPub001InvoiceExtractorApi1750130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.api_extractor_key (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_preview TEXT,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['invoice:extract']::TEXT[],
  estado TEXT NOT NULL DEFAULT 'activa',
  rate_limit_por_minuto INTEGER NOT NULL DEFAULT 10,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uk_api_extractor_key_hash UNIQUE (key_hash),
  CONSTRAINT chk_api_extractor_key_estado CHECK (estado IN ('activa', 'pausada', 'revocada')),
  CONSTRAINT chk_api_extractor_key_rate CHECK (rate_limit_por_minuto > 0)
);

CREATE INDEX IF NOT EXISTS idx_api_extractor_key_estado
  ON public.api_extractor_key (estado);

DROP TRIGGER IF EXISTS set_api_extractor_key_updated_at ON public.api_extractor_key;
CREATE TRIGGER set_api_extractor_key_updated_at
  BEFORE UPDATE ON public.api_extractor_key
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TABLE IF NOT EXISTS public.factura_extractor_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key_id UUID REFERENCES public.api_extractor_key (id) ON DELETE SET NULL,
  archivo_nombre TEXT,
  archivo_mime TEXT,
  archivo_tamano BIGINT,
  estado TEXT NOT NULL,
  error_code TEXT,
  error_detail TEXT,
  duracion_ms INTEGER,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_factura_extractor_log_estado CHECK (estado IN ('extraido', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_factura_extractor_log_key_created
  ON public.factura_extractor_log (api_key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_factura_extractor_log_estado_created
  ON public.factura_extractor_log (estado, created_at DESC);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.factura_extractor_log CASCADE;
DROP TRIGGER IF EXISTS set_api_extractor_key_updated_at ON public.api_extractor_key;
DROP TABLE IF EXISTS public.api_extractor_key CASCADE;
`);
  }
}
