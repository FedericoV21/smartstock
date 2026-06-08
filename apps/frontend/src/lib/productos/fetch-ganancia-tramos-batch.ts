import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

import {
  normalizarTramos,
  tramosConGananciaBaseOverride,
  type GananciaTramo,
} from '@/lib/productos/precio-por-tramos';

function errorIndicaTablaTramosInexistente(msg: string): boolean {
  const t = msg.toLowerCase();
  return (
    t.includes('producto_ganancia_tramo') &&
    (t.includes('does not exist') ||
      t.includes('schema cache') ||
      t.includes('could not find') ||
      t.includes('relation'))
  );
}

const TRAMOS_ID_CHUNK = 80;

/** Tramos agrupados por `producto_id` (lista normalizada por producto). */
export async function fetchMapaGananciaTramosPorProductoIds(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  productoIds: string[],
): Promise<Map<string, GananciaTramo[]>> {
  const out = new Map<string, GananciaTramo[]>();
  const ids = [...new Set(productoIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return out;

  const acumularFila = (row: {
    producto_id: string;
    cantidad_desde: number | string;
    ganancia_pct: number | string;
  }) => {
    const pid = row.producto_id as string;
    const list = out.get(pid) ?? [];
    list.push({
      cantidad_desde: Number(row.cantidad_desde),
      ganancia_pct: Number(row.ganancia_pct),
    });
    out.set(pid, list);
  };

  for (let i = 0; i < ids.length; i += TRAMOS_ID_CHUNK) {
    const chunk = ids.slice(i, i + TRAMOS_ID_CHUNK);
    try {
      const { data, error } = await supabase
        .from('producto_ganancia_tramo')
        .select('producto_id, cantidad_desde, ganancia_pct, orden')
        .eq('tenant_id', tenantId)
        .in('producto_id', chunk)
        .order('orden', { ascending: true })
        .order('cantidad_desde', { ascending: true });

      if (error) {
        const msg = error.message ?? '';
        if (!errorIndicaTablaTramosInexistente(msg)) {
          console.warn('[fetchMapaGananciaTramosPorProductoIds]', msg);
        }
        continue;
      }
      for (const row of data ?? []) {
        acumularFila(row);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[fetchMapaGananciaTramosPorProductoIds]', msg);
    }
  }

  for (const [pid, raw] of out) {
    out.set(pid, normalizarTramos(raw));
  }
  return out;
}

export async function enrichProductosPayloadConTramos<
  P extends { id: string },
>(opts: {
  supabase: SupabaseClient<Database>;
  tenantId: string;
  productos: P[];
  mapa?: Map<string, GananciaTramo[]>;
}): Promise<Array<P & { ganancia_tramos: GananciaTramo[] }>> {
  const { supabase, tenantId, productos } = opts;
  const mapa =
    opts.mapa ??
    (await fetchMapaGananciaTramosPorProductoIds(
      supabase,
      tenantId,
      productos.map((p) => p.id),
    ));
  return productos.map((p) => ({
    ...p,
    ganancia_tramos: tramosConGananciaBaseOverride(
      mapa.get(p.id) ?? [],
      (p as { porcentaje_ganancia?: number | null }).porcentaje_ganancia,
      (p as { precio_sucursal_ganancia_aplicada?: boolean }).precio_sucursal_ganancia_aplicada === true,
    ),
  }));
}

export async function addGananciaTramosToProducto<P extends { id: string }>(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  producto: P,
): Promise<P & { ganancia_tramos: GananciaTramo[] }> {
  const [one] = await enrichProductosPayloadConTramos({
    supabase,
    tenantId,
    productos: [producto],
  });
  return one;
}
