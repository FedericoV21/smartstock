import type { SupabaseClient } from '@supabase/supabase-js';

import { recalcularPreciosSucursalConGanancia } from '@/lib/producto/precio-sucursal';
import type { Database } from '@/types/database';

import { IVA_DESPIECE } from './constantes';

type SB = SupabaseClient<Database>;

export async function forzarIvaDespiece(
  supabase: SB,
  tenantId: string,
  productoIds: Array<string | null | undefined>,
  opciones: { recalcularPrecios?: boolean } = {},
): Promise<void> {
  const ids = Array.from(
    new Set(productoIds.filter((id): id is string => typeof id === 'string' && id.length > 0)),
  );
  if (ids.length === 0) return;

  const { error } = await supabase
    .from('producto')
    .update({ iva_porcentaje: IVA_DESPIECE } as Database['public']['Tables']['producto']['Update'])
    .eq('tenant_id', tenantId)
    .in('id', ids);
  if (error) throw new Error(error.message);

  if (opciones.recalcularPrecios) {
    for (const id of ids) {
      await recalcularPreciosSucursalConGanancia(supabase, { tenantId, productoId: id });
    }
  }
}
