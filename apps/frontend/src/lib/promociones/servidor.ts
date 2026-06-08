import type { SupabaseClient } from '@supabase/supabase-js';

import { promocionVigenteParaYmd } from '@/lib/facturacion/promociones';
import type { Database } from '@/types/database';
import type { PromocionMotor, PromocionTipo, RangoVolumen } from '@/types/promociones';

export type ConflictoPromoProducto = {
  producto_id: string;
  producto_variante_id?: string | null;
  sucursal_ids?: string[];
  promocion_existente: { id: string; nombre: string };
};

type ProductoPromocionTarget = {
  producto_id: string;
  producto_variante_id?: string | null;
};

type PromocionRow = Database['public']['Tables']['promocion']['Row'];

export type PromocionRowConCombo = PromocionRow & {
  promocion_combo_item?: { producto_id: string; producto_variante_id?: string | null; cantidad: number }[] | null;
};

const TIPOS: PromocionTipo[] = [
  'porcentaje_off',
  'n_x_m',
  'porcentaje_unidad_n',
  'descuento_volumen',
  'combo_precio_fijo',
];

function esTipo(v: unknown): v is PromocionTipo {
  return typeof v === 'string' && (TIPOS as string[]).includes(v);
}

export function esPromocionTipo(v: string): v is PromocionTipo {
  return (TIPOS as string[]).includes(v);
}

function parseRangosVolumenDb(raw: unknown): RangoVolumen[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: RangoVolumen[] = [];
  for (const row of raw) {
    if (row == null || typeof row !== 'object') return null;
    const o = row as Record<string, unknown>;
    const desde = Number(o.cantidad_desde);
    const hasta = o.cantidad_hasta == null ? null : Number(o.cantidad_hasta);
    const pct = Number(o.porcentaje);
    if (!Number.isFinite(desde) || !Number.isInteger(desde) || desde < 1) return null;
    if (hasta != null && (!Number.isInteger(hasta) || hasta < desde)) return null;
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
    out.push({
      cantidad_desde: desde,
      cantidad_hasta: hasta,
      porcentaje: Math.round(pct * 100) / 100,
    });
  }
  return out.length ? out : null;
}

/** Cantidades en línea de combo (misma unidad de venta que el producto): kg/ración con decimales o gramos enteros grandes. */
const MIN_CANTIDAD_COMBO = 1e-5;

function cantidadComboLineaParseada(c: unknown): number | null {
  const n = Number(c);
  if (!Number.isFinite(n) || n <= 0) return null;
  const rounded = Math.round(n * 1e6) / 1e6;
  if (!(rounded >= MIN_CANTIDAD_COMBO)) return null;
  return rounded;
}

function parseComboItemsEmbed(
  embed: unknown,
): { producto_id: string; producto_variante_id?: string | null; cantidad: number }[] | null {
  if (!Array.isArray(embed) || embed.length === 0) return null;
  const out: { producto_id: string; producto_variante_id?: string | null; cantidad: number }[] = [];
  for (const row of embed) {
    if (row == null || typeof row !== 'object') return null;
    const o = row as Record<string, unknown>;
    const pid = String(o.producto_id ?? '').trim();
    const varianteId =
      typeof o.producto_variante_id === 'string' && o.producto_variante_id.trim()
        ? o.producto_variante_id.trim()
        : null;
    const c = cantidadComboLineaParseada(o.cantidad);
    if (!pid.length || c == null) return null;
    out.push({ producto_id: pid, producto_variante_id: varianteId, cantidad: c });
  }
  return out;
}

