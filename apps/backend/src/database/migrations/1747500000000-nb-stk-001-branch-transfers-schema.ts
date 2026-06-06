import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NB-STK-001: transferencias de stock entre sucursales (env├¡o + recepci├│n pendiente).
 * Paridad Supabase 156 (sin variantes; columna variante reservada para NB-VAR-001).
 */
export class NbStk001BranchTransfersSchema1747500000000 implements MigrationInterface {
  name = 'NbStk001BranchTransfersSchema1747500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TYPE public.referencia_tipo ADD VALUE IF NOT EXISTS 'transferencia_sucursal';

CREATE TABLE IF NOT EXISTS public.stock_transferencia_sucursal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenant (id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.producto (id) ON DELETE RESTRICT,
  sucursal_origen_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  sucursal_destino_id uuid NOT NULL REFERENCES public.sucursal (id) ON DELETE RESTRICT,
  cantidad numeric(12, 3) NOT NULL,
  motivo text,
  estado text NOT NULL DEFAULT 'pendiente',
  usuario_envio_id uuid REFERENCES public.usuario (id) ON DELETE SET NULL,
  usuario_recepcion_id uuid REFERENCES public.usuario (id) ON DELETE SET NULL,
  movimiento_salida_id uuid REFERENCES public.movimiento (id) ON DELETE SET NULL,
  movimiento_entrada_id uuid REFERENCES public.movimiento (id) ON DELETE SET NULL,
  deposito_destino_existia boolean NOT NULL DEFAULT false,
  deposito_destino_creado boolean NOT NULL DEFAULT false,
  enviado_at timestamptz NOT NULL DEFAULT now(),
  recibido_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_stock_transferencia_cantidad_pos CHECK (cantidad > 0),
  CONSTRAINT chk_stock_transferencia_sucursales_distintas CHECK (sucursal_origen_id <> sucursal_destino_id),
  CONSTRAINT chk_stock_transferencia_estado CHECK (estado IN ('pendiente', 'recibida', 'cancelada'))
);

CREATE INDEX IF NOT EXISTS idx_stock_transferencia_tenant_estado
  ON public.stock_transferencia_sucursal (tenant_id, estado, enviado_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_transferencia_destino_pendiente
  ON public.stock_transferencia_sucursal (tenant_id, sucursal_destino_id, enviado_at DESC)
  WHERE estado = 'pendiente';

CREATE INDEX IF NOT EXISTS idx_stock_transferencia_origen
  ON public.stock_transferencia_sucursal (tenant_id, sucursal_origen_id, enviado_at DESC);

CREATE TRIGGER stock_transferencia_set_updated_at
  BEFORE UPDATE ON public.stock_transferencia_sucursal
  FOR EACH ROW
  EXECUTE FUNCTION public.moddatetime();

COMMENT ON TABLE public.stock_transferencia_sucursal IS
  'Transferencias de stock entre sucursales. La salida se registra al enviar; la entrada al aceptar en destino.';
`);

    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.crear_transferencia_stock_pendiente(
  p_tenant_id           uuid,
  p_producto_id         uuid,
  p_sucursal_origen_id  uuid,
  p_sucursal_destino_id uuid,
  p_cantidad            numeric(12, 3),
  p_motivo              text DEFAULT NULL,
  p_usuario_id          uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $ctf$
DECLARE
  v_transfer_id uuid;
  m_sal public.movimiento;
  n_d text;
  v_mot_sal text;
  v_dest_exists_before boolean;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a cero';
  END IF;

  IF p_sucursal_origen_id IS NULL OR p_sucursal_destino_id IS NULL THEN
    RAISE EXCEPTION 'Sucursal de origen y destino son obligatorias';
  END IF;

  IF p_sucursal_origen_id = p_sucursal_destino_id THEN
    RAISE EXCEPTION 'Origen y destino deben ser sucursales distintas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sucursal s
    WHERE s.id = p_sucursal_origen_id AND s.tenant_id = p_tenant_id AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal de origen no encontrada o inactiva';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sucursal s
    WHERE s.id = p_sucursal_destino_id AND s.tenant_id = p_tenant_id AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal de destino no encontrada o inactiva';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.producto p
    WHERE p.id = p_producto_id AND p.tenant_id = p_tenant_id AND p.activo = true
  ) THEN
    RAISE EXCEPTION 'Producto no encontrado o inactivo';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(
      p_tenant_id::text || p_producto_id::text
      || LEAST(p_sucursal_origen_id, p_sucursal_destino_id)::text
      || GREATEST(p_sucursal_origen_id, p_sucursal_destino_id)::text
    )
  );

  SELECT s.nombre INTO n_d FROM public.sucursal s WHERE s.id = p_sucursal_destino_id;

  SELECT EXISTS (
    SELECT 1 FROM public.stock_sucursal ss
    WHERE ss.tenant_id = p_tenant_id
      AND ss.producto_id = p_producto_id
      AND ss.sucursal_id = p_sucursal_destino_id
  ) INTO v_dest_exists_before;

  v_transfer_id := gen_random_uuid();
  v_mot_sal := 'Transferencia enviada a ' || COALESCE(n_d, '(sucursal)') || ' (pendiente de recepcion)'
    || COALESCE(' - ' || NULLIF(btrim(COALESCE(p_motivo, '')), ''), '');

  SELECT * INTO m_sal FROM public.registrar_movimiento(
    p_tenant_id,
    p_producto_id,
    p_sucursal_origen_id,
    'salida'::public.tipo_movimiento,
    p_cantidad,
    v_mot_sal,
    'transferencia_sucursal'::public.referencia_tipo,
    v_transfer_id,
    p_usuario_id,
    false
  );

  INSERT INTO public.stock_transferencia_sucursal (
    id, tenant_id, producto_id,
    sucursal_origen_id, sucursal_destino_id, cantidad, motivo,
    estado, usuario_envio_id, movimiento_salida_id,
    deposito_destino_existia, deposito_destino_creado
  ) VALUES (
    v_transfer_id, p_tenant_id, p_producto_id,
    p_sucursal_origen_id, p_sucursal_destino_id, p_cantidad,
    NULLIF(btrim(COALESCE(p_motivo, '')), ''),
    'pendiente', p_usuario_id, m_sal.id,
    v_dest_exists_before, false
  );

  RETURN jsonb_build_object(
    'transfer_id', v_transfer_id,
    'estado', 'pendiente',
    'producto_id', p_producto_id,
    'sucursal_origen_id', p_sucursal_origen_id,
    'sucursal_destino_id', p_sucursal_destino_id,
    'cantidad', p_cantidad,
    'movimiento_salida', to_jsonb(m_sal),
    'deposito_destino_existia', v_dest_exists_before,
    'deposito_destino_creado', false
  );
END;
$ctf$;

CREATE OR REPLACE FUNCTION public.aceptar_transferencia_stock_sucursal(
  p_tenant_id        uuid,
  p_transferencia_id uuid,
  p_usuario_id       uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $atf$
DECLARE
  v_t public.stock_transferencia_sucursal%ROWTYPE;
  m_ent public.movimiento;
  n_o text;
  n_d text;
  v_mot_ent text;
  v_dest_exists_before boolean;
BEGIN
  SELECT * INTO v_t
  FROM public.stock_transferencia_sucursal t
  WHERE t.id = p_transferencia_id AND t.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transferencia no encontrada';
  END IF;

  IF v_t.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'La transferencia ya no esta pendiente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sucursal s
    WHERE s.id = v_t.sucursal_destino_id AND s.tenant_id = p_tenant_id AND s.activa = true
  ) THEN
    RAISE EXCEPTION 'Sucursal de destino no encontrada o inactiva';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(
      p_tenant_id::text || v_t.producto_id::text
      || LEAST(v_t.sucursal_origen_id, v_t.sucursal_destino_id)::text
      || GREATEST(v_t.sucursal_origen_id, v_t.sucursal_destino_id)::text
    )
  );

  SELECT s.nombre INTO n_o FROM public.sucursal s WHERE s.id = v_t.sucursal_origen_id;
  SELECT s.nombre INTO n_d FROM public.sucursal s WHERE s.id = v_t.sucursal_destino_id;

  SELECT EXISTS (
    SELECT 1 FROM public.stock_sucursal ss
    WHERE ss.tenant_id = p_tenant_id
      AND ss.producto_id = v_t.producto_id
      AND ss.sucursal_id = v_t.sucursal_destino_id
  ) INTO v_dest_exists_before;

  v_mot_ent := 'Recepcion de transferencia desde ' || COALESCE(n_o, '(sucursal)')
    || COALESCE(' - ' || NULLIF(btrim(COALESCE(v_t.motivo, '')), ''), '');

  SELECT * INTO m_ent FROM public.registrar_movimiento(
    p_tenant_id,
    v_t.producto_id,
    v_t.sucursal_destino_id,
    'entrada'::public.tipo_movimiento,
    v_t.cantidad,
    v_mot_ent,
    'transferencia_sucursal'::public.referencia_tipo,
    v_t.id,
    p_usuario_id,
    false
  );

  UPDATE public.stock_transferencia_sucursal
  SET estado = 'recibida',
      usuario_recepcion_id = p_usuario_id,
      movimiento_entrada_id = m_ent.id,
      deposito_destino_creado = NOT v_dest_exists_before,
      recibido_at = now()
  WHERE id = v_t.id;

  RETURN jsonb_build_object(
    'transfer_id', v_t.id,
    'estado', 'recibida',
    'sucursal_origen_id', v_t.sucursal_origen_id,
    'sucursal_destino_id', v_t.sucursal_destino_id,
    'sucursal_destino_nombre', n_d,
    'cantidad', v_t.cantidad,
    'movimiento_entrada', to_jsonb(m_ent),
    'deposito_destino_creado', NOT v_dest_exists_before
  );
END;
$atf$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP FUNCTION IF EXISTS public.aceptar_transferencia_stock_sucursal(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.crear_transferencia_stock_pendiente(uuid, uuid, uuid, uuid, numeric, text, uuid);
DROP TABLE IF EXISTS public.stock_transferencia_sucursal;
`);
  }
}
