type ProductoBusqueda = {
  id: string;
  codigo: string;
  nombre: string;
};

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Prioriza matches exactos de código y prefijos de nombre/código para
 * que el operador encuentre más rápido productos en transferencias.
 */
export function ordenarResultadosBusquedaTransferencia<T extends ProductoBusqueda>(
  items: T[],
  queryRaw: string,
): T[] {
  const q = normalizar(queryRaw);
  if (!q) return items;
  const rank = (p: T): number => {
    const codigo = normalizar(p.codigo);
    const nombre = normalizar(p.nombre);
    if (codigo === q) return 0;
    if (nombre === q) return 1;
    if (codigo.startsWith(q)) return 2;
    if (nombre.startsWith(q)) return 3;
    if (codigo.includes(q)) return 4;
    if (nombre.includes(q)) return 5;
    return 6;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || a.nombre.localeCompare(b.nombre, 'es'));
}

