import { PromocionTipo } from '../enums/promocion-tipo.enum';
import type {
  ProductoPromocionTarget,
  PromocionPayload,
  RangoVolumen,
} from '../types/promocion-motor.types';
import { esPromocionTipo } from './promocion-motor';

const MIN_CANTIDAD_COMBO = 1e-5;

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
    const hasta = hastaRaw == null || hastaRaw === '' ? null : Number(hastaRaw);
    const pct = Number(o.porcentaje);
    if (!Number.isInteger(desde) || desde < 1) return null;
    if (hasta != null && (!Number.isInteger(hasta) || hasta < desde)) return null;
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

function cantidadComboLineaParseada(c: unknown): number | null {
  const n = Number(c);
  if (!Number.isFinite(n) || n <= 0) return null;
  const rounded = Math.round(n * 1e6) / 1e6;
  if (!(rounded >= MIN_CANTIDAD_COMBO)) return null;
  return rounded;
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

export function validarCuerpoPromocion(
  body: unknown,
):
  | { ok: true; data: PromocionPayload }
  | { ok: false; error: string; status: number } {
  if (body == null || typeof body !== 'object') {
    return { ok: false, error: 'Cuerpo inv├ílido', status: 400 };
  }
  const b = body as Record<string, unknown>;

  const nombre = String(b.nombre ?? '').trim();
  if (nombre.length < 3 || nombre.length > 100) {
    return { ok: false, error: 'El nombre debe tener entre 3 y 100 caracteres', status: 400 };
  }

  if (!esPromocionTipo(String(b.tipo ?? ''))) {
    return { ok: false, error: 'Tipo de promoci├│n inv├ílido', status: 400 };
  }
  const tipo = b.tipo as PromocionTipo;

  const siempreVigente = b.siempre_vigente === true || b.siempreVigente === true;
  const vigente_desde = siempreVigente ? null : parseYmd(b.vigente_desde ?? b.vigenteDesde);
  const vigente_hasta = siempreVigente ? null : parseYmd(b.vigente_hasta ?? b.vigenteHasta);
  if (!siempreVigente) {
    const rawDesde = b.vigente_desde ?? b.vigenteDesde;
    const rawHasta = b.vigente_hasta ?? b.vigenteHasta;
    if (rawDesde != null && rawDesde !== '' && vigente_desde == null) {
      return { ok: false, error: 'vigente_desde debe ser YYYY-MM-DD', status: 400 };
    }
    if (rawHasta != null && rawHasta !== '' && vigente_hasta == null) {
      return { ok: false, error: 'vigente_hasta debe ser YYYY-MM-DD', status: 400 };
    }
    if (vigente_desde != null && vigente_hasta != null && vigente_hasta < vigente_desde) {
      return { ok: false, error: 'La vigencia hasta no puede ser anterior al desde', status: 400 };
    }
  }

  const dias_semana = parseDiasSemana(b.dias_semana ?? b.diasSemana);
  const rawDias = b.dias_semana ?? b.diasSemana;
  if (rawDias != null && dias_semana == null) {
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
  let combo_items: {
    producto_id: string;
    producto_variante_id?: string | null;
    cantidad: number;
  }[] | null = null;
  let producto_ids: string[] = [];
  let producto_targets: ProductoPromocionTarget[] = [];

  if (tipo === PromocionTipo.porcentaje_off) {
    const p = Number(b.porcentaje);
    if (!Number.isFinite(p) || p <= 0 || p > 100) {
      return { ok: false, error: 'porcentaje debe estar entre 0 y 100', status: 400 };
    }
    porcentaje = Math.round(p * 100) / 100;
    producto_ids = parseProductoIds(b.producto_ids ?? b.productoIds);
    producto_targets = parseProductoTargets(b.producto_targets ?? b.productoTargets, producto_ids);
  } else if (tipo === PromocionTipo.n_x_m) {
    const lleva = Number(b.cantidad_lleva ?? b.cantidadLleva);
    const paga = Number(b.cantidad_paga ?? b.cantidadPaga);
    if (!Number.isInteger(lleva) || !Number.isInteger(paga) || lleva <= paga || paga < 1) {
      return {
        ok: false,
        error: 'n_x_m requiere cantidad_lleva y cantidad_paga enteros con lleva > paga ÔëÑ 1',
        status: 400,
      };
    }
    cantidad_lleva = lleva;
    cantidad_paga = paga;
    producto_ids = parseProductoIds(b.producto_ids ?? b.productoIds);
    producto_targets = parseProductoTargets(b.producto_targets ?? b.productoTargets, producto_ids);
  } else if (tipo === PromocionTipo.porcentaje_unidad_n) {
    const u = Number(b.unidad_descuento ?? b.unidadDescuento);
    const p = Number(b.porcentaje);
    if (!Number.isInteger(u) || u < 2) {
      return { ok: false, error: 'unidad_descuento debe ser un entero ÔëÑ 2', status: 400 };
    }
    if (!Number.isFinite(p) || p <= 0 || p > 100) {
      return { ok: false, error: 'porcentaje debe estar entre 0 y 100', status: 400 };
    }
    unidad_descuento = u;
    porcentaje = Math.round(p * 100) / 100;
    producto_ids = parseProductoIds(b.producto_ids ?? b.productoIds);
    producto_targets = parseProductoTargets(b.producto_targets ?? b.productoTargets, producto_ids);
  } else if (tipo === PromocionTipo.descuento_volumen) {
    const rawRangos = b.rangos_volumen ?? b.rangosVolumen;
    const explicitRanges = rawRangos != null && Array.isArray(rawRangos) && rawRangos.length > 0;
    const rangosParsed = validarRangosVolumenInput(rawRangos);
    if (explicitRanges) {
      if (rangosParsed == null) {
        return {
          ok: false,
          error:
            'rangos_volumen inv├ílido: revis├í cantidades (sin solapar tramos, un solo tramo abierto al final)',
          status: 400,
        };
      }
      rangos_volumen = rangosParsed;
    } else {
      const min = Number(b.cantidad_minima ?? b.cantidadMinima);
      const p = Number(b.porcentaje);
      if (!Number.isInteger(min) || min < 2) {
        return { ok: false, error: 'cantidad_minima debe ser un entero ÔëÑ 2', status: 400 };
      }
      if (!Number.isFinite(p) || p <= 0 || p > 100) {
        return { ok: false, error: 'porcentaje debe estar entre 0 y 100', status: 400 };
      }
      cantidad_minima = min;
      porcentaje = Math.round(p * 100) / 100;
    }
    producto_ids = parseProductoIds(b.producto_ids ?? b.productoIds);
    producto_targets = parseProductoTargets(b.producto_targets ?? b.productoTargets, producto_ids);
  } else if (tipo === PromocionTipo.combo_precio_fijo) {
    const pc = Number(b.precio_combo ?? b.precioCombo);
    if (!Number.isFinite(pc) || pc <= 0) {
      return { ok: false, error: 'precio_combo debe ser mayor a 0', status: 400 };
    }
    const items = validarComboItemsInput(b.combo_items ?? b.comboItems);
    if (items == null) {
      return {
        ok: false,
        error:
          'combo_items inv├ílido: array no vac├¡o, cada ├¡tem necesita producto_id y cantidad num├®rica mayor a 0',
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
  const sucursal_ids = parseSucursalIdsInput(b.sucursal_ids ?? b.sucursalIds);
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

export function promocionEntityFromPayload(
  tenantId: string,
  sucursalId: string,
  d: PromocionPayload,
  activa = true,
) {
  return {
    tenantId,
    sucursalId,
    nombre: d.nombre,
    tipo: d.tipo,
    cantidadLleva: d.cantidad_lleva,
    cantidadPaga: d.cantidad_paga,
    unidadDescuento: d.unidad_descuento,
    porcentaje: d.porcentaje != null ? d.porcentaje.toFixed(2) : null,
    cantidadMinima: d.cantidad_minima,
    rangosVolumen:
      d.rangos_volumen != null && d.rangos_volumen.length > 0 ? d.rangos_volumen : null,
    precioCombo: d.precio_combo != null ? d.precio_combo.toFixed(2) : null,
    vigenteDesde: d.vigente_desde,
    vigenteHasta: d.vigente_hasta,
    diasSemana: d.dias_semana,
    activa,
  };
}
