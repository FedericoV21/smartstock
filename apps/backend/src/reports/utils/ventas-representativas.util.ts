export type ComprobanteVentaPorOrden = {
  id: string;
  tipo: string;
  numeroOrden?: number | null;
};

export function rankFiscalVentaConsolidada(tipo: string): number | null {
  if (tipo === 'factura_a' || tipo === 'factura_b' || tipo === 'factura_c') return 1;
  if (tipo === 'ticket') return 2;
  return null;
}

function claveGrupoNumeroOrden(id: string, numeroOrden: number | null | undefined): string {
  if (numeroOrden != null && Number.isFinite(Number(numeroOrden))) {
    return `o:${Number(numeroOrden)}`;
  }
  return `i:${id}`;
}

export function aplanarRepresentativosVentaPorOrden<T extends ComprobanteVentaPorOrden>(
  rows: T[],
): T[] {
  const byKey = new Map<string, T[]>();
  for (const r of rows) {
    const k = claveGrupoNumeroOrden(r.id, r.numeroOrden ?? null);
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
