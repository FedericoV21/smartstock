export function normalizarString(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function codigoNormItem(c: string): string {
  return c.trim().toLowerCase();
}

function codigoCompacto(c: string): string {
  return c.trim().toLowerCase().replace(/[\s\-_.]/g, '');
}

export interface ProductoCatalogo {
  id: string;
  codigo: string;
  nombre: string;
}

export interface ItemMatcheable {
  id: string;
  codigoProveedor: string | null;
  nombreProveedor: string;
}

export interface MatchResult {
  itemId: string;
  productoId: string;
  confidence: number;
  metodo: 'codigo_exacto' | 'nombre_normalizado' | 'ia_fuzzy';
}

function agruparProductosPorCodigo(productos: ProductoCatalogo[]): {
  porNorm: Map<string, ProductoCatalogo[]>;
  porCompact: Map<string, ProductoCatalogo[]>;
} {
  const porNorm = new Map<string, ProductoCatalogo[]>();
  const porCompact = new Map<string, ProductoCatalogo[]>();
  const push = (m: Map<string, ProductoCatalogo[]>, k: string, p: ProductoCatalogo) => {
    const arr = m.get(k) ?? [];
    arr.push(p);
    m.set(k, arr);
  };
  for (const p of productos) {
    const raw = p.codigo?.trim();
    if (!raw) continue;
    push(porNorm, codigoNormItem(raw), p);
    const comp = codigoCompacto(raw);
    if (comp) push(porCompact, comp, p);
  }
  return { porNorm, porCompact };
}

function matchPorCodigo(
  items: ItemMatcheable[],
  porNorm: Map<string, ProductoCatalogo[]>,
  porCompact: Map<string, ProductoCatalogo[]>,
): { matched: MatchResult[]; remaining: ItemMatcheable[] } {
  const matched: MatchResult[] = [];
  const remaining: ItemMatcheable[] = [];

  for (const item of items) {
    if (!item.codigoProveedor?.trim()) {
      remaining.push(item);
      continue;
    }

    const raw = item.codigoProveedor.trim();
    const candidatosNorm = porNorm.get(codigoNormItem(raw));
    if (candidatosNorm?.length === 1) {
      matched.push({
        itemId: item.id,
        productoId: candidatosNorm[0].id,
        confidence: 1,
        metodo: 'codigo_exacto',
      });
      continue;
    }
    if (candidatosNorm && candidatosNorm.length > 1) {
      remaining.push(item);
      continue;
    }

    const comp = codigoCompacto(raw);
    const candidatosComp = comp ? porCompact.get(comp) : undefined;
    if (candidatosComp?.length === 1) {
      matched.push({
        itemId: item.id,
        productoId: candidatosComp[0].id,
        confidence: 1,
        metodo: 'codigo_exacto',
      });
      continue;
    }

    remaining.push(item);
  }

  return { matched, remaining };
}

function matchPorNombre(
  items: ItemMatcheable[],
  productosPorNombre: Map<string, ProductoCatalogo>,
  productosUsados: Set<string>,
): { matched: MatchResult[]; remaining: ItemMatcheable[] } {
  const matched: MatchResult[] = [];
  const remaining: ItemMatcheable[] = [];

  for (const item of items) {
    const nombreNorm = normalizarString(item.nombreProveedor);
    const producto = productosPorNombre.get(nombreNorm);

    if (producto && !productosUsados.has(producto.id)) {
      matched.push({
        itemId: item.id,
        productoId: producto.id,
        confidence: 0.95,
        metodo: 'nombre_normalizado',
      });
      productosUsados.add(producto.id);
    } else {
      remaining.push(item);
    }
  }

  return { matched, remaining };
}

export function ejecutarMatching(
  items: ItemMatcheable[],
  productos: ProductoCatalogo[],
): {
  matches: MatchResult[];
  sinMatch: ItemMatcheable[];
  resumen: { total: number; seguros: number; sin_match: number };
} {
  const productosPorNombre = new Map<string, ProductoCatalogo>();
  for (const p of productos) {
    productosPorNombre.set(normalizarString(p.nombre), p);
  }

  const { porNorm, porCompact } = agruparProductosPorCodigo(productos);
  const codeResult = matchPorCodigo(items, porNorm, porCompact);
  const productosUsados = new Set(codeResult.matched.map((m) => m.productoId));
  const nameResult = matchPorNombre(codeResult.remaining, productosPorNombre, productosUsados);

  const matches = [...codeResult.matched, ...nameResult.matched];
  const sinMatch = nameResult.remaining;

  return {
    matches,
    sinMatch,
    resumen: {
      total: items.length,
      seguros: matches.length,
      sin_match: sinMatch.length,
    },
  };
}
