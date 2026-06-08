export type VentasPosParsedFilters = {
  cajaQuery?: string;
  operadorQuery?: string;
};

export type VentasPosResolvedFilters = {
  cajaId?: string;
  usuarioId?: string;
  cajaLabel?: string;
  operadorLabel?: string;
};

type CajaRow = { id: string; nombre: string; numero: number | null };
type UsuarioRow = { id: string; nombre: string; apellido: string | null };

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function cleanFilterEntity(value: string): string {
  let text = value.replace(/^["']|["']$/g, '').trim();
  text = text.replace(
    /\s+(?:hoy|ayer|esta\s+semana|semana|mes\s+anterior|mes\s+pasado|este\s+mes|del\s+mes|en\s+el\s+mes)\s*$/i,
    '',
  );
  return text.trim();
}

export function parseVentasPosReportFilters(rawText: string): VentasPosParsedFilters | null {
  const text = rawText.trim();
  const patterns: Array<{ re: RegExp; slot: 'caja' | 'operador' }> = [
    {
      re: /(?:ventas?|tickets?)\s+pos\s+(?:de\s+la\s+)?caja\s+(.+)$/i,
      slot: 'caja',
    },
    {
      re: /(?:ventas?|tickets?)\s+pos\s+(?:del?\s+)?(?:operador|cajero|vendedor)\s+(.+)$/i,
      slot: 'operador',
    },
    {
      re: /(?:ventas?|tickets?)\s+pos\s+.+?\s+caja\s+(.+)$/i,
      slot: 'caja',
    },
    {
      re: /(?:ventas?|tickets?)\s+pos\s+.+?\s+(?:operador|cajero|vendedor)\s+(.+)$/i,
      slot: 'operador',
    },
    {
      re: /(?:tickets?|ventas?)\s+(?:pos\s+)?(?:de\s+la\s+)?caja\s+(.+)$/i,
      slot: 'caja',
    },
    {
      re: /(?:tickets?|ventas?)\s+(?:pos\s+)?(?:del?\s+)?(?:operador|cajero|vendedor)\s+(.+)$/i,
      slot: 'operador',
    },
  ];

  let cajaQuery: string | undefined;
  let operadorQuery: string | undefined;

  for (const { re, slot } of patterns) {
    const match = text.match(re);
    if (!match?.[1]) continue;
    const entity = cleanFilterEntity(match[1]);
    if (!entity) continue;
    if (slot === 'caja') cajaQuery = entity;
    else operadorQuery = entity;
  }

  if (!cajaQuery && !operadorQuery) return null;
  return { cajaQuery, operadorQuery };
}

function formatCajaLabel(row: CajaRow): string {
  const numero = row.numero != null ? String(row.numero).padStart(2, '0') : '';
  return numero ? `${numero} — ${row.nombre}` : row.nombre;
}

function formatOperadorLabel(row: UsuarioRow): string {
  return `${row.nombre} ${row.apellido ?? ''}`.trim();
}

async function resolveCajaQuery(
  db: any,
  tenantId: string,
  query: string,
): Promise<
  | { kind: 'ok'; id: string; label: string }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; options: string[] }
> {
  const { data, error } = await db
    .from('caja')
    .select('id, nombre, numero, activa')
    .eq('tenant_id', tenantId)
    .eq('activa', true)
    .limit(20);
  if (error) throw new Error(error.message);

  const cajas = (data ?? []) as CajaRow[];
  const needle = normalizeText(query);
  const numericOnly = /^\d{1,3}$/.test(needle);

  const matches = cajas.filter((c) => {
    if (numericOnly && String(c.numero ?? '') === needle) return true;
    const nombre = normalizeText(c.nombre);
    return nombre.includes(needle) || needle.includes(nombre);
  });

  if (matches.length === 0) return { kind: 'not_found' };
  if (matches.length > 1) {
    return {
      kind: 'ambiguous',
      options: matches.map((c) => formatCajaLabel(c)),
    };
  }
  const caja = matches[0];
  return { kind: 'ok', id: caja.id, label: formatCajaLabel(caja) };
}

async function resolveOperadorQuery(
  db: any,
  tenantId: string,
  query: string,
): Promise<
  | { kind: 'ok'; id: string; label: string }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; options: string[] }
