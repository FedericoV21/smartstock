export type CuentaCorrienteDistribuidoraPrefs = {
  panelMovimientosDia: boolean;
  permitirLiquidacionItemsDia: boolean;
};

export function readCcDistribuidoraPrefs(
  businessPrefs: Record<string, unknown> | null | undefined,
): CuentaCorrienteDistribuidoraPrefs {
  const raw = businessPrefs?.cuentaCorrienteDistribuidora;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { panelMovimientosDia: false, permitirLiquidacionItemsDia: false };
  }
  const o = raw as Record<string, unknown>;
  return {
    panelMovimientosDia: o.panelMovimientosDia === true,
    permitirLiquidacionItemsDia: o.permitirLiquidacionItemsDia === true,
  };
}
