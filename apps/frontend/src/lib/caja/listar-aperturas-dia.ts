import { redondear2 } from '@/lib/caja/cierre-z-calculo';

export type AperturaListRow = {
  id: string;
  opened_at: string;
  fondo_efectivo: number;
  fecha_operativa: string;
  created_at?: string;
};

/** Aperturas registradas en una fecha operativa (y caja, si se filtra). */
export async function listarAperturasPorFechaOperativa(
  supabase: any,
  opts: { fechaOperativa: string; cajaIdNormalizada: string | null; sucursalId: string },
): Promise<AperturaListRow[]> {
  let q = supabase
    .from('caja_apertura')
    .select('id, opened_at, fondo_efectivo, fecha_operativa, created_at')
    .eq('fecha_operativa', opts.fechaOperativa)
    .order('opened_at', { ascending: false });
  const caja = (opts.cajaIdNormalizada || '').trim() || '__sin_caja__';
  q = q.eq('caja_id', caja);
  q = q.eq('sucursal_id', opts.sucursalId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    opened_at: String(r.opened_at),
    fondo_efectivo: redondear2(Number(r.fondo_efectivo)),
    fecha_operativa: String(r.fecha_operativa),
    created_at: r.created_at != null ? String(r.created_at) : undefined,
  }));
}
