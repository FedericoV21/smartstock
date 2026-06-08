-- Importación (y ajustes de inventario) pueden fijar stock objetivo negativo.
-- registrar_movimiento con tipo 'ajuste' persiste p_cantidad en movimiento.cantidad (= stock posterior);
-- chk_cantidad_positiva (cantidad > 0) lo impedía. Entrada/salida siguen exigiendo cantidad estrictamente positiva.

ALTER TABLE public.movimiento
  DROP CONSTRAINT IF EXISTS chk_cantidad_positiva;

ALTER TABLE public.movimiento
  ADD CONSTRAINT chk_movimiento_cantidad_segun_tipo CHECK (
    (tipo IN ('entrada', 'salida') AND cantidad > 0)
    OR (tipo = 'ajuste')
  );
