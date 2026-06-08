export type DespieceCorteInput = {
  id?: string;
  nombre: string;
  kgRendimiento: number;
  /**
   * Factor decimal, igual que en la planilla: 0.8 = +80%, -0.5 = -50%.
   */
  factorAjustePct?: number;
  precioAnclado?: number | null;
  precioCorreccion?: number | null;
};

export type DespieceInput = {
  nombre?: string;
  costoKgPadre: number;
  pesoTotalKg: number;
  rentabilidadObjetivoPct: number;
  cortes: DespieceCorteInput[];
};

export type DespieceUnidadBaseTipo = 'kg' | 'unidad';

export type DespieceCorteEjemploInput = {
  id?: string;
  nombre: string;
  kgRendimiento: number;
  precioVentaKg: number;
};

export type DespieceCalibracionInput = {
  nombre?: string;
  costoKgPadre: number;
  pesoTotalKg: number;
  cortes: DespieceCorteEjemploInput[];
};

export type DespieceCalibracionObjetivoInput = {
  nombre?: string;
  costoKgPadre: number;
  pesoTotalKg: number;
  rentabilidadObjetivoPct: number;
  cortes: Array<Omit<DespieceCorteEjemploInput, 'precioVentaKg'>>;
};

export type DespieceEstrategia = 'variable' | 'fija' | 'anclada' | 'correccion';

export type DespieceCorteResultado = {
  id?: string;
  nombre: string;
  kgRendimiento: number;
  factorAjustePct: number;
  participacionRendimientoPct: number;
  variable: {
    precioKg: number;
    importe: number;
  };
  fija: {
    precioKg: number;
    importe: number;
  };
  anclada: {
    precioKg: number | null;
    importe: number;
  };
  correccion: {
    precioKg: number | null;
    desvioSobreBasePct: number | null;
  };
};

export type DespieceResumenEstrategia = {
  costoTotal: number;
  ventaTotal: number;
  gananciaBruta: number;
  precioPromedioKgPadre: number;
  rentabilidadPct: number;
};

export type DespieceResultado = {
  nombre?: string;
  kgRendimientoTotal: number;
  rendimientoPct: number;
  costoTotal: number;
  precioBaseKgRendido: number;
  factorEscalaRentabilidadFija: number;
  resumen: Record<Exclude<DespieceEstrategia, 'correccion'>, DespieceResumenEstrategia>;
  cortes: DespieceCorteResultado[];
};

export type DespieceCorteCalibrado = {
  id?: string;
  nombre: string;
  kgRendimiento: number;
  precioVentaKg: number;
  factorAjustePct: number;
  importe: number;
};

export type DespieceCalibracionResultado = {
  nombre?: string;
  costoTotal: number;
  kgRendimientoTotal: number;
  rendimientoPct: number;
  precioBaseKgRendido: number;
  ventaTotalEjemplo: number;
  rentabilidadEjemploPct: number;
  cortes: DespieceCorteCalibrado[];
};
