import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-ARC-107: arca_config por sucursal (paridad con frontend migration 095).
 */
export class NbArc107ArcaConfigSucursal1749500000000 implements MigrationInterface {
  name = 'NbArc107ArcaConfigSucursal1749500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.arca_config
  ADD COLUMN IF NOT EXISTS sucursal_id uuid;

ALTER TABLE public.arca_config
  DROP CONSTRAINT IF EXISTS arca_config_sucursal_id_fkey;
ALTER TABLE public.arca_config
  ADD CONSTRAINT arca_config_sucursal_id_fkey
  FOREIGN KEY (sucursal_id) REFERENCES public.sucursal(id) ON DELETE CASCADE;

ALTER TABLE public.arca_config
  DROP CONSTRAINT IF EXISTS arca_config_tenant_id_key;
ALTER TABLE public.arca_config
  DROP CONSTRAINT IF EXISTS arca_config_tenant_id_unique;

DROP INDEX IF EXISTS public.idx_arca_config_tenant_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_config_tenant_sucursal
  ON public.arca_config(tenant_id, sucursal_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_config_sucursal_id
  ON public.arca_config(sucursal_id);

WITH principal AS (
  SELECT DISTINCT ON (tenant_id)
    tenant_id,
    id AS sucursal_id
  FROM public.sucursal
  WHERE activa = true
  ORDER BY tenant_id, es_principal DESC, created_at ASC
)
UPDATE public.arca_config ac
SET sucursal_id = p.sucursal_id
FROM principal p
WHERE ac.tenant_id = p.tenant_id
  AND ac.sucursal_id IS NULL;

INSERT INTO public.arca_config (
  tenant_id,
  sucursal_id,
  ambiente,
  certificado_pem,
  clave_privada_pem,
  cuit_emisor,
  punto_de_venta,
  ticket_acceso,
  ticket_sign,
  ticket_expiracion,
  ultimo_comprobante,
  created_at,
  updated_at
)
SELECT
  ac.tenant_id,
  s.id AS sucursal_id,
  ac.ambiente,
  ac.certificado_pem,
  ac.clave_privada_pem,
  ac.cuit_emisor,
  ac.punto_de_venta,
  ac.ticket_acceso,
  ac.ticket_sign,
  ac.ticket_expiracion,
  ac.ultimo_comprobante,
  ac.created_at,
  ac.updated_at
FROM public.arca_config ac
JOIN public.sucursal s
  ON s.tenant_id = ac.tenant_id
 AND s.activa = true
WHERE ac.sucursal_id IS NOT NULL
  AND s.id <> ac.sucursal_id
ON CONFLICT (tenant_id, sucursal_id) DO NOTHING;

DELETE FROM public.arca_config WHERE sucursal_id IS NULL;

ALTER TABLE public.arca_config
  ALTER COLUMN sucursal_id SET NOT NULL;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP INDEX IF EXISTS public.idx_arca_config_sucursal_id;
DROP INDEX IF EXISTS public.idx_arca_config_tenant_sucursal;

ALTER TABLE public.arca_config
  DROP CONSTRAINT IF EXISTS arca_config_sucursal_id_fkey;

DELETE FROM public.arca_config a
USING public.arca_config b
WHERE a.tenant_id = b.tenant_id
  AND a.sucursal_id IS NOT NULL
  AND b.sucursal_id IS NOT NULL
  AND a.id <> b.id;

ALTER TABLE public.arca_config
  DROP COLUMN IF EXISTS sucursal_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_arca_config_tenant_id
  ON public.arca_config(tenant_id);
`);
  }
}
