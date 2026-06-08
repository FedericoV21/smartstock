import type { Database } from '@/types/database';

type TipoCuenta = Database['public']['Enums']['tipo_cuenta_corriente'];
type CobroModalidad = Database['public']['Enums']['cobro_modalidad'];
type CobroPeriodicidad = Database['public']['Enums']['cobro_periodicidad'];

export type CondicionesCuentaState = {
  tipo_cuenta: TipoCuenta;
  cobro_modalidad: CobroModalidad;
  cobro_dias_plazo: number;
  cobro_periodicidad: CobroPeriodicidad | null;
  cobro_dia_vencimiento_mes: number | null;
  cobro_monto_minimo: number;
};

export const CUENTA_CORRIENTE_CONDICIONES_DEFAULTS: CondicionesCuentaState = {
  tipo_cuenta: 'cliente',
  cobro_modalidad: 'por_comprobante',
  cobro_dias_plazo: 7,
  cobro_periodicidad: null,
  cobro_dia_vencimiento_mes: null,
  cobro_monto_minimo: 0,
};

/** Condiciones iniciales para cuenta corriente de proveedor (misma lógica de vencimientos, saldo a pagar al proveedor). */
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

const MODALIDADES: CobroModalidad[] = [
  'por_comprobante',
  'periodico',
  'dia_fijo_mes',
];

function esModalidad(v: unknown): v is CobroModalidad {
  return typeof v === 'string' && (MODALIDADES as string[]).includes(v);
}

/** Aplica solo claves presentes en `patch` sobre `base` y valida coherencia final. */
export function applyCondicionesCuentaPatch(
  base: CondicionesCuentaState,
  patch: Record<string, unknown>,
): { ok: true; state: CondicionesCuentaState } | { ok: false; error: string } {
  const next: CondicionesCuentaState = { ...base };

  if (patch.tipo_cuenta !== undefined) {
    const t = patch.tipo_cuenta;
    if (t !== 'cliente' && t !== 'empleado' && t !== 'proveedor') {
      return { ok: false, error: 'tipo_cuenta inválido' };
    }
    next.tipo_cuenta = t;
  }

  if (patch.cobro_modalidad !== undefined) {
    const m = patch.cobro_modalidad;
    if (!esModalidad(m)) {
      return { ok: false, error: 'cobro_modalidad inválida' };
    }
    next.cobro_modalidad = m;
  }

  if (patch.cobro_dias_plazo !== undefined) {
    const d =
      typeof patch.cobro_dias_plazo === 'number'
        ? patch.cobro_dias_plazo
        : Number(patch.cobro_dias_plazo);
    if (!Number.isFinite(d) || !Number.isInteger(d) || d < 1 || d > 3650) {
      return {
        ok: false,
        error: 'cobro_dias_plazo debe ser un entero entre 1 y 3650',
      };
    }
    next.cobro_dias_plazo = d;
  }

  if (patch.cobro_periodicidad !== undefined) {
    const p = patch.cobro_periodicidad;
    if (
      p !== null &&
      p !== 'diaria' &&
      p !== 'semanal' &&
      p !== 'quincenal' &&
      p !== 'mensual'
    ) {
      return { ok: false, error: 'cobro_periodicidad inválida' };
    }
    next.cobro_periodicidad = p as CobroPeriodicidad | null;
  }

  if (patch.cobro_dia_vencimiento_mes !== undefined) {
    const dm = patch.cobro_dia_vencimiento_mes;
    if (dm === null) {
      next.cobro_dia_vencimiento_mes = null;
    } else {
      const n = typeof dm === 'number' ? dm : Number(dm);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 31) {
        return {
          ok: false,
          error: 'cobro_dia_vencimiento_mes debe ser un entero entre 1 y 31',
        };
      }
      next.cobro_dia_vencimiento_mes = n;
    }
  }

  if (patch.cobro_monto_minimo !== undefined) {
    const n =
      typeof patch.cobro_monto_minimo === 'number'
        ? patch.cobro_monto_minimo
        : Number(patch.cobro_monto_minimo);
    if (!Number.isFinite(n) || n < 0) {
      return {
        ok: false,
        error: 'cobro_monto_minimo debe ser un número mayor o igual a 0',
      };
    }
    next.cobro_monto_minimo = n;
  }

  if (next.cobro_modalidad === 'por_comprobante') {
    next.cobro_periodicidad = null;
    next.cobro_dia_vencimiento_mes = null;
  } else if (next.cobro_modalidad === 'periodico') {
    next.cobro_dia_vencimiento_mes = null;
    if (!next.cobro_periodicidad) {
      return {
        ok: false,
        error: 'En modalidad periódica debe indicarse cobro_periodicidad',
      };
    }
  } else if (next.cobro_modalidad === 'dia_fijo_mes') {
    next.cobro_periodicidad = null;
    if (next.cobro_dia_vencimiento_mes == null) {
      return {
        ok: false,
        error: 'Indicá el día del mes (1–31) para vencimiento fijo',
      };
    }
  }

  return { ok: true, state: next };
}
