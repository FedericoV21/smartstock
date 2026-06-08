import type { DespieceInput } from './tipos';

export type DespieceValidationIssue = {
  path: string;
  message: string;
};

export class DespieceValidationError extends Error {
  issues: DespieceValidationIssue[];

  constructor(issues: DespieceValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    this.name = 'DespieceValidationError';
    this.issues = issues;
  }
}

function esNumeroFinito(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validarDespieceInput(input: DespieceInput): void {
  const issues: DespieceValidationIssue[] = [];

  if (!esNumeroFinito(input.costoKgPadre) || input.costoKgPadre <= 0) {
    issues.push({ path: 'costoKgPadre', message: 'Debe ser mayor a 0.' });
  }

  if (!esNumeroFinito(input.pesoTotalKg) || input.pesoTotalKg <= 0) {
    issues.push({ path: 'pesoTotalKg', message: 'Debe ser mayor a 0.' });
  }

  if (!esNumeroFinito(input.rentabilidadObjetivoPct) || input.rentabilidadObjetivoPct < -100) {
    issues.push({
      path: 'rentabilidadObjetivoPct',
      message: 'Debe ser un porcentaje finito mayor o igual a -100.',
    });
  }

  if (!Array.isArray(input.cortes) || input.cortes.length === 0) {
    issues.push({ path: 'cortes', message: 'Debe incluir al menos un corte.' });
  }

  let kgTotal = 0;
  input.cortes.forEach((corte, index) => {
    const path = `cortes.${index}`;
    if (!corte.nombre?.trim()) {
      issues.push({ path: `${path}.nombre`, message: 'Debe tener nombre.' });
    }
    if (!esNumeroFinito(corte.kgRendimiento) || corte.kgRendimiento < 0) {
      issues.push({ path: `${path}.kgRendimiento`, message: 'Debe ser mayor o igual a 0.' });
    } else {
      kgTotal += corte.kgRendimiento;
    }

    const factor = corte.factorAjustePct ?? 0;
    if (!esNumeroFinito(factor) || factor < -1) {
      issues.push({
        path: `${path}.factorAjustePct`,
        message: 'Debe ser un decimal finito mayor o igual a -1.',
      });
    }

    if (
      corte.precioAnclado != null &&
      (!esNumeroFinito(corte.precioAnclado) || corte.precioAnclado < 0)
    ) {
      issues.push({ path: `${path}.precioAnclado`, message: 'Debe ser mayor o igual a 0.' });
    }

    if (
      corte.precioCorreccion != null &&
      (!esNumeroFinito(corte.precioCorreccion) || corte.precioCorreccion < 0)
    ) {
      issues.push({ path: `${path}.precioCorreccion`, message: 'Debe ser mayor o igual a 0.' });
    }
  });

  if (kgTotal <= 0) {
    issues.push({ path: 'cortes', message: 'La suma de kg de rendimiento debe ser mayor a 0.' });
  }

  if (issues.length > 0) {
    throw new DespieceValidationError(issues);
  }
}
