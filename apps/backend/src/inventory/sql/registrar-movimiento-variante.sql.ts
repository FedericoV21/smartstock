/** NB-VAR-001 ÔÇö movimiento de stock por variante y dep├│sito. */
export const REGISTRAR_MOVIMIENTO_VARIANTE_SQL = `
  SELECT * FROM public.registrar_movimiento_variante(
    $1::uuid,
    $2::uuid,
    $3::uuid,
    $4::uuid,
    $5::tipo_movimiento,
    $6::numeric,
    $7::text,
    $8::referencia_tipo,
    $9::uuid,
    $10::uuid
  )
`;
