import { normalizarString } from '../../analyzer/price-lists/utils/lista-matching.util';

/** Respuesta cruda esperada de Gemini (subset validado en runtime). */
export interface FacturaGeminiItem {
  codigo: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  precio_unitario: number;
  bonificacion: number | null;
  subtotal: number;
}

export interface FacturaGeminiPayload {
  tipo_comprobante: string;
  letra: string | null;
  punto_venta: number | null;
  numero: number | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  emisor: {
    razon_social: string | null;
    cuit: string | null;
    domicilio: string | null;
    condicion_iva: string | null;
    ingresos_brutos: string | null;
    inicio_actividades: string | null;
  };
  receptor: {
    razon_social: string | null;
    cuit_dni: string | null;
    domicilio: string | null;
    condicion_iva: string | null;
  };
  items: FacturaGeminiItem[];
  subtotal: number | null;
  iva_21: number | null;
  iva_10_5: number | null;
  iva_27: number | null;
  percepcion_iibb: number | null;
  percepcion_iva: number | null;
  impuesto_interno: number | null;
  otros_impuestos: number | null;
  total: number | null;
  condicion_pago: string | null;
  cae: string | null;
  cae_vencimiento: string | null;
  observaciones: string | null;
}

const TOLERANCIA_TOTALES = 1.01;
const TOLERANCIA_ITEMS_RELATIVA = 0.01;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseNumeroFactura(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s) return null;

  s = s
    .replace(/\$/g, '')
    .replace(/\s+/g, '')
    .replace(/[^\d.,+-]/g, '');
  if (!s || s === '-' || s === '+') return null;

  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    const dots = (s.match(/\./g) ?? []).length;
    if (dots > 1) {
      const lastDot = s.lastIndexOf('.');
      const dec = s.slice(lastDot + 1);
      s = dec.length === 2
        ? `${s.slice(0, lastDot).replace(/\./g, '')}.${dec}`
        : s.replace(/\./g, '');
    } else if (/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseEnteroFactura(v: unknown): number | null {
  const n = parseNumeroFactura(v);
  if (n == null) return null;
  return Math.trunc(n);
}

function precioUnitarioEfectivo(
  cantidad: number,
  precioUnitario: number,
  subtotal: number,
): number {
  if (!(cantidad > 0) || !(subtotal >= 0) || !(precioUnitario > 0)) return precioUnitario;
  const esperado = round2(cantidad * precioUnitario);
  const tolerancia = Math.max(TOLERANCIA_TOTALES, Math.abs(subtotal) * 0.002);
  if (Math.abs(esperado - subtotal) <= tolerancia) return precioUnitario;

  const desdeSubtotal = round2(subtotal / cantidad);
  return Number.isFinite(desdeSubtotal) && desdeSubtotal >= 0 ? desdeSubtotal : precioUnitario;
}

function repararJsonComun(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/,\s*,+/g, ',')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

function parseJsonConTolerancia(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return JSON.parse(repararJsonComun(text)) as unknown;
  }
}

