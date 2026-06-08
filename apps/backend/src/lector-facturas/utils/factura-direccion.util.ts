import type { Repository } from 'typeorm';

import { Cliente } from '../../catalog/entities/cliente.entity';
import { Proveedor } from '../../catalog/entities/proveedor.entity';

export interface DireccionResultado {
  direccion: 'recibida' | 'emitida' | 'desconocida';
  proveedor_id: string | null;
  cliente_id: string | null;
  crear_proveedor: { razon_social: string; cuit: string } | null;
  crear_cliente: { razon_social: string; cuit_dni: string } | null;
}

type ProveedorDireccionRow = { id: string; cuit: string | null; nombre: string | null };

const PROVEEDOR_NOMBRE_SIMILAR_MIN_SCORE = 0.78;
const PROVEEDOR_NOMBRE_SIMILAR_MIN_GAP = 0.08;

const STOPWORDS_RAZON_SOCIAL = new Set([
  'a',
  'anonima',
  'arg',
  'argentina',
  'cia',
  'compania',
  'de',
  'del',
  'e',
  'el',
  'hno',
  'hnos',
  'la',
  'las',
  'limitada',
  'los',
  'responsabilidad',
  's',
  'sa',
  'saci',
  'sacif',
  'sacifi',
  'sas',
  'sc',
  'sociedad',
  'srl',
  'y',
]);

export function normCuit(c: string | null | undefined): string | null {
  const d = c?.replace(/\D/g, '') ?? '';
  return d.length === 11 ? d : null;
}

function tokensRazonSocial(nombre: string | null | undefined): string[] {
  return (nombre ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS_RAZON_SOCIAL.has(t));
}

function bigramas(s: string): Set<string> {
  const compact = s.replace(/\s+/g, '');
  if (compact.length <= 1) return new Set(compact ? [compact] : []);
  const out = new Set<string>();
  for (let i = 0; i < compact.length - 1; i++) out.add(compact.slice(i, i + 2));
  return out;
}

function diceBigramas(a: string, b: string): number {
  const aa = bigramas(a);
  const bb = bigramas(b);
  if (aa.size === 0 || bb.size === 0) return 0;
  let inter = 0;
  for (const x of aa) {
    if (bb.has(x)) inter++;
  }
  return (2 * inter) / (aa.size + bb.size);
}

export function scoreNombreProveedorSimilar(a: string | null | undefined, b: string | null | undefined): number {
  const ta = tokensRazonSocial(a);
  const tb = tokensRazonSocial(b);
  if (ta.length === 0 || tb.length === 0) return 0;

  const sa = new Set(ta);
  const sb = new Set(tb);
  let inter = 0;
  for (const t of sa) {
    if (sb.has(t)) inter++;
  }

  const minTokens = Math.min(sa.size, sb.size);
  const union = new Set([...sa, ...sb]).size;
  const jaccard = union > 0 ? inter / union : 0;
  const containment = minTokens > 0 ? inter / minTokens : 0;
  const compactA = ta.join('');
  const compactB = tb.join('');
  const dice = diceBigramas(compactA, compactB);

  if (compactA === compactB) return 1;
  if (minTokens >= 2 && containment >= 0.8) {
    return 0.88 * containment + 0.12 * dice;
  }
  return 0.68 * jaccard + 0.32 * dice;
}

export function findProveedorPorCuitNorm(
  rows: { id: string; cuit: string | null }[],
  cuitNorm: string | null,
): { id: string } | null {
  if (!cuitNorm) return null;
  for (const p of rows) {
    if (normCuit(p.cuit) === cuitNorm) return p;
  }
  return null;
}

export function findProveedorPorNombreSimilar(
  rows: ProveedorDireccionRow[],
  razonSocial: string | null | undefined,
): { id: string; nombre: string | null; score: number } | null {
  const candidatos = rows
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      score: scoreNombreProveedorSimilar(razonSocial, p.nombre),
    }))
    .filter((p) => p.score >= PROVEEDOR_NOMBRE_SIMILAR_MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  const top = candidatos[0];
  if (!top) return null;
  const segundo = candidatos[1];
  if (
    segundo &&
    top.score < 0.999 &&
    top.score - segundo.score < PROVEEDOR_NOMBRE_SIMILAR_MIN_GAP
  ) {
    return null;
  }
  return top;
}