export function filaPromocionAMotor(row: PromocionRowConCombo): PromocionMotor {
  const comboEmbed = row.promocion_combo_item;
  return {
    id: row.id,
    nombre: row.nombre,
    tipo: row.tipo,
    cantidad_lleva: row.cantidad_lleva,
    cantidad_paga: row.cantidad_paga,
    unidad_descuento: row.unidad_descuento,
    porcentaje: row.porcentaje,
    cantidad_minima: row.cantidad_minima,
    rangos_volumen: parseRangosVolumenDb(row.rangos_volumen),
    precio_combo: row.precio_combo != null ? Number(row.precio_combo) : null,
    combo_items: parseComboItemsEmbed(comboEmbed),
    vigente_desde: row.vigente_desde,
    vigente_hasta: row.vigente_hasta,
    dias_semana: row.dias_semana,
    activa: row.activa,
  };
}

/** Promo activa + vigente en `fechaYmd` (YYYY-MM-DD, ej. `hoyEnAR()`), distinta de `excluirPromocionId`. */
export async function buscarConflictosProductos(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  targets: ProductoPromocionTarget[] | string[],
  excluirPromocionId: string | null,
  sucursalIdsInput: string | string[],
  fechaYmd: string,
): Promise<ConflictoPromoProducto[]> {
  const targetList: ProductoPromocionTarget[] = targets
    .map((t) => (typeof t === 'string' ? { producto_id: t, producto_variante_id: null } : t))
    .filter((t) => t.producto_id);
  const productoIds = [...new Set(targetList.map((t) => t.producto_id))];
  if (productoIds.length === 0) return [];
  const sucursalIds = [
    ...new Set(
      (Array.isArray(sucursalIdsInput) ? sucursalIdsInput : [sucursalIdsInput])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean),
    ),
  ];
  if (sucursalIds.length === 0) return [];

  const { data: accessRows, error: accessErr } = await supabase
    .from('promocion_sucursal')
    .select('promocion_id, sucursal_id')
    .eq('tenant_id', tenantId)
    .in('sucursal_id', sucursalIds);

  if (accessErr) throw new Error(accessErr.message);

  const sucursalSet = new Set(sucursalIds);
  const accessByPromo = new Map<string, Set<string>>();
  for (const row of accessRows ?? []) {
    const set = accessByPromo.get(row.promocion_id) ?? new Set<string>();
    set.add(row.sucursal_id);
    accessByPromo.set(row.promocion_id, set);
  }
  const promoIds = [...accessByPromo.keys()];
  if (promoIds.length === 0) return [];

  const { data, error } = await supabase
    .from('producto_promocion')
    .select(
      `
      producto_id,
      producto_variante_id,
      promocion_id,
      promocion (
        id,
        nombre,
        tipo,
        activa,
        cantidad_lleva,
        cantidad_paga,
        unidad_descuento,
        porcentaje,
        cantidad_minima,
        rangos_volumen,
        precio_combo,
        vigente_desde,
        vigente_hasta,
        dias_semana
      )
    `,
    )
    .in('producto_id', productoIds)
    .in('promocion_id', promoIds)
    .eq('tenant_id', tenantId);

  if (error) throw new Error(error.message);

  const mapa = new Map<string, ConflictoPromoProducto>();
  for (const row of data ?? []) {
    const rowVarianteId = row.producto_variante_id ?? null;
    const afectaAlgunTarget = targetList.some((target) => {
      if (target.producto_id !== row.producto_id) return false;
      const targetVarianteId = target.producto_variante_id ?? null;
      return targetVarianteId == null || rowVarianteId == null || targetVarianteId === rowVarianteId;
    });
    if (!afectaAlgunTarget) continue;
    const embed = row.promocion as PromocionRowConCombo | PromocionRowConCombo[] | null;
    const p = Array.isArray(embed) ? embed[0] : embed;
    if (!p || p.id === excluirPromocionId) continue;
    if (!p.activa) continue;
    const pRaw = p as PromocionRowConCombo & { rangos_volumen?: unknown; precio_combo?: unknown };
    const motor = filaPromocionAMotor({
      ...pRaw,
      rangos_volumen: pRaw.rangos_volumen ?? null,
      precio_combo: pRaw.precio_combo ?? null,
      promocion_combo_item: null,
    });
    if (!promocionVigenteParaYmd(motor, fechaYmd)) continue;
    const branchIds = [...(accessByPromo.get(p.id) ?? new Set<string>())].filter((sid) => sucursalSet.has(sid));
    const conflictKey = `${row.producto_id}:${rowVarianteId ?? 'base'}:${p.id}`;
    if (!mapa.has(conflictKey)) {
      mapa.set(conflictKey, {
        producto_id: row.producto_id,
        producto_variante_id: rowVarianteId,
        sucursal_ids: branchIds,
        promocion_existente: { id: p.id, nombre: p.nombre },
      });
    }
  }
  return [...mapa.values()];
}

