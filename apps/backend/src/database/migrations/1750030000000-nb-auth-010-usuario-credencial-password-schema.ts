import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-AUTH-010: credenciales email+password en PostgreSQL (sin Supabase Auth).
 */
export class NbAuth010UsuarioCredencialPasswordSchema1750030000000 implements MigrationInterface {
  name = 'NbAuth010UsuarioCredencialPasswordSchema1750030000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.usuario_credencial_password (
  usuario_id uuid PRIMARY KEY REFERENCES public.usuario (id) ON DELETE CASCADE,
  email text NOT NULL,
  password_hash text NOT NULL,
  intentos_fallidos smallint NOT NULL DEFAULT 0,
  bloqueado_hasta timestamptz,
  ultimo_login_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_credencial_password_email_not_blank CHECK (btrim(email) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_credencial_password_email_unique
  ON public.usuario_credencial_password (lower(email));

DROP TRIGGER IF EXISTS set_usuario_credencial_password_updated_at ON public.usuario_credencial_password;
CREATE TRIGGER set_usuario_credencial_password_updated_at
  BEFORE UPDATE ON public.usuario_credencial_password
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP TABLE IF EXISTS public.usuario_credencial_password CASCADE;
`);
  }
}
