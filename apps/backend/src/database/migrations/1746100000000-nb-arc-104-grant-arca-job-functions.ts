import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-ARC-104: el worker Nest usa el mismo rol PostgreSQL que la app (`CURRENT_USER`).
 * En Postgres autogestionado basta con ejecutar migraciones con ese rol; idempotente si las funciones a├║n no existen.
 */
export class NbArc104GrantArcaJobFunctions1746100000000 implements MigrationInterface {
  name = 'NbArc104GrantArcaJobFunctions1746100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DO $m$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'claim_arca_jobs'
  ) THEN
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.claim_arca_jobs(integer) TO %I',
      current_user
    );
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'reset_stale_arca_jobs'
  ) THEN
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.reset_stale_arca_jobs(integer) TO %I',
      current_user
    );
  END IF;
END$m$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DO $m$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'claim_arca_jobs'
  ) THEN
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.claim_arca_jobs(integer) FROM %I',
      current_user
    );
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'reset_stale_arca_jobs'
  ) THEN
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.reset_stale_arca_jobs(integer) FROM %I',
      current_user
    );
  END IF;
END$m$;
`);
  }
}