export async function quitarVinculosConflicto(
  supabase: SupabaseClient<Database>,
  conflictos: ConflictoPromoProducto[],
) {
  for (const c of conflictos) {
    let q = supabase
      .from('producto_promocion')
      .delete()
      .eq('producto_id', c.producto_id)
      .eq('promocion_id', c.promocion_existente.id);
    q = c.producto_variante_id ? q.eq('producto_variante_id', c.producto_variante_id) : q.is('producto_variante_id', null);
    const { error } = await q;
    if (error) throw new Error(error.message);
  }
}

export type PromocionInsertPayload = {
  nombre: string;
  tipo: PromocionTipo;
  cantidad_lleva: number | null;
  cantidad_paga: number | null;
  unidad_descuento: number | null;
  porcentaje: number | null;
  cantidad_minima: number | null;
  rangos_volumen: RangoVolumen[] | null;
  precio_combo: number | null;
  combo_items: { producto_id: string; producto_variante_id?: string | null; cantidad: number }[] | null;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  dias_semana: number[] | null;
  sucursal_ids: string[];
  producto_ids: string[];
  producto_targets: ProductoPromocionTarget[];
  reemplazar: boolean;
};

function parseYmd(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function parseDiasSemana(v: unknown): number[] | null {
  if (v == null) return null;
  if (!Array.isArray(v)) return null;
  const nums = v.map((x) => Number(x));
  if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > 7)) return null;
  return [...new Set(nums)].sort((a, b) => a - b);
}

function parseProductoIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function parseSucursalIdsInput(v: unknown): string[] | null {
  if (v == null) return [];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string') return null;
    const id = raw.trim();
    if (!id) return null;
    out.push(id);
  }
  return [...new Set(out)];
}

function parseProductoTargets(raw: unknown, fallbackProductoIds: string[]): ProductoPromocionTarget[] {
  if (!Array.isArray(raw)) {
    return [...new Set(fallbackProductoIds)].map((producto_id) => ({
      producto_id,
      producto_variante_id: null,
    }));
  }
  const out: ProductoPromocionTarget[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const productoId = typeof o.producto_id === 'string' ? o.producto_id.trim() : '';
    if (!productoId) continue;
    const varianteId =
      typeof o.producto_variante_id === 'string' && o.producto_variante_id.trim()
        ? o.producto_variante_id.trim()
        : null;
    out.push({ producto_id: productoId, producto_variante_id: varianteId });
  }
  return out.length > 0
    ? out
    : [...new Set(fallbackProductoIds)].map((producto_id) => ({ producto_id, producto_variante_id: null }));
}

