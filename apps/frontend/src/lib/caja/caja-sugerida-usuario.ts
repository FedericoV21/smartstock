/** Cajas ya filtradas por tenant, sucursal y permiso de operar. */
export type CajaParaSugerencia = {
  id: string;
  numero: number;
  usuario_default_id?: string | null;
};

/**
 * Elige la caja “programada” para el usuario en esta sucursal:
 * 1) `usuario_default_id` coincide con el usuario
 * 2) una sola fila en `caja_usuario` intersecta la lista
 * 3) hay una sola caja en la lista
 * 4) fallback: menor `numero`
 */
export function elegirCajaSugeridaId(
  userId: string,
  cajas: CajaParaSugerencia[],
  cajaIdsEnUsuarioMiembro: string[],
): string | null {
  if (cajas.length === 0) return null;

  const porDefault = cajas.filter((c) => c.usuario_default_id === userId);
  if (porDefault.length === 1) return porDefault[0].id;
  if (porDefault.length > 1) {
    return [...porDefault].sort((a, b) => a.numero - b.numero)[0].id;
  }

  const setMiembro = new Set(cajaIdsEnUsuarioMiembro);
  const soloVinculo = cajas.filter((c) => setMiembro.has(c.id));
  if (soloVinculo.length === 1) return soloVinculo[0].id;

  if (cajas.length === 1) return cajas[0].id;

  return [...cajas].sort((a, b) => a.numero - b.numero)[0]?.id ?? null;
}
