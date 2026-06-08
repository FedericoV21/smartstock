/**
 * Quién puede operar una caja:
 * - usuario asignado como `usuario_default_id` de la caja
 * - puede operar la sucursal de la caja (`usuario_puede_operar_sucursal`: membresía, default en perfil, etc.)
 * - fila explícita en `caja_usuario`
 * - si la caja no tiene ninguna fila en `caja_usuario`, queda abierta a quien ya pasó el filtro de API
 */
export async function usuarioPuedeOperarCaja(
  supabase: any,
  userId: string,
  caja: {
    id: string;
    sucursal_id?: string | null;
    usuario_default_id: string | null;
  },
): Promise<boolean> {
  if (caja.usuario_default_id === userId) return true;

  const sucursalId = String(caja.sucursal_id ?? '').trim();
  if (sucursalId) {
    const { data: puede, error: rpcErr } = await supabase.rpc('usuario_puede_operar_sucursal', {
      p_sucursal_id: sucursalId,
    });
    if (rpcErr) throw new Error(rpcErr.message);
    if (puede === true) return true;
  }

  const { data: row, error: errRow } = await supabase
    .from('caja_usuario')
    .select('id')
    .eq('caja_id', caja.id)
    .eq('usuario_id', userId)
    .maybeSingle();
  if (errRow) throw new Error(errRow.message);
  if (row) return true;

  const { count, error } = await supabase
    .from('caja_usuario')
    .select('id', { count: 'exact', head: true })
    .eq('caja_id', caja.id);
  if (error) throw new Error(error.message);
  if ((count ?? 0) === 0) return true;

  return false;
}
