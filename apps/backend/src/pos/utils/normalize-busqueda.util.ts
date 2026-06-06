/** Normaliza texto para b├║squeda POS (sin acentos, min├║sculas). */
export function normalizarTextoBusqueda(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

export function sanitizarQueryBusqueda(raw: string): string {
  return raw.replace(/[,()%_\\'"]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function rankScoreBusquedaProducto(
  row: { codigo: string; nombre: string; codigoBarras: string | null; plu: string | null },
  qRaw: string,
  qNorm: string,
): number {
  const digitsQ = qRaw.replace(/\D/g, '');
  const codigo = row.codigo?.toLowerCase() ?? '';
  const nombre = row.nombre?.toLowerCase() ?? '';
  const barra = row.codigoBarras?.toLowerCase() ?? '';
  const plu = row.plu?.toLowerCase() ?? '';
  const rawLower = qRaw.toLowerCase();

  if (digitsQ.length >= 6 && row.codigoBarras === digitsQ) return 0;
  if (codigo === rawLower) return 1;
  if (barra === rawLower) return 2;
  if (codigo.startsWith(qNorm)) return 3;
  if (nombre.startsWith(qNorm)) return 4;
  if (nombre.includes(` ${qNorm}`)) return 5;
  if (plu && plu === digitsQ) return 2;
  return 6;
}
