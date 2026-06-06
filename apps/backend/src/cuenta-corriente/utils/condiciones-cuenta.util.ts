import { CobroModalidad } from '../enums/cobro-modalidad.enum';
import { CobroPeriodicidad } from '../enums/cobro-periodicidad.enum';

export type CondicionesCuentaState = {
  tipo_cuenta: 'cliente' | 'empleado' | 'proveedor';
  cobro_modalidad: CobroModalidad;
  cobro_dias_plazo: number;
  cobro_periodicidad: CobroPeriodicidad | null;
  cobro_dia_vencimiento_mes: number | null;
  cobro_monto_minimo: number;
};

export const CUENTA_CORRIENTE_CONDICIONES_DEFAULTS: CondicionesCuentaState = {
  tipo_cuenta: 'cliente',
  cobro_modalidad: CobroModalidad.por_comprobante,
  cobro_dias_plazo: 7,
  cobro_periodicidad: null,
  cobro_dia_vencimiento_mes: null,
  cobro_monto_minimo: 0,
};

export const CUENTA_CORRIENTE_PROVEEDOR_DEFAULTS: CondicionesCuentaState = {
  ...CUENTA_CORRIENTE_CONDICIONES_DEFAULTS,
  tipo_cuenta: 'proveedor',
};

const CONDICION_KEYS = [
  'tipo_cuenta',
  'cobro_modalidad',
  'cobro_dias_plazo',
  'cobro_periodicidad',
  'cobro_dia_vencimiento_mes',
  'cobro_monto_minimo',
] as const;

export function pickCondicionesKeys(b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CONDICION_KEYS) {
    if (b[k] !== undefined) out[k] = b[k];
  }
  return out;
}

const MODALIDADES = new Set<string>(Object.values(CobroModalidad));

export function applyCondicionesCuentaPatch(
  base: CondicionesCuentaState,
  patch: Record<string, unknown>,
): { ok: true; state: CondicionesCuentaState } | { ok: false; error: string } {
  const next: CondicionesCuentaState = { ...base };

  if (patch.tipo_cuenta !== undefined) {
    const t = patch.tipo_cuenta;
    if (t !== 'cliente' && t !== 'empleado' && t !== 'proveedor') {
      return { ok: false, error: 'tipo_cuenta inv├ílido' };
    }
    next.tipo_cuenta = t;
  }

  if (patch.cobro_modalidad !== undefined) {
    const m = String(patch.cobro_modalidad);
    if (!MODALIDADES.has(m)) return { ok: false, error: 'cobro_modalidad inv├ílida' };
    next.cobro_modalidad = m as CobroModalidad;
  }

  if (patch.cobro_dias_plazo !== undefined) {
    const d = Number(patch.cobro_dias_plazo);
    if (!Number.isFinite(d) || !Number.isInteger(d) || d < 1 || d > 3650) {
      return { ok: false, error: 'cobro_dias_plazo debe ser un entero entre 1 y 3650' };
    }
    next.cobro_dias_plazo = d;
  }

  if (patch.cobro_periodicidad !== undefined) {
    const p = patch.cobro_periodicidad;
    if (
      p !== null &&
      p !== CobroPeriodicidad.diaria &&
      p !== CobroPeriodicidad.semanal &&
      p !== CobroPeriodicidad.quincenal &&
      p !== CobroPeriodicidad.mensual
    ) {
      return { ok: false, error: 'cobro_periodicidad inv├ílida' };
    }
    next.cobro_periodicidad = p as CobroPeriodicidad | null;
  }

  if (patch.cobro_dia_vencimiento_mes !== undefined) {
    const dm = patch.cobro_dia_vencimiento_mes;
    if (dm === null) {
      next.cobro_dia_vencimiento_mes = null;
    } else {
      const n = Number(dm);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 31) {
        return { ok: false, error: 'cobro_dia_vencimiento_mes debe ser un entero entre 1 y 31' };
      }
      next.cobro_dia_vencimiento_mes = n;
    }
  }

  if (patch.cobro_monto_minimo !== undefined) {
    const n = Number(patch.cobro_monto_minimo);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: 'cobro_monto_minimo debe ser un n├║mero mayor o igual a 0' };
    }
    next.cobro_monto_minimo = n;
  }

  if (next.cobro_modalidad === CobroModalidad.por_comprobante) {
    next.cobro_periodicidad = null;
    next.cobro_dia_vencimiento_mes = null;
  } else if (next.cobro_modalidad === CobroModalidad.periodico) {
    next.cobro_dia_vencimiento_mes = null;
    if (!next.cobro_periodicidad) {
      return { ok: false, error: 'En modalidad peri├│dica debe indicarse cobro_periodicidad' };
    }
  } else if (next.cobro_modalidad === CobroModalidad.dia_fijo_mes) {
    next.cobro_periodicidad = null;
    if (next.cobro_dia_vencimiento_mes == null) {
      return { ok: false, error: 'Indic├í el d├¡a del mes (1ÔÇô31) para vencimiento fijo' };
    }
  }

  return { ok: true, state: next };
}
