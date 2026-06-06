export const CREAR_TRANSFERENCIA_STOCK_SQL = `
  SELECT public.crear_transferencia_stock_pendiente(
    $1::uuid,
    $2::uuid,
    $3::uuid,
    $4::uuid,
    $5::numeric,
    $6::text,
    $7::uuid
  ) AS data
`;

export const ACEPTAR_TRANSFERENCIA_STOCK_SQL = `
  SELECT public.aceptar_transferencia_stock_sucursal(
    $1::uuid,
    $2::uuid,
    $3::uuid
  ) AS data
`;
