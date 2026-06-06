export type ItemConProveedor = {
  lista_id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  item_id: string;
  nombre_raw: string;
  nombre_normalizado: string | null;
  codigo_proveedor: string | null;
  precio_lista: number;
  producto_id: string | null;
};

export type FilaComparativa = {
  nombre_unificado: string;
  producto_id: string | null;
  precios: Record<
    string,
    {
      proveedor_id: string;
      proveedor_nombre: string;
      item_id: string;
      precio: number;
      es_mejor: boolean;
    }
  >;
  mejor_precio: number;
  peor_precio: number;
  ahorro_vs_peor: number;
  ahorro_vs_peor_pct: number;
};

export type ComparacionListasOutput = {
  filas: FilaComparativa[];
  proveedores: { id: string; nombre: string; lista_id: string }[];
  ahorro_total_potencial: number;
  ahorro_pct_potencial: number;
  total_items_cruzados: number;
  ia_usada: boolean;
};

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function cruzarPorProductoId(
  itemsPorLista: Map<string, ItemConProveedor[]>,
): { grupos: Map<string, ItemConProveedor[]>; sinCruzar: ItemConProveedor[] } {
  const porProducto = new Map<string, ItemConProveedor[]>();

  for (const [, items] of itemsPorLista) {
    for (const item of items) {
      if (!item.producto_id) continue;
      if (!porProducto.has(item.producto_id)) porProducto.set(item.producto_id, []);
      porProducto.get(item.producto_id)!.push(item);
    }
  }

  const grupos = new Map<string, ItemConProveedor[]>();
  const itemsUsados = new Set<string>();

  for (const [pid, items] of porProducto) {
    const listasDistintas = new Set(items.map((i) => i.lista_id));
    if (listasDistintas.size >= 2) {
      const porLista = new Map<string, ItemConProveedor>();
      for (const it of items) {
        if (!porLista.has(it.lista_id)) porLista.set(it.lista_id, it);
      }
      const grupo = [...porLista.values()];
      grupos.set(pid, grupo);
      for (const it of grupo) itemsUsados.add(it.item_id);
    }
  }

  const sinCruzar: ItemConProveedor[] = [];
  for (const [, items] of itemsPorLista) {
    for (const item of items) {
      if (!itemsUsados.has(item.item_id)) sinCruzar.push(item);
    }
  }

  return { grupos, sinCruzar };
}

export function buildFilaComparativa(
  nombre: string,
  items: ItemConProveedor[],
  productoId: string | null,
): FilaComparativa {
  const precios: FilaComparativa['precios'] = {};
  for (const it of items) {
    precios[it.lista_id] = {
      proveedor_id: it.proveedor_id,
      proveedor_nombre: it.proveedor_nombre,
      item_id: it.item_id,
      precio: it.precio_lista,
      es_mejor: false,
    };
  }

  const preciosArr = Object.values(precios).map((p) => p.precio);
  const mejor = Math.min(...preciosArr);
  const peor = Math.max(...preciosArr);

  for (const key of Object.keys(precios)) {
    if (precios[key].precio === mejor) {
      precios[key].es_mejor = true;
    }
  }

  return {
    nombre_unificado: nombre,
    producto_id: productoId,
    precios,
    mejor_precio: round2(mejor),
    peor_precio: round2(peor),
    ahorro_vs_peor: round2(peor - mejor),
    ahorro_vs_peor_pct: peor > 0 ? round2(((peor - mejor) / peor) * 100) : 0,
  };
}

export function armarComparacionListas(
  gruposDet: Map<string, ItemConProveedor[]>,
  gruposIA: Map<string, ItemConProveedor[]>,
  prodNombreMap: Map<string, string>,
  proveedoresInfo: { id: string; nombre: string; lista_id: string }[],
  iaUsada: boolean,
): ComparacionListasOutput {
  const filas: FilaComparativa[] = [];

  for (const [pid, items] of gruposDet) {
    const nombre = prodNombreMap.get(pid) ?? items[0].nombre_raw;
    filas.push(buildFilaComparativa(nombre, items, pid));
  }

  for (const [key, items] of gruposIA) {
    const nombre = key.replace(/^ia_/, '');
    const productoId = items.find((i) => i.producto_id)?.producto_id ?? null;
    filas.push(buildFilaComparativa(nombre, items, productoId));
  }

  filas.sort((a, b) => b.ahorro_vs_peor - a.ahorro_vs_peor);

  const ahorroTotal = filas.reduce((s, f) => s + f.ahorro_vs_peor, 0);
  const totalPeor = filas.reduce((s, f) => s + f.peor_precio, 0);
  const ahorroPct = totalPeor > 0 ? round2((ahorroTotal / totalPeor) * 100) : 0;

  return {
    filas,
    proveedores: proveedoresInfo,
    ahorro_total_potencial: round2(ahorroTotal),
    ahorro_pct_potencial: ahorroPct,
    total_items_cruzados: filas.length,
    ia_usada: iaUsada,
  };
}
