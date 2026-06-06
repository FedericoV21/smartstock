/** Firma alineada a NB-SUC-002 / Supabase 106 (stock por dep├│sito). */
export const REGISTRAR_MOVIMIENTO_SQL = `
  SELECT * FROM public.registrar_movimiento(
    $1::uuid,
    $2::uuid,
    $3::uuid,
    $4::tipo_movimiento,
    $5::numeric,
    $6::text,
    $7::referencia_tipo,
    $8::uuid,
    $9::uuid
  )
`;