function validarRangosVolumenInput(raw: unknown): RangoVolumen[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: RangoVolumen[] = [];
  for (const row of raw) {
    if (row == null || typeof row !== 'object') return null;
    const o = row as Record<string, unknown>;
    const desde = Number(o.cantidad_desde);
    const hastaRaw = o.cantidad_hasta;
    const hasta =
      hastaRaw == null || hastaRaw === ''
        ? null
        : Number(hastaRaw);
    const pct = Number(o.porcentaje);
    if (!Number.isInteger(desde) || desde < 1) return null;
    if (hasta != null) {
      if (!Number.isInteger(hasta) || hasta < desde) return null;
    }
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
    out.push({
      cantidad_desde: desde,
      cantidad_hasta: hasta,
      porcentaje: Math.round(pct * 100) / 100,
    });
  }
  out.sort((a, b) => a.cantidad_desde - b.cantidad_desde);
  let seenOpen = false;
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    if (seenOpen) return null;
    if (r.cantidad_hasta == null) seenOpen = true;
    if (i > 0) {
      const prev = out[i - 1];
      if (prev.cantidad_hasta == null) return null;
      if (r.cantidad_desde <= prev.cantidad_hasta) return null;
    }
  }
  return out;
}

function validarComboItemsInput(
  raw: unknown,
): { producto_id: string; producto_variante_id?: string | null; cantidad: number }[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: { producto_id: string; producto_variante_id?: string | null; cantidad: number }[] = [];
  for (const row of raw) {
    if (row == null || typeof row !== 'object') return null;
    const o = row as Record<string, unknown>;
    const pid = String(o.producto_id ?? '').trim();
    const varianteId =
      typeof o.producto_variante_id === 'string' && o.producto_variante_id.trim()
        ? o.producto_variante_id.trim()
        : null;
    const cNum = cantidadComboLineaParseada(o.cantidad);
    if (!pid.length || cNum == null) return null;
    out.push({ producto_id: pid, producto_variante_id: varianteId, cantidad: cNum });
  }
  return out;
}