> {
  const like = query.replace(/[%_,]/g, ' ').trim();
  const firstToken = like.split(/\s+/).filter(Boolean)[0] ?? like;
  const { data, error } = await db
    .from('usuario')
    .select('id, nombre, apellido')
    .eq('tenant_id', tenantId)
    .or(`nombre.ilike.%${firstToken}%,apellido.ilike.%${firstToken}%`)
    .limit(20);
  if (error) throw new Error(error.message);

  const usuarios = (data ?? []) as UsuarioRow[];
  const needle = normalizeText(like);
  const nameParts = needle.split(/\s+/).filter(Boolean);

  let matches = usuarios.filter((u) => {
    const full = normalizeText(formatOperadorLabel(u));
    return full.includes(needle) || needle.includes(full);
  });

  if (matches.length === 0 && nameParts.length >= 2) {
    const first = nameParts[0];
    const last = nameParts[nameParts.length - 1];
    matches = usuarios.filter((u) => {
      const nombre = normalizeText(u.nombre);
      const apellido = normalizeText(u.apellido ?? '');
      return nombre.includes(first) && apellido.includes(last);
    });
  }

  const pool = matches.length > 0 ? matches : usuarios;
  if (pool.length === 0) return { kind: 'not_found' };
  if (pool.length > 1) {
    return {
      kind: 'ambiguous',
      options: pool.map((u) => formatOperadorLabel(u)),
    };
  }
  const usuario = pool[0];
  return { kind: 'ok', id: usuario.id, label: formatOperadorLabel(usuario) };
}

export async function resolveVentasPosReportFilters(
  db: any,
  tenantId: string,
  parsed: VentasPosParsedFilters,
): Promise<
  | { ok: true; filters: VentasPosResolvedFilters }
  | { ok: false; reply: string; fallbackReason: string }
> {
  const filters: VentasPosResolvedFilters = {};

  if (parsed.cajaQuery) {
    const caja = await resolveCajaQuery(db, tenantId, parsed.cajaQuery);
    if (caja.kind === 'not_found') {
      return {
        ok: false,
        reply: `No encontré una caja con “${parsed.cajaQuery}”. Probá con el nombre o el número (ej: caja 2).`,
        fallbackReason: 'ventas_pos_caja_not_found',
      };
    }
    if (caja.kind === 'ambiguous') {
      return {
        ok: false,
        reply: [
          `Hay varias cajas que coinciden con “${parsed.cajaQuery}”:`,
          ...caja.options.map((o, i) => `${i + 1}) ${o}`),
          'Decime el número de caja o el nombre exacto.',
        ].join('\n'),
        fallbackReason: 'ventas_pos_caja_ambiguous',
      };
    }
    filters.cajaId = caja.id;
    filters.cajaLabel = caja.label;
  }

  if (parsed.operadorQuery) {
    const operador = await resolveOperadorQuery(db, tenantId, parsed.operadorQuery);
    if (operador.kind === 'not_found') {
      return {
        ok: false,
        reply: `No encontré un operador/cajero con “${parsed.operadorQuery}”.`,
        fallbackReason: 'ventas_pos_operador_not_found',
      };
    }
    if (operador.kind === 'ambiguous') {
      return {
        ok: false,
        reply: [
          `Hay varios operadores que coinciden con “${parsed.operadorQuery}”:`,
          ...operador.options.map((o, i) => `${i + 1}) ${o}`),
          'Decime el nombre completo.',
        ].join('\n'),
        fallbackReason: 'ventas_pos_operador_ambiguous',
      };
    }
    filters.usuarioId = operador.id;
    filters.operadorLabel = operador.label;
  }

  return { ok: true, filters };
}