function extraerObjetosJsonBalanceados(raw: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

export function parsearJsonFacturaGemini(raw: string): FacturaGeminiPayload {
  let parsed: unknown;
  try {
    parsed = parseJsonConTolerancia(raw);
  } catch {
    const candidates = extraerObjetosJsonBalanceados(raw);
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        parsed = parseJsonConTolerancia(candidate);
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (parsed == null) throw lastError instanceof Error ? lastError : new Error('JSON inválido');
  }

  if (!parsed || typeof parsed !== 'object') throw new Error('JSON inválido');

  const o = parsed as Record<string, unknown>;
  if (o.tipo_comprobante === 'desconocido') {
    return {
      tipo_comprobante: 'desconocido',
      letra: null,
      punto_venta: null,
      numero: null,
      fecha_emision: null,
      fecha_vencimiento: null,
      emisor: {
        razon_social: null,
        cuit: null,
        domicilio: null,
        condicion_iva: null,
        ingresos_brutos: null,
        inicio_actividades: null,
      },
      receptor: {
        razon_social: null,
        cuit_dni: null,
        domicilio: null,
        condicion_iva: null,
      },
      items: [],
      subtotal: null,
      iva_21: null,
      iva_10_5: null,
      iva_27: null,
      percepcion_iibb: null,
      percepcion_iva: null,
      impuesto_interno: null,
      otros_impuestos: null,
      total: null,
      condicion_pago: null,
      cae: null,
      cae_vencimiento: null,
      observaciones: null,
    };
  }

  const itemsIn = Array.isArray(o.items) ? o.items : [];
  const items: FacturaGeminiItem[] = [];

  for (let i = 0; i < itemsIn.length; i++) {
    const row = itemsIn[i];
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const descripcion =
      typeof r.descripcion === 'string' ? r.descripcion.trim() : String(r.descripcion ?? '').trim();
    if (!descripcion) continue;

    const cantidad = parseNumeroFactura(r.cantidad) ?? 0;
    let precio_unitario = parseNumeroFactura(r.precio_unitario) ?? 0;
    const subtotalBase = parseNumeroFactura(r.subtotal);
    const subtotal = round2(subtotalBase ?? cantidad * precio_unitario);
    precio_unitario = precioUnitarioEfectivo(cantidad, precio_unitario, subtotal);

    items.push({
      codigo: r.codigo != null ? String(r.codigo).trim() || null : null,
      descripcion,
      cantidad,
      unidad: r.unidad != null ? String(r.unidad).trim() || null : null,
      precio_unitario,
      bonificacion: parseNumeroFactura(r.bonificacion),
      subtotal,
    });
  }

  const em = (o.emisor && typeof o.emisor === 'object' ? o.emisor : {}) as Record<string, unknown>;
  const rec = (o.receptor && typeof o.receptor === 'object' ? o.receptor : {}) as Record<string, unknown>;

  const digits = (v: unknown) => (v != null ? String(v).replace(/\D/g, '') : '');
  const cuit11 = (v: unknown) => {
    const d = digits(v);
    return d.length === 11 ? d : null;
  };
  const cuitParaMostrar = (v: unknown) => cuit11(v) ?? (digits(v) || null);
  const strOmitVacio = (v: unknown) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s || null;
  };

  return {
    tipo_comprobante: typeof o.tipo_comprobante === 'string' ? o.tipo_comprobante : 'desconocido',
    letra: o.letra != null ? String(o.letra).trim().slice(0, 1).toUpperCase() : null,
    punto_venta: parseEnteroFactura(o.punto_venta),
    numero: parseEnteroFactura(o.numero),
    fecha_emision: o.fecha_emision != null ? String(o.fecha_emision) : null,
    fecha_vencimiento: o.fecha_vencimiento != null ? String(o.fecha_vencimiento) : null,
    emisor: {
      razon_social: strOmitVacio(em.razon_social),
      cuit: cuitParaMostrar(em.cuit),
      domicilio: strOmitVacio(em.domicilio),
      condicion_iva: strOmitVacio(em.condicion_iva),
      ingresos_brutos: strOmitVacio(em.ingresos_brutos),
      inicio_actividades: strOmitVacio(em.inicio_actividades),
    },
    receptor: {
      razon_social: strOmitVacio(rec.razon_social),
      cuit_dni: cuitParaMostrar(rec.cuit_dni),
      domicilio: strOmitVacio(rec.domicilio),
      condicion_iva: strOmitVacio(rec.condicion_iva),
    },
    items,
    subtotal: parseNumeroFactura(o.subtotal),
    iva_21: parseNumeroFactura(o.iva_21),
    iva_10_5: parseNumeroFactura(o.iva_10_5),
    iva_27: parseNumeroFactura(o.iva_27),
    percepcion_iibb: parseNumeroFactura(o.percepcion_iibb),
    percepcion_iva: parseNumeroFactura(o.percepcion_iva),
    impuesto_interno:
      parseNumeroFactura(o.impuesto_interno) ??
      parseNumeroFactura(o.impuestos_internos) ??
      parseNumeroFactura(o.imp_interno),
    otros_impuestos: parseNumeroFactura(o.otros_impuestos),
    total: parseNumeroFactura(o.total),
    condicion_pago: o.condicion_pago != null ? String(o.condicion_pago) : null,
    cae: o.cae != null ? String(o.cae) : null,
    cae_vencimiento: o.cae_vencimiento != null ? String(o.cae_vencimiento) : null,
    observaciones: o.observaciones != null ? String(o.observaciones) : null,
  };
}

function toleranciaMonto(monto: number): number {
  return Math.max(TOLERANCIA_TOTALES, Math.abs(monto) * TOLERANCIA_ITEMS_RELATIVA);
}