export function validarCuerpoPromocion(body: unknown):
  | { ok: true; data: PromocionInsertPayload }
  | { ok: false; error: string; status: number } {
  if (body == null || typeof body !== 'object') {
    return { ok: false, error: 'Cuerpo inválido', status: 400 };
  }
  const b = body as Record<string, unknown>;

  const nombre = String(b.nombre ?? '').trim();
  if (nombre.length < 3 || nombre.length > 100) {
    return { ok: false, error: 'El nombre debe tener entre 3 y 100 caracteres', status: 400 };
  }

  if (!esTipo(b.tipo)) {
    return { ok: false, error: 'Tipo de promoción inválido', status: 400 };
  }
  const tipo = b.tipo;

  const siempreVigente = b.siempre_vigente === true;
  const vigente_desde = siempreVigente ? null : parseYmd(b.vigente_desde);
  const vigente_hasta = siempreVigente ? null : parseYmd(b.vigente_hasta);
  if (!siempreVigente) {
    if (b.vigente_desde != null && b.vigente_desde !== '' && vigente_desde == null) {
      return { ok: false, error: 'vigente_desde debe ser YYYY-MM-DD', status: 400 };
    }
    if (b.vigente_hasta != null && b.vigente_hasta !== '' && vigente_hasta == null) {
      return { ok: false, error: 'vigente_hasta debe ser YYYY-MM-DD', status: 400 };
    }
    if (
      vigente_desde != null &&
      vigente_hasta != null &&
      vigente_hasta < vigente_desde
    ) {
      return { ok: false, error: 'La vigencia hasta no puede ser anterior al desde', status: 400 };
    }
  }

  const dias_semana = parseDiasSemana(b.dias_semana);
  if (b.dias_semana != null && dias_semana == null) {
    return {
      ok: false,
      error: 'dias_semana debe ser un array de enteros entre 1 (lun) y 7 (dom)',
      status: 400,
    };
  }

  let cantidad_lleva: number | null = null;
  let cantidad_paga: number | null = null;
  let unidad_descuento: number | null = null;
  let porcentaje: number | null = null;
  let cantidad_minima: number | null = null;
  let rangos_volumen: RangoVolumen[] | null = null;
  let precio_combo: number | null = null;
  let combo_items: { producto_id: string; producto_variante_id?: string | null; cantidad: number }[] | null = null;
  let producto_ids: string[] = [];
  let producto_targets: ProductoPromocionTarget[] = [];

  if (tipo === 'porcentaje_off') {
    const p = Number(b.porcentaje);
    if (!Number.isFinite(p) || p <= 0 || p > 100) {
      return { ok: false, error: 'porcentaje debe estar entre 0 y 100', status: 400 };
    }
    porcentaje = Math.round(p * 100) / 100;
    producto_ids = parseProductoIds(b.producto_ids);
    producto_targets = parseProductoTargets(b.producto_targets, producto_ids);
  } else if (tipo === 'n_x_m') {
    const lleva = Number(b.cantidad_lleva);
    const paga = Number(b.cantidad_paga);
    if (!Number.isInteger(lleva) || !Number.isInteger(paga) || lleva <= paga || paga < 1) {
      return {
        ok: false,
        error: 'n_x_m requiere cantidad_lleva y cantidad_paga enteros con lleva > paga ≥ 1',
        status: 400,
      };
    }
    cantidad_lleva = lleva;
    cantidad_paga = paga;
    producto_ids = parseProductoIds(b.producto_ids);
    producto_targets = parseProductoTargets(b.producto_targets, producto_ids);
  } else if (tipo === 'porcentaje_unidad_n') {
    const u = Number(b.unidad_descuento);
    const p = Number(b.porcentaje);
    if (!Number.isInteger(u) || u < 2) {
      return { ok: false, error: 'unidad_descuento debe ser un entero ≥ 2', status: 400 };
    }
    if (!Number.isFinite(p) || p <= 0 || p > 100) {
      return { ok: false, error: 'porcentaje debe estar entre 0 y 100', status: 400 };
    }
    unidad_descuento = u;
    porcentaje = Math.round(p * 100) / 100;
    producto_ids = parseProductoIds(b.producto_ids);
    producto_targets = parseProductoTargets(b.producto_targets, producto_ids);
  } else if (tipo === 'descuento_volumen') {
    const explicitRanges =
      b.rangos_volumen != null &&
      Array.isArray(b.rangos_volumen) &&
      b.rangos_volumen.length > 0;
    const rangosParsed = validarRangosVolumenInput(b.rangos_volumen);
    if (explicitRanges) {
      if (rangosParsed == null) {
        return {
          ok: false,
          error:
            'rangos_volumen inválido: revisá cantidades (sin solapar tramos, un solo tramo abierto al final)',
          status: 400,
        };
      }
      rangos_volumen = rangosParsed;
    } else {
      const min = Number(b.cantidad_minima);
      const p = Number(b.porcentaje);
      if (!Number.isInteger(min) || min < 2) {
        return { ok: false, error: 'cantidad_minima debe ser un entero ≥ 2', status: 400 };
      }
      if (!Number.isFinite(p) || p <= 0 || p > 100) {
        return { ok: false, error: 'porcentaje debe estar entre 0 y 100', status: 400 };
      }
      cantidad_minima = min;
      porcentaje = Math.round(p * 100) / 100;
    }
    producto_ids = parseProductoIds(b.producto_ids);
    producto_targets = parseProductoTargets(b.producto_targets, producto_ids);
  } else if (tipo === 'combo_precio_fijo') {
    const pc = Number(b.precio_combo);
    if (!Number.isFinite(pc) || pc <= 0) {
      return { ok: false, error: 'precio_combo debe ser mayor a 0', status: 400 };
    }
    const items = validarComboItemsInput(b.combo_items);
    if (items == null) {
      return {
        ok: false,
        error:
          'combo_items inválido: array no vacío, cada ítem necesita producto_id y cantidad numérica mayor a 0',
        status: 400,
      };
    }
    precio_combo = Math.round(pc * 100) / 100;
    combo_items = items;
    producto_ids = [...new Set(items.map((i) => i.producto_id))];
    producto_targets = items.map((i) => ({
      producto_id: i.producto_id,
      producto_variante_id: i.producto_variante_id ?? null,
    }));
  }

  const reemplazar = b.reemplazar === true;
  const sucursal_ids = parseSucursalIdsInput(b.sucursal_ids);
  if (sucursal_ids == null) {
    return { ok: false, error: 'sucursal_ids debe ser un array de IDs de sucursal', status: 400 };
  }

  return {
    ok: true,
    data: {
      nombre,
      tipo,
      cantidad_lleva,
      cantidad_paga,
      unidad_descuento,
      porcentaje,
      cantidad_minima,
      rangos_volumen,
      precio_combo,
      combo_items,
      vigente_desde,
      vigente_hasta,
      dias_semana,
      sucursal_ids,
      producto_ids,
      producto_targets,
      reemplazar,
    },
  };
}

