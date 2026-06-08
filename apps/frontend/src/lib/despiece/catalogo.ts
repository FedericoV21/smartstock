import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

type SB = SupabaseClient<Database>;

export async function upsertPrecioSucursalDespiece(
  supabase: SB,
  params: {
    tenantId: string;
    productoId: string;
    sucursalId: string | null | undefined;
    precioCosto: number;
    precioVenta: number;
  },
): Promise<void> {
  if (!params.sucursalId) return;

  const { error } = await supabase.from('precio_sucursal').upsert(
    {
      tenant_id: params.tenantId,
      producto_id: params.productoId,
      sucursal_id: params.sucursalId,
      precio_costo: params.precioCosto,
      precio_venta: params.precioVenta,
      porcentaje_ganancia: null,
    },
    { onConflict: 'producto_id,sucursal_id' },
  );

  if (error) throw new Error(error.message);
}