function findClientePorCuitNorm(
  rows: { id: string; cuitDni: string | null }[],
  cuitNorm: string | null,
): { id: string } | null {
  if (!cuitNorm) return null;
  for (const c of rows) {
    if (normCuit(c.cuitDni) === cuitNorm) return c;
  }
  return null;
}

/**
 * Determina si la factura es recibida (compra), emitida (venta) o desconocida,
 * comparando CUITs con el del tenant y con proveedores/clientes del catálogo.
 */
export async function detectarDireccion(params: {
  proveedorRepo: Repository<Proveedor>;
  clienteRepo: Repository<Cliente>;
  tenantId: string;
  tenantCuit: string | null;
  emisorCuit: string | null;
  receptorCuit: string | null;
  emisorRazonSocial: string | null;
  receptorRazonSocial: string | null;
}): Promise<DireccionResultado> {
  const {
    proveedorRepo,
    clienteRepo,
    tenantId,
    tenantCuit,
    emisorCuit,
    receptorCuit,
    emisorRazonSocial,
    receptorRazonSocial,
  } = params;

  const emisorC = normCuit(emisorCuit);
  const receptorC = normCuit(receptorCuit);
  const tenantC = normCuit(tenantCuit);

  const [proveedores, clientes] = await Promise.all([
    proveedorRepo.find({
      where: { tenantId },
      select: ['id', 'cuit', 'nombre'],
    }),
    clienteRepo.find({
      where: { tenantId, activo: true },
      select: ['id', 'cuitDni'],
    }),
  ]);

  const provRows = proveedores;
  const cliRows = clientes;

  if (tenantC && emisorC === tenantC) {
    const cli = findClientePorCuitNorm(cliRows, receptorC);
    return {
      direccion: 'emitida',
      proveedor_id: null,
      cliente_id: cli?.id ?? null,
      crear_proveedor: null,
      crear_cliente:
        cli || !receptorC || !receptorRazonSocial
          ? null
          : { razon_social: receptorRazonSocial, cuit_dni: receptorC },
    };
  }

  if (tenantC && receptorC === tenantC) {
    const prov =
      findProveedorPorCuitNorm(provRows, emisorC) ??
      findProveedorPorNombreSimilar(provRows, emisorRazonSocial);
    return {
      direccion: 'recibida',
      proveedor_id: prov?.id ?? null,
      cliente_id: null,
      crear_proveedor:
        prov || !emisorC || !emisorRazonSocial
          ? null
          : { razon_social: emisorRazonSocial, cuit: emisorC },
      crear_cliente: null,
    };
  }

  if (emisorC) {
    const prov =
      findProveedorPorCuitNorm(provRows, emisorC) ??
      findProveedorPorNombreSimilar(provRows, emisorRazonSocial);
    if (prov) {
      return {
        direccion: 'recibida',
        proveedor_id: prov.id,
        cliente_id: null,
        crear_proveedor: null,
        crear_cliente: null,
      };
    }
  }

  const provPorNombre = findProveedorPorNombreSimilar(provRows, emisorRazonSocial);
  if (provPorNombre) {
    return {
      direccion: 'recibida',
      proveedor_id: provPorNombre.id,
      cliente_id: null,
      crear_proveedor: null,
      crear_cliente: null,
    };
  }

  if (receptorC) {
    const cli = findClientePorCuitNorm(cliRows, receptorC);
    if (cli) {
      return {
        direccion: 'emitida',
        proveedor_id: null,
        cliente_id: cli.id,
        crear_proveedor: null,
        crear_cliente: null,
      };
    }
  }

  return {
    direccion: 'desconocida',
    proveedor_id: null,
    cliente_id: null,
    crear_proveedor:
      emisorC && emisorRazonSocial ? { razon_social: emisorRazonSocial, cuit: emisorC } : null,
    crear_cliente:
      receptorC && receptorRazonSocial
        ? { razon_social: receptorRazonSocial, cuit_dni: receptorC }
        : null,
  };
}