export function filaInsertDesdeValidado(
  tenantId: string,
  sucursalId: string,
  d: PromocionInsertPayload,
): Database['public']['Tables']['promocion']['Insert'] {
  return {
    tenant_id: tenantId,
    sucursal_id: sucursalId,
    nombre: d.nombre,
    tipo: d.tipo,
    cantidad_lleva: d.cantidad_lleva,
    cantidad_paga: d.cantidad_paga,
    unidad_descuento: d.unidad_descuento,
    porcentaje: d.porcentaje,
    cantidad_minima: d.cantidad_minima,
    rangos_volumen: d.rangos_volumen != null && d.rangos_volumen.length > 0 ? d.rangos_volumen : null,
    precio_combo: d.precio_combo,
    vigente_desde: d.vigente_desde,
    vigente_hasta: d.vigente_hasta,
    dias_semana: d.dias_semana,
    activa: true,
  };
}

export function filaUpdateDesdeValidado(
  d: PromocionInsertPayload,
): Database['public']['Tables']['promocion']['Update'] {
  return {
    nombre: d.nombre,
    tipo: d.tipo,
    cantidad_lleva: d.cantidad_lleva,
    cantidad_paga: d.cantidad_paga,
    unidad_descuento: d.unidad_descuento,
    porcentaje: d.porcentaje,
    cantidad_minima: d.cantidad_minima,
    rangos_volumen: d.rangos_volumen != null && d.rangos_volumen.length > 0 ? d.rangos_volumen : null,
    precio_combo: d.precio_combo,
    vigente_desde: d.vigente_desde,
    vigente_hasta: d.vigente_hasta,
    dias_semana: d.dias_semana,
  };
}

export async function sincronizarPromocionComboItems(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  promocionId: string,
  tipo: PromocionTipo,
  comboItems: { producto_id: string; producto_variante_id?: string | null; cantidad: number }[] | null,
) {
  const { error: delErr } = await supabase
    .from('promocion_combo_item')
    .delete()
    .eq('promocion_id', promocionId);
  if (delErr) throw new Error(delErr.message);

  if (tipo !== 'combo_precio_fijo' || !comboItems?.length) return;

  const rows = comboItems.map((ci) => ({
    tenant_id: tenantId,
    promocion_id: promocionId,
    producto_id: ci.producto_id,
    producto_variante_id: ci.producto_variante_id ?? null,
    cantidad: ci.cantidad,
  }));
  const { error: insErr } = await supabase.from('promocion_combo_item').insert(rows);
  if (insErr) throw new Error(insErr.message);
}

export async function sincronizarPromocionSucursales(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  promocionId: string,
  sucursalIds: string[],
) {
  const { error: delErr } = await supabase
    .from('promocion_sucursal')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('promocion_id', promocionId);
  if (delErr) throw new Error(delErr.message);

  const ids = [...new Set(sucursalIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return;

  const rows = ids.map((sucursalId) => ({
    tenant_id: tenantId,
    promocion_id: promocionId,
    sucursal_id: sucursalId,
  }));
  const { error: insErr } = await supabase.from('promocion_sucursal').insert(rows);
  if (insErr) throw new Error(insErr.message);
}
