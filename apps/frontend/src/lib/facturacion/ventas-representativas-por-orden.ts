/**
 * Regla Nexus (Plan Órdenes §5.3): por cada `numero_orden`, en agregados de venta
 * cuenta un solo comprobante — el de mayor jerarquía fiscal (factura A/B/C > ticket).
 * Filas sin `numero_orden` se tratan como órdenes individuales (clave por `id`).
 */

export type ComprobanteVentaPorOrden = {
  id: string;
  tipo: string;
  numero_orden?: number | null;
};

/** Menor rank = mayor prioridad para consolidar ticket + factura misma orden. */
export function rankFiscalVentaConsolidada(tipo: string): number | null {
  if (tipo === 'factura_a' || tipo === 'factura_b' || tipo === 'factura_c') return 1;
  if (tipo === 'ticket') return 2;
  return null;
}

export function claveGrupoNumeroOrden(id: string, numeroOrden: number | null | undefined): string {
  if (numeroOrden != null && Number.isFinite(Number(numeroOrden))) {
    return `o:${Number(numeroOrden)}`;
  }
  return `i:${id}`;
}

/**
 * Por cada grupo (`numero_orden` o `id`), si hay ticket y/o factura de venta,
 * deja una sola fila (la de mayor jerarquía). El resto de tipos del grupo se conservan.
 */
export function aplanarRepresentativosVentaPorOrden<T extends ComprobanteVentaPorOrden>(
  rows: T[],
): T[] {
  const byKey = new Map<string, T[]>();
  for (const r of rows) {
    const k = claveGrupoNumeroOrden(r.id, r.numero_orden ?? null);
    const arr = byKey.get(k) ?? [];
    arr.push(r);
    byKey.set(k, arr);
  }

  const out: T[] = [];
  for (const [, arr] of byKey) {
    const ventasTf = arr.filter((r) => rankFiscalVentaConsolidada(r.tipo) != null);
    const rest = arr.filter((r) => rankFiscalVentaConsolidada(r.tipo) == null);
    if (ventasTf.length) {
      ventasTf.sort((a, b) => {
        const ra = rankFiscalVentaConsolidada(a.tipo)!;
        const rb = rankFiscalVentaConsolidada(b.tipo)!;
        if (ra !== rb) return ra - rb;
        return a.id.localeCompare(b.id);
      });
      out.push(ventasTf[0]!);
    }
    out.push(...rest);
  }
  return out;
}
