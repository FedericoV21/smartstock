export type EffectiveBusinessPrefs = {
  unificarProductosEntreProveedores: boolean;
};

const DEFAULT_PREFS: EffectiveBusinessPrefs = {
  unificarProductosEntreProveedores: false,
};

function readUnificar(raw: unknown): boolean | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const v = (raw as Record<string, unknown>).unificarProductosEntreProveedores;
  return typeof v === 'boolean' ? v : undefined;
}

export function effectiveBusinessPrefs(
  tenantPrefs: unknown,
  sucursalPrefs: unknown | null,
): EffectiveBusinessPrefs {
  const out = { ...DEFAULT_PREFS };
  const tenantVal = readUnificar(tenantPrefs);
  if (tenantVal !== undefined) out.unificarProductosEntreProveedores = tenantVal;
  const sucursalVal = readUnificar(sucursalPrefs);
  if (sucursalVal !== undefined) out.unificarProductosEntreProveedores = sucursalVal;
  return out;
}
