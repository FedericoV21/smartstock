/**
 * Preferencias POS (paridad `apps/frontend/src/lib/pos/prefs.ts` — subset operativo).
 */
export type PosPrefs = {
  sonidos: boolean;
  anchoTicket: '58mm' | '80mm';
  stockBloqueante: boolean;
  aceptaTicket: boolean;
  aceptaFactura: boolean;
  comprobantePredeterminado: 'ticket' | 'factura';
  posPermiteCrearProductos: boolean;
  posCrearProductosSoloAdmin: boolean;
  balanzaTemplate: string;
  balanzaTemplates: string[];
  balanzaUnidadTemplate: string | null;
  balanzaImporteTemplate: string | null;
  pvpRedondeoCentenasArriba: boolean;
  pvpRedondeoMenores100ADecenas: boolean;
  posMostrarCategoria: boolean;
  posMostrarRubro: boolean;
  posMostrarGananciaTramos: boolean;
  posMostrarStock: boolean;
  posMostrarCodigoBarras: boolean;
  balanzaConfigPorSucursal: boolean;
};

export const DEFAULT_POS_PREFS: PosPrefs = {
  sonidos: true,
  anchoTicket: '80mm',
  stockBloqueante: true,
  aceptaTicket: true,
  aceptaFactura: true,
  comprobantePredeterminado: 'ticket',
  posPermiteCrearProductos: false,
  posCrearProductosSoloAdmin: true,
  balanzaTemplate: '',
  balanzaTemplates: [],
  balanzaUnidadTemplate: null,
  balanzaImporteTemplate: null,
  pvpRedondeoCentenasArriba: false,
  pvpRedondeoMenores100ADecenas: false,
  posMostrarCategoria: true,
  posMostrarRubro: true,
  posMostrarGananciaTramos: false,
  posMostrarStock: true,
  posMostrarCodigoBarras: false,
  balanzaConfigPorSucursal: false,
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function normalizeBalanzaTemplates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (s.length >= 8 && s.length <= 14 && !out.includes(s)) {
      out.push(s);
    }
    if (out.length >= 2) break;
  }
  return out;
}

export function normalizeBalanzaImporteTemplate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).trim();
  if (s.length < 8 || s.length > 14) return null;
  if (!s.includes('I') || !s.includes('X')) return null;
  return s;
}

export function normalizePosPrefs(raw: unknown): PosPrefs {
  const o = isPlainObject(raw) ? raw : {};
  const templates = normalizeBalanzaTemplates(o.balanzaTemplates);
  const legacyTemplate =
    typeof o.balanzaTemplate === 'string' ? o.balanzaTemplate.trim() : '';
  const mergedTemplates =
    templates.length > 0
      ? templates
      : legacyTemplate.length >= 8 && legacyTemplate.length <= 14
        ? [legacyTemplate]
        : [];

  return {
    sonidos: asBool(o.sonidos, DEFAULT_POS_PREFS.sonidos),
    anchoTicket: o.anchoTicket === '58mm' ? '58mm' : '80mm',
    stockBloqueante: asBool(o.stockBloqueante, DEFAULT_POS_PREFS.stockBloqueante),
    aceptaTicket: asBool(o.aceptaTicket, DEFAULT_POS_PREFS.aceptaTicket),
    aceptaFactura: asBool(o.aceptaFactura, DEFAULT_POS_PREFS.aceptaFactura),
    comprobantePredeterminado:
      o.comprobantePredeterminado === 'factura' ? 'factura' : 'ticket',
    posPermiteCrearProductos: asBool(
      o.posPermiteCrearProductos,
      DEFAULT_POS_PREFS.posPermiteCrearProductos,
    ),
    posCrearProductosSoloAdmin: asBool(
      o.posCrearProductosSoloAdmin,
      DEFAULT_POS_PREFS.posCrearProductosSoloAdmin,
    ),
    balanzaTemplate: mergedTemplates[0] ?? '',
    balanzaTemplates: mergedTemplates,
    balanzaUnidadTemplate:
      typeof o.balanzaUnidadTemplate === 'string' ? o.balanzaUnidadTemplate.trim() || null : null,
    balanzaImporteTemplate: normalizeBalanzaImporteTemplate(o.balanzaImporteTemplate),
    pvpRedondeoCentenasArriba: asBool(
      o.pvpRedondeoCentenasArriba,
      DEFAULT_POS_PREFS.pvpRedondeoCentenasArriba,
    ),
    pvpRedondeoMenores100ADecenas: asBool(
      o.pvpRedondeoMenores100ADecenas,
      DEFAULT_POS_PREFS.pvpRedondeoMenores100ADecenas,
    ),
    posMostrarCategoria: asBool(o.posMostrarCategoria, DEFAULT_POS_PREFS.posMostrarCategoria),
    posMostrarRubro: asBool(o.posMostrarRubro, DEFAULT_POS_PREFS.posMostrarRubro),
    posMostrarGananciaTramos: asBool(
      o.posMostrarGananciaTramos,
      DEFAULT_POS_PREFS.posMostrarGananciaTramos,
    ),
    posMostrarStock: asBool(o.posMostrarStock, DEFAULT_POS_PREFS.posMostrarStock),
    posMostrarCodigoBarras: asBool(
      o.posMostrarCodigoBarras,
      DEFAULT_POS_PREFS.posMostrarCodigoBarras,
    ),
    balanzaConfigPorSucursal: asBool(
      o.balanzaConfigPorSucursal,
      DEFAULT_POS_PREFS.balanzaConfigPorSucursal,
    ),
  };
}

