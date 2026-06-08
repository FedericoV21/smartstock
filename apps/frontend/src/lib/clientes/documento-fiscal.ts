import type { Database } from '@/types/database';

export type ClienteDocumentoFiscal = Database['public']['Enums']['cliente_documento_fiscal'];
export type TipoDocumentoFiscalDetectado = ClienteDocumentoFiscal | null;

/** Alta: campo ausente → sin tipo explícito (inferencia por dígitos). */
export function parseDocumentoFiscalTipoInsert(v: unknown): ClienteDocumentoFiscal | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null;
  if (v === 'cuit' || v === 'dni') return v;
  return 'invalid';
}

/** Actualización: campo ausente → no modificar. */
export function parseDocumentoFiscalTipoPatch(
  v: unknown,
): ClienteDocumentoFiscal | null | 'invalid' | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (v === 'cuit' || v === 'dni') return v;
  return 'invalid';
}

/** Solo dígitos del documento (CUIT o DNI). */
export function soloDigitosDocumento(cuitDni: string | null | undefined): string {
  return String(cuitDni ?? '').replace(/\D/g, '');
}

/**
 * Detecta el tipo probable por longitud de dígitos.
 * - 11 => CUIT
 * - 7/8 => DNI
 * - resto => sin tipo inferido
 */
export function detectarTipoDocumentoFiscal(
  cuitDni: string | null | undefined,
): TipoDocumentoFiscalDetectado {
  const limpio = soloDigitosDocumento(cuitDni);
  if (limpio.length === 11) return 'cuit';
  if (limpio.length === 7 || limpio.length === 8) return 'dni';
  return null;
}

/**
 * Valida el dígito verificador de CUIT/CUIL por módulo 11.
 */
export function validarCuitDigitoVerificador(cuitDni: string | null | undefined): boolean {
  const limpio = soloDigitosDocumento(cuitDni);
  if (!/^\d{11}$/.test(limpio)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i += 1) {
    suma += Number(limpio[i]) * pesos[i];
  }
  const resto = suma % 11;
  const verificador = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return Number(limpio[10]) === verificador;
}

export function validarDocumentoFiscal(
  cuitDni: string | null | undefined,
  tipo: ClienteDocumentoFiscal | null,
): { ok: true } | { ok: false; error: string } {
  const limpio = soloDigitosDocumento(cuitDni);
  if (!tipo) return { ok: true };
  if (!limpio) {
    return { ok: false, error: 'Si indicás el tipo de documento, completá el CUIT o el DNI.' };
  }
  if (tipo === 'cuit') {
    if (limpio.length !== 11) {
      return { ok: false, error: 'Para tipo CUIT el número debe tener 11 dígitos.' };
    }
    return { ok: true };
  }
  if (limpio.length !== 7 && limpio.length !== 8) {
    return { ok: false, error: 'Para tipo DNI el número debe tener 7 u 8 dígitos.' };
  }
  return { ok: true };
}

/**
 * Validación en tiempo real para UX:
 * - Permite vacío (sin documento)
 * - Valida formato DNI/CUIT inferido por longitud
 * - Para CUIT, valida dígito verificador
 */
export function validarDocumentoFiscalRealtime(
  cuitDni: string | null | undefined,
):
  | { ok: true; tipo: TipoDocumentoFiscalDetectado; normalizado: string }
  | { ok: false; error: string; tipo: TipoDocumentoFiscalDetectado; normalizado: string } {
  const normalizado = soloDigitosDocumento(cuitDni);
  if (!normalizado) {
    return { ok: true, tipo: null, normalizado };
  }
  const tipo = detectarTipoDocumentoFiscal(normalizado);
  if (!tipo) {
    return {
      ok: false,
      error: 'Ingresá un DNI (7 u 8 dígitos) o CUIT (11 dígitos).',
      tipo: null,
      normalizado,
    };
  }
  if (tipo === 'dni') {
    return { ok: true, tipo, normalizado };
  }
  if (!validarCuitDigitoVerificador(normalizado)) {
    return {
      ok: false,
      error: 'CUIT inválido: revisá el dígito verificador.',
      tipo,
      normalizado,
    };
  }
  return { ok: true, tipo, normalizado };
}
