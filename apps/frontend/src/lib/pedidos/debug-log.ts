/** Diagnóstico temporal de listado/filtrado de pedidos (bandeja, sucursal). */
export function logPedidosDiag(
  step: string,
  payload: Record<string, unknown>,
): void {
  const on =
    process.env.NODE_ENV === 'development' ||
    process.env.DEBUG_PEDIDOS === '1';
  if (!on) return;
  console.info(`[pedidos:diag] ${step}`, payload);
}

/** True si debe incluirse payload _diag en JSON de APIs de pedidos. */
export function pedidosDiagEnRespuesta(): boolean {
  return process.env.DEBUG_PEDIDOS === '1';
}

export function shortenId(id: string, keep = 8): string {
  if (id.length <= keep) return id;
  return `${id.slice(0, keep)}…`;
}