export function finalizePosPrefsForStorage(prefs: PosPrefs): PosPrefs {
  const templates = normalizeBalanzaTemplates(prefs.balanzaTemplates);
  return {
    ...prefs,
    balanzaTemplates: templates,
    balanzaTemplate: templates[0] ?? '',
    balanzaImporteTemplate: normalizeBalanzaImporteTemplate(prefs.balanzaImporteTemplate),
  };
}

export function clampPosPrefsForArca(prefs: PosPrefs, arcaOk: boolean): PosPrefs {
  if (arcaOk) return prefs;
  return { ...prefs, aceptaFactura: false };
}

function mergePosLayer(base: PosPrefs, layer: unknown): PosPrefs {
  const norm = normalizePosPrefs(layer);
  return { ...base, ...norm, balanzaTemplates: norm.balanzaTemplates };
}

export function effectivePosPrefsFromRows(
  tenantPrefs: unknown,
  sucursalPrefs: unknown | null,
): PosPrefs {
  let effective = normalizePosPrefs(tenantPrefs);
  if (!sucursalPrefs || !isPlainObject(sucursalPrefs)) {
    return effective;
  }

  const tenantNorm = normalizePosPrefs(tenantPrefs);
  const hasBalanzaKeys =
    'balanzaTemplates' in sucursalPrefs ||
    'balanzaTemplate' in sucursalPrefs ||
    'balanzaImporteTemplate' in sucursalPrefs;

  if (tenantNorm.balanzaConfigPorSucursal || hasBalanzaKeys) {
    effective = mergePosLayer(effective, sucursalPrefs);
  } else {
    const partial = { ...sucursalPrefs };
    delete partial.balanzaTemplates;
    delete partial.balanzaTemplate;
    delete partial.balanzaImporteTemplate;
    effective = mergePosLayer(effective, partial);
  }

  return effective;
}

export function sucursalTieneOverrideBalanza(tenant: PosPrefs, sucursalEffective: PosPrefs): boolean {
  return (
    JSON.stringify(tenant.balanzaTemplates) !== JSON.stringify(sucursalEffective.balanzaTemplates) ||
    tenant.balanzaImporteTemplate !== sucursalEffective.balanzaImporteTemplate
  );
}

export function posPrefsSucursalParaGuardar(
  tenant: PosPrefs,
  patch: Partial<PosPrefs>,
): PosPrefs {
  return finalizePosPrefsForStorage({ ...tenant, ...normalizePosPrefs(patch) });
}

export function posPrefsSucursalDiffForStorage(
  tenant: PosPrefs,
  merged: PosPrefs,
): Record<string, unknown> | null {
  const diff: Record<string, unknown> = {};
  for (const key of Object.keys(merged) as (keyof PosPrefs)[]) {
    const a = merged[key];
    const b = tenant[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diff[key] = a;
    }
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

export function isPosPrefsPayload(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  const keys = [
    'sonidos',
    'anchoTicket',
    'stockBloqueante',
    'aceptaTicket',
    'aceptaFactura',
    'comprobantePredeterminado',
    'posPermiteCrearProductos',
    'posCrearProductosSoloAdmin',
    'balanzaTemplate',
    'balanzaTemplates',
    'balanzaUnidadTemplate',
    'balanzaImporteTemplate',
    'pvpRedondeoCentenasArriba',
    'pvpRedondeoMenores100ADecenas',
    'posMostrarCategoria',
    'posMostrarRubro',
    'posMostrarGananciaTramos',
    'posMostrarStock',
    'posMostrarCodigoBarras',
    'balanzaConfigPorSucursal',
  ];
  return keys.some((k) => k in v);
}

export function tenantPermiteBalanzaPorSucursal(posPrefsRaw: unknown): boolean {
  return normalizePosPrefs(posPrefsRaw).balanzaConfigPorSucursal;
}
