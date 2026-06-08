/**
 * Preferencias de negocio relacionadas con catálogo / importación / proveedores.
 * Se persisten en `tenant.business_prefs` y opcionalmente en `sucursal.business_prefs`
 * (NULL = heredar). Mismo patrón que `pos_prefs`.
 */
export type GananciaHorariaPrefs = {
  habilitado: boolean;
  horaDesde: string;
  horaHasta: string;
  aumentoPuntosPct: number;
};

/** Preferencias de cuenta corriente mayorista / distribuidora por sucursal (opt-in). */
export type CuentaCorrienteDistribuidoraPrefs = {
  /** Habilita configurar toggles por caja en esta sucursal. */
  permitirAjustesPorCaja: boolean;
  panelMovimientosDia: boolean;
  permitirLiquidacionItemsDia: boolean;
};

/** Caja interna / tesorería del negocio o por sucursal. */
export type CajaInternaPrefs = {
  habilitado: boolean;
  /** tenant = una caja central; sucursal = una por branch activa. */
  alcance: 'tenant' | 'sucursal';
};

export type BusinessPrefs = {
  /**
   * Si está activa: cuando se importa / carga un producto de un proveedor distinto al que ya existe
   * pero el `código` y `código_barras` coinciden exactamente, se actualiza el producto existente
   * en vez de crear un duplicado. Si alguno de los dos campos no está presente, no fusiona.
   */
  unificarProductosEntreProveedores: boolean;
  /**
   * Si está activa, al actualizar un producto el `precio_costo` solo puede subir.
   * Si la fila importada trae un costo menor al actual, se mantiene el costo anterior.
   */
  precioCostoSoloSube: boolean;
  /**
   * Si está activa, cada ingreso por importación / lectura de factura / alta con stock crea
   * una fila en `producto_lote_ingreso` con cantidad, vencimiento, costo y proveedor.
   * Permite mostrar varios vencimientos en la ficha del producto.
   */
  registrarLotesPorIngreso: boolean;
  /**
   * Flag de rollout para mostrar/usar productos con variantes en UI/API.
   * La base puede estar migrada globalmente, pero el uso queda opt-in por tenant/sucursal.
   */
  productosVariantesHabilitado: boolean;
  /**
   * Habilita plantillas de despiece, ingresos y pricing por cortes (carnicerías, pollos).
   * Requiere además el módulo de plan `despiece_carniceria`.
   */
  despieceCarniceriaHabilitado: boolean;
  /**
   * Si esta activa, el cierre rapido del POS muestra la vista previa del cierre y
   * el resumen post-cierre con opcion de imprimir ticket.
   * Si se desactiva, el cierre se registra y el modal se cierra sin mostrar ese resumen,
   * dejando al operador solo la carga del efectivo.
   */
  mostrarResumenCierreCaja: boolean;
  /**
   * Aumento temporal de ganancia al vender. No modifica PVP guardados:
   * solo suma puntos porcentuales a la ganancia efectiva durante el rango horario.
   */
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

/**
 * Resuelve las prefs efectivas. Si la sucursal no tiene override (NULL), se devuelve el tenant.
 * Si tiene un objeto, se mergea encima de los defaults del tenant.
 */
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

/** Lista de claves válidas, para validar el payload del PATCH. */
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
