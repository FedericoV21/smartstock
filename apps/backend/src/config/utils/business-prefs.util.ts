/**
 * Preferencias de negocio (paridad `apps/frontend/src/lib/business-prefs/prefs.ts`).
 */
export type GananciaHorariaPrefs = {
  habilitado: boolean;
  horaDesde: string;
  horaHasta: string;
  aumentoPuntosPct: number;
};

export type CuentaCorrienteDistribuidoraPrefs = {
  permitirAjustesPorCaja: boolean;
  panelMovimientosDia: boolean;
  permitirLiquidacionItemsDia: boolean;
};

export type CajaInternaPrefs = {
  habilitado: boolean;
  alcance: 'tenant' | 'sucursal';
};

export type BusinessPrefs = {
  unificarProductosEntreProveedores: boolean;
  precioCostoSoloSube: boolean;
  registrarLotesPorIngreso: boolean;
  productosVariantesHabilitado: boolean;
  despieceCarniceriaHabilitado: boolean;
  mostrarResumenCierreCaja: boolean;
  gananciaHoraria: GananciaHorariaPrefs;
  cuentaCorrienteDistribuidora: CuentaCorrienteDistribuidoraPrefs;
  cajaInterna: CajaInternaPrefs;
};

export const DEFAULT_CUENTA_CORRIENTE_DISTRIBUIDORA_PREFS: CuentaCorrienteDistribuidoraPrefs = {
  permitirAjustesPorCaja: false,
  panelMovimientosDia: false,
  permitirLiquidacionItemsDia: false,
};

export const DEFAULT_CAJA_INTERNA_PREFS: CajaInternaPrefs = {
  habilitado: false,
  alcance: 'sucursal',
};

export const DEFAULT_GANANCIA_HORARIA_PREFS: GananciaHorariaPrefs = {
  habilitado: false,
  horaDesde: '00:00',
  horaHasta: '00:00',
  aumentoPuntosPct: 0,
};

export const DEFAULT_BUSINESS_PREFS: BusinessPrefs = {
  unificarProductosEntreProveedores: false,
  precioCostoSoloSube: false,
  registrarLotesPorIngreso: true,
  productosVariantesHabilitado: false,
  despieceCarniceriaHabilitado: false,
  mostrarResumenCierreCaja: true,
  gananciaHoraria: DEFAULT_GANANCIA_HORARIA_PREFS,
  cuentaCorrienteDistribuidora: DEFAULT_CUENTA_CORRIENTE_DISTRIBUIDORA_PREFS,
  cajaInterna: DEFAULT_CAJA_INTERNA_PREFS,
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const GANANCIA_HORARIA_AUMENTO_MAX = 500;

function normalizeHoraHHMM(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  return HH_MM_RE.test(s) ? s : fallback;
}

function normalizeAumentoPuntosPct(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(GANANCIA_HORARIA_AUMENTO_MAX, n) * 100) / 100;
}

export function normalizeCuentaCorrienteDistribuidoraPrefs(
  raw: unknown,
): CuentaCorrienteDistribuidoraPrefs {
  const o = isPlainObject(raw) ? raw : {};
  return {
    permitirAjustesPorCaja:
      typeof o.permitirAjustesPorCaja === 'boolean'
        ? o.permitirAjustesPorCaja
        : DEFAULT_CUENTA_CORRIENTE_DISTRIBUIDORA_PREFS.permitirAjustesPorCaja,
    panelMovimientosDia:
      typeof o.panelMovimientosDia === 'boolean'
        ? o.panelMovimientosDia
        : DEFAULT_CUENTA_CORRIENTE_DISTRIBUIDORA_PREFS.panelMovimientosDia,
    permitirLiquidacionItemsDia:
      typeof o.permitirLiquidacionItemsDia === 'boolean'
        ? o.permitirLiquidacionItemsDia
        : DEFAULT_CUENTA_CORRIENTE_DISTRIBUIDORA_PREFS.permitirLiquidacionItemsDia,
  };
}

export function normalizeCajaInternaPrefs(raw: unknown): CajaInternaPrefs {
  const o = isPlainObject(raw) ? raw : {};
  const alcanceRaw = o.alcance;
  const alcance: CajaInternaPrefs['alcance'] =
    alcanceRaw === 'tenant' || alcanceRaw === 'sucursal' ? alcanceRaw : DEFAULT_CAJA_INTERNA_PREFS.alcance;
  return {
    habilitado:
      typeof o.habilitado === 'boolean' ? o.habilitado : DEFAULT_CAJA_INTERNA_PREFS.habilitado,
    alcance,
  };
}

