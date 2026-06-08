import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-AUTH-010: tokens de invitación y refresh JWT en PostgreSQL.
 */
export class NbAuth010InviteRefreshSchema1750040000000 implements MigrationInterface {
  name = 'NbAuth010InviteRefreshSchema1750040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.usuario_credencial_password
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.usuario_invite_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuario_invite_token_hash_unique
  ON public.usuario_invite_token (token_hash);

CREATE INDEX IF NOT EXISTS idx_usuario_invite_token_usuario
  ON public.usuario_invite_token (usuario_id);

CREATE TABLE IF NOT EXISTS public.auth_refresh_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_refresh_token_hash_unique
  ON public.auth_refresh_token (token_hash);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_token_usuario
  ON public.auth_refresh_token (usuario_id);
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.auth_refresh_token CASCADE;
DROP TABLE IF EXISTS public.usuario_invite_token CASCADE;
ALTER TABLE public.usuario_credencial_password DROP COLUMN IF EXISTS must_change_password;
`);
  }
}
