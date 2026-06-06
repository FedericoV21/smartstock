import { MigrationInterface, QueryRunner } from 'typeorm';

/** NB-IA-001: columna tenant.ia_ilimitada_origen para l├¡mites IA en plan intermedio. */
export class NbIa001TenantIaIlimitadaOrigen1748700000000 implements MigrationInterface {
  name = 'NbIa001TenantIaIlimitadaOrigen1748700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS ia_ilimitada_origen text;

ALTER TABLE public.tenant
  DROP CONSTRAINT IF EXISTS chk_tenant_ia_ilimitada_origen;

ALTER TABLE public.tenant
  ADD CONSTRAINT chk_tenant_ia_ilimitada_origen
  CHECK (
    ia_ilimitada_origen IS NULL
    OR ia_ilimitada_origen IN ('lector_factura', 'ia_pdf')
  );

COMMENT ON COLUMN public.tenant.ia_ilimitada_origen IS
  'En plan intermedio: define qu├® IA es ilimitada (lector_factura o ia_pdf).';
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.tenant DROP CONSTRAINT IF EXISTS chk_tenant_ia_ilimitada_origen;
ALTER TABLE public.tenant DROP COLUMN IF EXISTS ia_ilimitada_origen;
`);
  }
}
