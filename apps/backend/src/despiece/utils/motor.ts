import type {
  DespieceCalibracionInput,
  DespieceCalibracionObjetivoInput,
  DespieceCalibracionResultado,
  DespieceCorteResultado,
  DespieceInput,
  DespieceResumenEstrategia,
  DespieceResultado,
} from './tipos';
import { validarDespieceInput } from './validar';

function calcularResumen(
  costoTotal: number,
  pesoTotalKg: number,
  ventaTotal: number,
): DespieceResumenEstrategia {
  const gananciaBruta = ventaTotal - costoTotal;
  return {
    costoTotal,
    ventaTotal,
    gananciaBruta,
    precioPromedioKgPadre: ventaTotal / pesoTotalKg,
    rentabilidadPct: (gananciaBruta / costoTotal) * 100,
  };
}

/**
 * Replica la lógica central de la planilla de carnicería:
 * 1. Precio variable por corte = costo total / kg rendidos * (1 + factor).
 * 2. Precio fijo objetivo = precio variable reescalado para llegar a la rentabilidad global objetivo.
 * 3. Precio anclado = precio manual por corte, si existe.
 * 4. Corrección = desvío de un precio de prueba contra el precio base del kg rendido.
 */
function validarNumeroPositivo(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Toma un ejemplo real ya valorizado y despeja el factor de cada corte:
 * factor = precio vendido / costo base por kg rendido - 1.
 */
export function calibrarFactoresDesdeEjemplo(
  input: DespieceCalibracionInput,
): DespieceCalibracionResultado {
  const issues: string[] = [];

  if (!validarNumeroPositivo(input.costoKgPadre)) {
    issues.push('El costo por kg del ejemplo debe ser mayor a 0.');
  }
  if (!validarNumeroPositivo(input.pesoTotalKg)) {
    issues.push('El peso total del ejemplo debe ser mayor a 0.');
  }
  if (!Array.isArray(input.cortes) || input.cortes.length === 0) {
    issues.push('Carga al menos un corte del ejemplo.');
  }

  let kgRendimientoTotal = 0;
  input.cortes.forEach((corte, index) => {
    if (!corte.nombre?.trim()) {
      issues.push(`El corte ${index + 1} debe tener nombre.`);
    }
    if (!validarNumeroPositivo(corte.kgRendimiento)) {
      issues.push(`Los kg del corte ${index + 1} deben ser mayores a 0.`);
    } else {
      kgRendimientoTotal += corte.kgRendimiento;
    }
    if (
      typeof corte.precioVentaKg !== 'number' ||
      !Number.isFinite(corte.precioVentaKg) ||
      corte.precioVentaKg < 0
    ) {
      issues.push(`El precio vendido del corte ${index + 1} debe ser mayor o igual a 0.`);
    }
  });

  if (kgRendimientoTotal <= 0) {
    issues.push('La suma de kg rendidos del ejemplo debe ser mayor a 0.');
  }
  if (issues.length > 0) {
    throw new Error(issues.join(' '));
  }

  const costoTotal = input.costoKgPadre * input.pesoTotalKg;
  const precioBaseKgRendido = costoTotal / kgRendimientoTotal;
  let ventaTotalEjemplo = 0;

  const cortes = input.cortes.map((corte) => {
    const importe = corte.kgRendimiento * corte.precioVentaKg;
    ventaTotalEjemplo += importe;
    return {
      id: corte.id,
      nombre: corte.nombre,
      kgRendimiento: corte.kgRendimiento,
      precioVentaKg: corte.precioVentaKg,
      factorAjustePct: corte.precioVentaKg / precioBaseKgRendido - 1,
      importe,
    };
  });

  return {
    nombre: input.nombre,
    costoTotal,
    kgRendimientoTotal,
    rendimientoPct: (kgRendimientoTotal / input.pesoTotalKg) * 100,
    precioBaseKgRendido,
    ventaTotalEjemplo,
    rentabilidadEjemploPct: (ventaTotalEjemplo / costoTotal - 1) * 100,
    cortes,
  };
}

/**
 * Calcula un precio parejo por kg rendido para llegar a la rentabilidad objetivo.
 * Es el caso de un cajon de pollo cuando se conocen kg por pieza, pero no precios
 * vendidos por corte: todos los cortes comparten el mismo factor objetivo y el
 * precio calculado absorbe costo, merma y rentabilidad.
 */
export function calcularFactoresPorRentabilidadObjetivo(
  input: DespieceCalibracionObjetivoInput,
): DespieceCalibracionResultado {
  const issues: string[] = [];

  if (!validarNumeroPositivo(input.costoKgPadre)) {
    issues.push('El costo por kg del ejemplo debe ser mayor a 0.');
  }
  if (!validarNumeroPositivo(input.pesoTotalKg)) {
    issues.push('El peso total del ejemplo debe ser mayor a 0.');
  }
  if (
    typeof input.rentabilidadObjetivoPct !== 'number' ||
    !Number.isFinite(input.rentabilidadObjetivoPct) ||
    input.rentabilidadObjetivoPct < -100
  ) {
    issues.push('La rentabilidad objetivo debe ser mayor o igual a -100.');
  }
  if (!Array.isArray(input.cortes) || input.cortes.length === 0) {
    issues.push('Carga al menos un corte del ejemplo.');
  }

  let kgRendimientoTotal = 0;
  input.cortes.forEach((corte, index) => {
    if (!corte.nombre?.trim()) {
      issues.push(`El corte ${index + 1} debe tener nombre.`);
    }
    if (!validarNumeroPositivo(corte.kgRendimiento)) {
      issues.push(`Los kg del corte ${index + 1} deben ser mayores a 0.`);
    } else {
      kgRendimientoTotal += corte.kgRendimiento;
    }
  });

  if (kgRendimientoTotal <= 0) {
    issues.push('La suma de kg rendidos del ejemplo debe ser mayor a 0.');
  }
  if (issues.length > 0) {
    throw new Error(issues.join(' '));
  }

  const costoTotal = input.costoKgPadre * input.pesoTotalKg;
  const precioBaseKgRendido = costoTotal / kgRendimientoTotal;
  const factorAjustePct = input.rentabilidadObjetivoPct / 100;
  const precioVentaKg = precioBaseKgRendido * (1 + factorAjustePct);
  let ventaTotalEjemplo = 0;

  const cortes = input.cortes.map((corte) => {
    const importe = corte.kgRendimiento * precioVentaKg;
    ventaTotalEjemplo += importe;
    return {
      id: corte.id,
      nombre: corte.nombre,
      kgRendimiento: corte.kgRendimiento,
      precioVentaKg,
      factorAjustePct,
      importe,
    };
  });

  return {
    nombre: input.nombre,
    costoTotal,
    kgRendimientoTotal,
    rendimientoPct: (kgRendimientoTotal / input.pesoTotalKg) * 100,
    precioBaseKgRendido,
    ventaTotalEjemplo,
    rentabilidadEjemploPct: (ventaTotalEjemplo / costoTotal - 1) * 100,
    cortes,
  };
}

export function calcular4Estrategias(input: DespieceInput): DespieceResultado {
  validarDespieceInput(input);

  const costoTotal = input.costoKgPadre * input.pesoTotalKg;
  const kgRendimientoTotal = input.cortes.reduce((acc, corte) => acc + corte.kgRendimiento, 0);
  const precioBaseKgRendido = costoTotal / kgRendimientoTotal;

  const cortesVariable = input.cortes.map((corte) => {
    const factorAjustePct = corte.factorAjustePct ?? 0;
    const precioKg = precioBaseKgRendido * (1 + factorAjustePct);
    return { corte, factorAjustePct, precioKg, importe: corte.kgRendimiento * precioKg };
  });

  const ventaTotalVariable = cortesVariable.reduce((acc, corte) => acc + corte.importe, 0);
  const rentabilidadVariable = ventaTotalVariable / costoTotal - 1;
  const factorEscalaRentabilidadFija =
    (1 + input.rentabilidadObjetivoPct / 100) / (1 + rentabilidadVariable);

  let ventaTotalFija = 0;
  let ventaTotalAnclada = 0;

  const cortes: DespieceCorteResultado[] = cortesVariable.map(
    ({ corte, factorAjustePct, precioKg: precioVariable, importe: importeVariable }) => {
      const precioFijo = precioVariable * factorEscalaRentabilidadFija;
      const importeFijo = corte.kgRendimiento * precioFijo;
      const precioAnclado = corte.precioAnclado ?? null;
      const importeAnclado = precioAnclado == null ? 0 : corte.kgRendimiento * precioAnclado;
      const precioCorreccion = corte.precioCorreccion ?? null;

      ventaTotalFija += importeFijo;
      ventaTotalAnclada += importeAnclado;

      return {
        id: corte.id,
        nombre: corte.nombre,
        kgRendimiento: corte.kgRendimiento,
        factorAjustePct,
        participacionRendimientoPct: (corte.kgRendimiento / input.pesoTotalKg) * 100,
        variable: {
          precioKg: precioVariable,
          importe: importeVariable,
        },
        fija: {
          precioKg: precioFijo,
          importe: importeFijo,
        },
        anclada: {
          precioKg: precioAnclado,
          importe: importeAnclado,
        },
        correccion: {
          precioKg: precioCorreccion,
          desvioSobreBasePct:
            precioCorreccion == null ? null : (precioCorreccion / precioBaseKgRendido - 1) * 100,
        },
      };
    },
  );

  return {
    nombre: input.nombre,
    kgRendimientoTotal,
    rendimientoPct: (kgRendimientoTotal / input.pesoTotalKg) * 100,
    costoTotal,
    precioBaseKgRendido,
    factorEscalaRentabilidadFija,
    resumen: {
      variable: calcularResumen(costoTotal, input.pesoTotalKg, ventaTotalVariable),
      fija: calcularResumen(costoTotal, input.pesoTotalKg, ventaTotalFija),
      anclada: calcularResumen(costoTotal, input.pesoTotalKg, ventaTotalAnclada),
    },
    cortes,
  };
}