export function validarSumaItemsContraTotales(payload: Pick<
  FacturaGeminiPayload,
  | 'items'
  | 'subtotal'
  | 'iva_21'
  | 'iva_10_5'
  | 'iva_27'
  | 'percepcion_iibb'
  | 'percepcion_iva'
  | 'impuesto_interno'
  | 'otros_impuestos'
  | 'total'
>): {
  items_cuadran: boolean;
  suma_items: number;
  referencia: number | null;
  diferencia: number | null;
} {
  const sumaItems = round2(payload.items.reduce((s, it) => s + (it.subtotal || 0), 0));
  if (payload.items.length === 0) {
    return { items_cuadran: false, suma_items: sumaItems, referencia: null, diferencia: null };
  }

  const sumIva = (payload.iva_21 ?? 0) + (payload.iva_10_5 ?? 0) + (payload.iva_27 ?? 0);
  const otros =
    (payload.impuesto_interno ?? 0) +
    (payload.otros_impuestos ?? 0) +
    (payload.percepcion_iibb ?? 0) +
    (payload.percepcion_iva ?? 0);
  const targets = [
    payload.subtotal,
    payload.total,
    payload.subtotal != null ? round2(payload.subtotal + sumIva) : null,
    payload.total != null ? round2(payload.total - otros) : null,
  ].filter((n): n is number => n != null && Number.isFinite(n) && n >= 0);

  if (targets.length === 0) {
    return { items_cuadran: false, suma_items: sumaItems, referencia: null, diferencia: null };
  }

  let mejor = targets[0]!;
  let diff = Math.abs(sumaItems - mejor);
  for (const target of targets.slice(1)) {
    const d = Math.abs(sumaItems - target);
    if (d < diff) {
      mejor = target;
      diff = d;
    }
  }

  return {
    items_cuadran: diff <= toleranciaMonto(mejor),
    suma_items: sumaItems,
    referencia: mejor,
    diferencia: round2(sumaItems - mejor),
  };
}

export function validarTotalesFactura(payload: FacturaGeminiPayload): {
  totales_cuadran: boolean;
  advertencias: string[];
  items_cuadran: boolean;
  suma_items: number;
  referencia_items: number | null;
  diferencia_items: number | null;
} {
  const advertencias: string[] = [];
  const {
    subtotal,
    iva_21,
    iva_10_5,
    iva_27,
    percepcion_iibb,
    percepcion_iva,
    impuesto_interno,
    otros_impuestos,
    total,
  } = payload;
  const validacionItems = validarSumaItemsContraTotales(payload);

  if (total == null) {
    advertencias.push('No se detectó el total del comprobante.');
    return {
      totales_cuadran: false,
      advertencias,
      items_cuadran: validacionItems.items_cuadran,
      suma_items: validacionItems.suma_items,
      referencia_items: validacionItems.referencia,
      diferencia_items: validacionItems.diferencia,
    };
  }

  const sumIva = (iva_21 ?? 0) + (iva_10_5 ?? 0) + (iva_27 ?? 0);
  const otros =
    (impuesto_interno ?? 0) +
    (otros_impuestos ?? 0) +
    (percepcion_iibb ?? 0) +
    (percepcion_iva ?? 0);
  const base = subtotal ?? null;

  if (base != null) {
    const esperado = base + sumIva + otros;
    if (Math.abs(esperado - total) > TOLERANCIA_TOTALES) {
      advertencias.push(
        `Subtotal (${base}) + impuestos no coincide con el total (${total}). Revisá manualmente.`,
      );
      return {
        totales_cuadran: false,
        advertencias,
        items_cuadran: validacionItems.items_cuadran,
        suma_items: validacionItems.suma_items,
        referencia_items: validacionItems.referencia,
        diferencia_items: validacionItems.diferencia,
      };
    }
  }

  if (!validacionItems.items_cuadran) {
    const ref = validacionItems.referencia;
    advertencias.push(
      ref == null
        ? 'No se pudo validar la suma de los renglones contra los totales de la factura.'
        : `La suma de renglones leídos (${validacionItems.suma_items}) no coincide con subtotal/total impreso (${ref}). Probable tabla mal leída por IA; revisá cantidades y precios.`,
    );
  }

  return {
    totales_cuadran: advertencias.length === 0,
    advertencias,
    items_cuadran: validacionItems.items_cuadran,
    suma_items: validacionItems.suma_items,
    referencia_items: validacionItems.referencia,
    diferencia_items: validacionItems.diferencia,
  };
}

/** Líneas listas para el motor de matching (id temporal estable por índice). */
export function facturaItemsAMatcheables(items: FacturaGeminiPayload['items'], prefix = 'fact'): {
  id: string;
  codigo_proveedor: string | null;
  nombre_raw: string;
  nombre_normalizado: string;
}[] {
  return items.map((it, i) => ({
    id: `${prefix}-${i}`,
    codigo_proveedor: it.codigo,
    nombre_raw: it.descripcion,
    nombre_normalizado: normalizarString(it.descripcion),
  }));
}