export function normalizeGananciaHorariaPrefs(raw: unknown): GananciaHorariaPrefs {
  const o = isPlainObject(raw) ? raw : {};
  return {
    habilitado:
      typeof o.habilitado === 'boolean'
        ? o.habilitado
        : DEFAULT_GANANCIA_HORARIA_PREFS.habilitado,
    horaDesde: normalizeHoraHHMM(o.horaDesde, DEFAULT_GANANCIA_HORARIA_PREFS.horaDesde),
    horaHasta: normalizeHoraHHMM(o.horaHasta, DEFAULT_GANANCIA_HORARIA_PREFS.horaHasta),
    aumentoPuntosPct: normalizeAumentoPuntosPct(o.aumentoPuntosPct),
  };
}

export function normalizeBusinessPrefs(raw: Partial<BusinessPrefs> | unknown | null | undefined): BusinessPrefs {
  const o: Partial<BusinessPrefs> = isPlainObject(raw) ? (raw as Partial<BusinessPrefs>) : {};
  const p: BusinessPrefs = { ...DEFAULT_BUSINESS_PREFS, ...o };
  if (typeof p.unificarProductosEntreProveedores !== 'boolean') {
    p.unificarProductosEntreProveedores = DEFAULT_BUSINESS_PREFS.unificarProductosEntreProveedores;
  }
  if (typeof p.precioCostoSoloSube !== 'boolean') {
    p.precioCostoSoloSube = DEFAULT_BUSINESS_PREFS.precioCostoSoloSube;
  }
  if (typeof p.registrarLotesPorIngreso !== 'boolean') {
    p.registrarLotesPorIngreso = DEFAULT_BUSINESS_PREFS.registrarLotesPorIngreso;
  }
  if (typeof p.productosVariantesHabilitado !== 'boolean') {
    p.productosVariantesHabilitado = DEFAULT_BUSINESS_PREFS.productosVariantesHabilitado;
  }
  if (typeof p.despieceCarniceriaHabilitado !== 'boolean') {
    p.despieceCarniceriaHabilitado = DEFAULT_BUSINESS_PREFS.despieceCarniceriaHabilitado;
  }
  if (typeof p.mostrarResumenCierreCaja !== 'boolean') {
    p.mostrarResumenCierreCaja = DEFAULT_BUSINESS_PREFS.mostrarResumenCierreCaja;
  }
  p.gananciaHoraria = normalizeGananciaHorariaPrefs(o.gananciaHoraria);
  p.cuentaCorrienteDistribuidora = normalizeCuentaCorrienteDistribuidoraPrefs(
    o.cuentaCorrienteDistribuidora,
  );
  p.cajaInterna = normalizeCajaInternaPrefs(o.cajaInterna);
  return p;
}

export function effectiveBusinessPrefsFromRows(
  tenantBusinessPrefs: unknown,
  sucursalBusinessPrefs: unknown | null,
): BusinessPrefs {
  const tenantNorm = normalizeBusinessPrefs(tenantBusinessPrefs);
  if (isPlainObject(sucursalBusinessPrefs)) {
    return mergeBusinessPrefsOverride(tenantNorm, sucursalBusinessPrefs);
  }
  return tenantNorm;
}

export function mergeBusinessPrefsOverride(basePrefs: BusinessPrefs, rawOverride: unknown): BusinessPrefs {
  if (!isPlainObject(rawOverride)) return basePrefs;
  const merged: Record<string, unknown> = { ...basePrefs, ...rawOverride };
  if (isPlainObject(rawOverride.gananciaHoraria)) {
    merged.gananciaHoraria = {
      ...basePrefs.gananciaHoraria,
      ...rawOverride.gananciaHoraria,
    };
  }
  if (isPlainObject(rawOverride.cuentaCorrienteDistribuidora)) {
    merged.cuentaCorrienteDistribuidora = {
      ...basePrefs.cuentaCorrienteDistribuidora,
      ...rawOverride.cuentaCorrienteDistribuidora,
    };
  }
  if (isPlainObject(rawOverride.cajaInterna)) {
    merged.cajaInterna = {
      ...basePrefs.cajaInterna,
      ...rawOverride.cajaInterna,
    };
  }
  return normalizeBusinessPrefs(merged);
}

export const BUSINESS_PREFS_KEYS: ReadonlyArray<keyof BusinessPrefs> = [
  'unificarProductosEntreProveedores',
  'precioCostoSoloSube',
  'registrarLotesPorIngreso',
  'productosVariantesHabilitado',
  'despieceCarniceriaHabilitado',
  'mostrarResumenCierreCaja',
  'gananciaHoraria',
  'cuentaCorrienteDistribuidora',
  'cajaInterna',
];

export function isBusinessPrefsPayload(v: unknown): v is Partial<BusinessPrefs> {
  if (!isPlainObject(v)) return false;
  const o = v as Record<string, unknown>;
  return BUSINESS_PREFS_KEYS.some((k) => k in o);
}
