export type ListaResumenTemporal = {
  id: string;
  fecha_recepcion: string;
  nombre_archivo: string;
  variacion_promedio_pct: number | null;
  total_items: number;
  items_con_aumento: number;
};

export type ProductoEvolucion = {
  producto_id: string;
  producto_nombre: string;
  puntos: {
    lista_id: string;
    fecha: string;
    precio_lista: number;
    variacion_pct: number | null;
  }[];
  aumento_acumulado_pct: number;
  es_inflacionario: boolean;
  es_estable: boolean;
};

export type ComparacionTemporalOutput = {
  proveedor_id: string;
  proveedor_nombre: string;
  listas: ListaResumenTemporal[];
  dias_promedio_entre_listas: number | null;
  aumento_acumulado_pct: number;
  aumento_promedio_por_lista_pct: number;
  productos_inflacionarios: ProductoEvolucion[];
  productos_estables: ProductoEvolucion[];
};

function diasEntre(a: string, b: string): number {
  return Math.abs((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

type ListaInput = {
  id: string;
  createdAt: Date;
  nombre: string;
  variacionPromedioPct: string | null;
  totalItems: number;
  itemsConAumento: number;
};

type ItemInput = {
  listaId: string;
  productoId: string;
  precioLista: string;
  variacionPct: string | null;
};

export function compararTemporalFromData(
  proveedorId: string,
  proveedorNombre: string,
  listas: ListaInput[],
  allItems: ItemInput[],
  productoNombres: Map<string, string>,
): ComparacionTemporalOutput {
  if (listas.length < 2) {
    throw new Error('Se necesitan al menos 2 listas analizadas del mismo proveedor para comparar');
  }

  const ordenadas = [...listas].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const listasResumen: ListaResumenTemporal[] = ordenadas.map((l) => ({
    id: l.id,
    fecha_recepcion: l.createdAt.toISOString().slice(0, 10),
    nombre_archivo: l.nombre,
    variacion_promedio_pct:
      l.variacionPromedioPct != null ? Number(l.variacionPromedioPct) : null,
    total_items: l.totalItems,
    items_con_aumento: l.itemsConAumento,
  }));

  const intervalos: number[] = [];
  for (let i = 1; i < ordenadas.length; i++) {
    intervalos.push(
      diasEntre(
        ordenadas[i - 1].createdAt.toISOString().slice(0, 10),
        ordenadas[i].createdAt.toISOString().slice(0, 10),
      ),
    );
  }
  const diasPromedio =
    intervalos.length > 0
      ? Math.round(intervalos.reduce((s, d) => s + d, 0) / intervalos.length)
      : null;

  const variaciones = ordenadas
    .map((l) => (l.variacionPromedioPct != null ? Number(l.variacionPromedioPct) : null))
    .filter((v): v is number => v != null);

  const aumentoAcumulado =
    variaciones.length > 0
      ? variaciones.reduce((acc, v) => acc * (1 + v / 100), 1) * 100 - 100
      : 0;

  const aumentoPromedio =
    variaciones.length > 0 ? variaciones.reduce((s, v) => s + v, 0) / variaciones.length : 0;

  const fechaMap = new Map(ordenadas.map((l) => [l.id, l.createdAt.toISOString().slice(0, 10)]));

  const productoItems = new Map<
    string,
    { lista_id: string; fecha: string; precio_lista: number; variacion_pct: number | null }[]
  >();

  for (const item of allItems) {
    const pid = item.productoId;
    if (!productoItems.has(pid)) productoItems.set(pid, []);
    productoItems.get(pid)!.push({
      lista_id: item.listaId,
      fecha: fechaMap.get(item.listaId) ?? '',
      precio_lista: Number(item.precioLista),
      variacion_pct: item.variacionPct != null ? Number(item.variacionPct) : null,
    });
  }

  const UMBRAL_INFLACIONARIO = 5;
  const UMBRAL_ESTABLE = 2;

  const inflacionarios: ProductoEvolucion[] = [];
  const estables: ProductoEvolucion[] = [];

  for (const [pid, puntos] of productoItems) {
    if (puntos.length < 2) continue;

    puntos.sort((a, b) => a.fecha.localeCompare(b.fecha));

    const primerPrecio = puntos[0].precio_lista;
    const ultimoPrecio = puntos[puntos.length - 1].precio_lista;
    const acumulado =
      primerPrecio > 0 ? ((ultimoPrecio - primerPrecio) / primerPrecio) * 100 : 0;

    const avgVar = puntos.map((p) => p.variacion_pct).filter((v): v is number => v != null);
    const promVar = avgVar.length > 0 ? avgVar.reduce((s, v) => s + v, 0) / avgVar.length : 0;

    const esInflacionario = promVar > UMBRAL_INFLACIONARIO;
    const esEstable = Math.abs(promVar) <= UMBRAL_ESTABLE;

    const evo: ProductoEvolucion = {
      producto_id: pid,
      producto_nombre: productoNombres.get(pid) ?? pid,
      puntos,
      aumento_acumulado_pct: Math.round(acumulado * 100) / 100,
      es_inflacionario: esInflacionario,
      es_estable: esEstable,
    };

    if (esInflacionario) inflacionarios.push(evo);
    if (esEstable) estables.push(evo);
  }

  inflacionarios.sort((a, b) => b.aumento_acumulado_pct - a.aumento_acumulado_pct);
  estables.sort((a, b) => a.aumento_acumulado_pct - b.aumento_acumulado_pct);

  return {
    proveedor_id: proveedorId,
    proveedor_nombre: proveedorNombre,
    listas: listasResumen,
    dias_promedio_entre_listas: diasPromedio,
    aumento_acumulado_pct: Math.round(aumentoAcumulado * 100) / 100,
    aumento_promedio_por_lista_pct: Math.round(aumentoPromedio * 100) / 100,
    productos_inflacionarios: inflacionarios.slice(0, 20),
    productos_estables: estables.slice(0, 20),
  };
}
