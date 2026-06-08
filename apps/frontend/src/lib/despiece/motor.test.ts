import { describe, expect, it } from 'vitest';

import {
  calibrarFactoresDesdeEjemplo,
  calcular4Estrategias,
  calcularFactoresPorRentabilidadObjetivo,
  DespieceValidationError,
} from './index';
import { PLANTILLAS_DESPIECE_PREDETERMINADAS } from './predeterminadas';
import type { DespieceInput } from './tipos';

const cerdoReyes: DespieceInput = {
  nombre: 'Media de cerdo Reyes',
  costoKgPadre: 2900,
  pesoTotalKg: 47,
  rentabilidadObjetivoPct: 50,
  cortes: [
    { nombre: 'matambre de cerdo', kgRendimiento: 1.65, factorAjustePct: 0.8055555, precioAnclado: 8500, precioCorreccion: 8000 },
    { nombre: 'vacio', kgRendimiento: 1.675, factorAjustePct: 0.6664, precioAnclado: 7000 },
    { nombre: 'costillar', kgRendimiento: 5.33, factorAjustePct: 0.3887, precioAnclado: 6500 },
    { nombre: 'paleta s/p', kgRendimiento: 6.2, factorAjustePct: 0.1109, precioAnclado: 4800 },
    { nombre: 'bondiola s/h', kgRendimiento: 2.7, factorAjustePct: 0.8053, precioAnclado: 8000 },
    { nombre: 'jamon s/h', kgRendimiento: 11.1, factorAjustePct: 0.3887, precioAnclado: 6500 },
    { nombre: 'carre sin cuero', kgRendimiento: 6.6, factorAjustePct: 0.3331, precioAnclado: 6500 },
    { nombre: 'patita', kgRendimiento: 0.6, factorAjustePct: -0.5, precioAnclado: 1000 },
    { nombre: 'recorte y papada', kgRendimiento: 2, factorAjustePct: -0.1, precioAnclado: 5200 },
  ],
};

const polloReyes: DespieceInput = {
  nombre: 'Pollo Reyes',
  costoKgPadre: 48000,
  pesoTotalKg: 2,
  rentabilidadObjetivoPct: 70,
  cortes: [
    { nombre: 'Pechuga deshuesada', kgRendimiento: 5.3, factorAjustePct: 1.9, precioAnclado: 7900, precioCorreccion: 10000 },
    { nombre: 'Carcaza', kgRendimiento: 2.4, factorAjustePct: -0.63, precioAnclado: 1000 },
    { nombre: 'Pata muslo', kgRendimiento: 18.4, factorAjustePct: -0.04, precioAnclado: 3056 },
    { nombre: 'Alita', kgRendimiento: 3.2, factorAjustePct: -0.5, precioAnclado: 2800 },
    { nombre: 'Menudo', kgRendimiento: 1.3, factorAjustePct: -0.63, precioAnclado: 1000 },
    { nombre: 'Milanesa', kgRendimiento: 10.05, factorAjustePct: 0.7, precioAnclado: 4520 },
  ],
};

const vacunoReyes: DespieceInput = {
  nombre: 'Media vacuna Reyes',
  costoKgPadre: 6400,
  pesoTotalKg: 118,
  rentabilidadObjetivoPct: 20,
  cortes: [
    { nombre: 'Arañita', kgRendimiento: 0.5, factorAjustePct: 0.3185, precioAnclado: 11000, precioCorreccion: 10000 },
    { nombre: 'Asado', kgRendimiento: 10.35, factorAjustePct: 0.397, precioAnclado: 9900 },
    { nombre: 'Asado punta', kgRendimiento: 3.45, factorAjustePct: 0.3966265060240961, precioAnclado: 7800 },
    { nombre: 'Bife ancho', kgRendimiento: 4.42, factorAjustePct: 0.10566265060240942, precioAnclado: 9530 },
    { nombre: 'Bife angosto', kgRendimiento: 10.74, factorAjustePct: 0.10566265060240942, precioAnclado: 9530 },
    { nombre: 'Bola de lomo', kgRendimiento: 3.84, factorAjustePct: 0.43542168674698756, precioAnclado: 11000 },
    { nombre: 'Chiquizuela', kgRendimiento: 0.55, factorAjustePct: -0.06891566265060256, precioAnclado: 2000 },
    { nombre: 'Colita de cuadril', kgRendimiento: 1.4, factorAjustePct: 0.5130120481927707, precioAnclado: 12000 },
    { nombre: 'Cuadrada', kgRendimiento: 3.8, factorAjustePct: 0.47421686746987923, precioAnclado: 11000 },
    { nombre: 'Cuadril', kgRendimiento: 3.6, factorAjustePct: 0.5130120481927707, precioAnclado: 11000 },
    { nombre: 'Entraña', kgRendimiento: 0.54, factorAjustePct: 0.5324096385542165, precioAnclado: 14000 },
    { nombre: 'Espinazo p.', kgRendimiento: 1.425, factorAjustePct: -0.6120481927710844, precioAnclado: 2000 },
    { nombre: 'Falda', kgRendimiento: 3.2, factorAjustePct: 0.06686746987951775, precioAnclado: 7800 },
    { nombre: 'Lomo', kgRendimiento: 1.91, factorAjustePct: 0.5906024096385538, precioAnclado: 12500 },
    { nombre: 'Matambre', kgRendimiento: 1.45, factorAjustePct: 0.319036144578313, precioAnclado: 10000 },
    { nombre: 'Nalga', kgRendimiento: 4.86, factorAjustePct: 0.5906024096385538, precioAnclado: 11500 },
    { nombre: 'Osobuco', kgRendimiento: 4.675, factorAjustePct: -0.06891566265060256, precioAnclado: 7500 },
    { nombre: 'Paleta', kgRendimiento: 5, factorAjustePct: 0.3966265060240961, precioAnclado: 11000 },
    { nombre: 'Palomita', kgRendimiento: 5, factorAjustePct: 0.3966265060240961, precioAnclado: 11000 },
    { nombre: 'Peceto', kgRendimiento: 1.96, factorAjustePct: 0.5906024096385538, precioAnclado: 11500 },
    { nombre: 'Punta de falda', kgRendimiento: 1.76, factorAjustePct: -0.7090361445783133, precioAnclado: 2000 },
    { nombre: 'Picada', kgRendimiento: 6.525, factorAjustePct: -0.12710843373493996, precioAnclado: 5887 },
    { nombre: 'Roast beef', kgRendimiento: 4.88, factorAjustePct: 0.37722891566265027, precioAnclado: 11000 },
    { nombre: 'Tapa de asado', kgRendimiento: 3.61, factorAjustePct: 0.3966265060240961, precioAnclado: 10000 },
    { nombre: 'Tapa de nalga', kgRendimiento: 1.6, factorAjustePct: 0.3966265060240961, precioAnclado: 10000 },
    { nombre: 'Tortuguita', kgRendimiento: 1.54, factorAjustePct: 0.37722891566265027, precioAnclado: 10000 },
    { nombre: 'Vacio', kgRendimiento: 5.425, factorAjustePct: 0.5518072289156624, precioAnclado: 12500 },
  ],
};

describe('calcular4Estrategias', () => {
  it('calibra factores desde un ejemplo real con precios vendidos por corte', () => {
    const calibracion = calibrarFactoresDesdeEjemplo({
      nombre: 'Media res de prueba',
      costoKgPadre: 100,
      pesoTotalKg: 10,
      cortes: [
        { nombre: 'Corte premium', kgRendimiento: 5, precioVentaKg: 200 },
        { nombre: 'Corte economico', kgRendimiento: 5, precioVentaKg: 50 },
      ],
    });

    expect(calibracion.precioBaseKgRendido).toBeCloseTo(100, 6);
    expect(calibracion.rentabilidadEjemploPct).toBeCloseTo(25, 6);
    expect(calibracion.cortes[0].factorAjustePct).toBeCloseTo(1, 6);
    expect(calibracion.cortes[1].factorAjustePct).toBeCloseTo(-0.5, 6);

    const resultado = calcular4Estrategias({
      costoKgPadre: 100,
      pesoTotalKg: 10,
      rentabilidadObjetivoPct: 25,
      cortes: calibracion.cortes.map((corte) => ({
        nombre: corte.nombre,
        kgRendimiento: corte.kgRendimiento,
        factorAjustePct: corte.factorAjustePct,
      })),
    });

    expect(resultado.cortes[0].variable.precioKg).toBeCloseTo(200, 6);
    expect(resultado.cortes[1].variable.precioKg).toBeCloseTo(50, 6);
  });

  it('calcula precio parejo para un cajon de pollo con rentabilidad objetivo', () => {
    const calibracion = calcularFactoresPorRentabilidadObjetivo({
      nombre: 'Cajon de Pollo',
      costoKgPadre: 3000,
      pesoTotalKg: 18,
      rentabilidadObjetivoPct: 60,
      cortes: [
        { nombre: 'Pata muslo', kgRendimiento: 7.6 },
        { nombre: 'Suprema de Pollo', kgRendimiento: 5.2 },
        { nombre: 'Alita', kgRendimiento: 2.9 },
        { nombre: 'Carcaza', kgRendimiento: 0.5 },
        { nombre: 'Menudo', kgRendimiento: 0.9 },
      ],
    });

    expect(calibracion.kgRendimientoTotal).toBeCloseTo(17.1, 6);
    expect(calibracion.precioBaseKgRendido).toBeCloseTo(3157.8947368, 6);
    expect(calibracion.cortes[0].precioVentaKg).toBeCloseTo(5052.6315789, 6);
    expect(calibracion.cortes.every((corte) => corte.factorAjustePct === 0.6)).toBe(true);
    expect(calibracion.ventaTotalEjemplo).toBeCloseTo(86400, 6);
    expect(calibracion.rentabilidadEjemploPct).toBeCloseTo(60, 6);

    const resultado = calcular4Estrategias({
      costoKgPadre: 3000,
      pesoTotalKg: 18,
      rentabilidadObjetivoPct: 60,
      cortes: calibracion.cortes.map((corte) => ({
        nombre: corte.nombre,
        kgRendimiento: corte.kgRendimiento,
        factorAjustePct: corte.factorAjustePct,
      })),
    });

    expect(resultado.resumen.fija.rentabilidadPct).toBeCloseTo(60, 6);
    expect(resultado.resumen.variable.rentabilidadPct).toBeCloseTo(60, 6);
    expect(resultado.cortes[1].fija.precioKg).toBeCloseTo(5052.6315789, 6);
  });

  it('reproduce los totales de cerdo de Carnicerias.xlsx', () => {
    const resultado = calcular4Estrategias(cerdoReyes);

    expect(resultado.kgRendimientoTotal).toBeCloseTo(37.855, 3);
    expect(resultado.precioBaseKgRendido).toBeCloseTo(3600.581165, 3);
    expect(resultado.resumen.variable.ventaTotal).toBeCloseTo(184519.2623, 1);
    expect(resultado.resumen.variable.rentabilidadPct).toBeCloseTo(35.37730174, 3);
    expect(resultado.resumen.fija.rentabilidadPct).toBeCloseTo(50, 6);
    expect(resultado.resumen.anclada.precioPromedioKgPadre).toBeCloseTo(5059.680851, 3);
    expect(resultado.resumen.anclada.rentabilidadPct).toBeCloseTo(74.47175348, 3);
    expect(resultado.cortes[0].variable.precioKg).toBeCloseTo(6501.049126, 3);
    expect(resultado.cortes[0].correccion.desvioSobreBasePct).toBeCloseTo(122.1863536, 3);
  });

  it('reproduce los totales de pollo de Carnicerias.xlsx', () => {
    const resultado = calcular4Estrategias(polloReyes);

    expect(resultado.kgRendimientoTotal).toBeCloseTo(40.65, 3);
    expect(resultado.precioBaseKgRendido).toBeCloseTo(2361.623616, 3);
    expect(resultado.resumen.variable.ventaTotal).toBeCloseTo(125373.8745, 1);
    expect(resultado.resumen.variable.rentabilidadPct).toBeCloseTo(30.59778598, 3);
    expect(resultado.resumen.fija.rentabilidadPct).toBeCloseTo(70, 6);
    expect(resultado.resumen.anclada.precioPromedioKgPadre).toBeCloseTo(78093.2, 1);
    expect(resultado.resumen.anclada.rentabilidadPct).toBeCloseTo(62.69416667, 3);
  });

  it('reproduce los totales de vacuno de Carnicerias.xlsx', () => {
    const resultado = calcular4Estrategias(vacunoReyes);

    expect(resultado.kgRendimientoTotal).toBeCloseTo(98.01, 3);
    expect(resultado.precioBaseKgRendido).toBeCloseTo(7705.33619, 3);
    expect(resultado.resumen.variable.ventaTotal).toBeCloseTo(967374.6247, 1);
    expect(resultado.resumen.variable.rentabilidadPct).toBeCloseTo(28.09515687, 3);
    expect(resultado.resumen.fija.rentabilidadPct).toBeCloseTo(20, 6);
    expect(resultado.resumen.anclada.precioPromedioKgPadre).toBeCloseTo(8042.817585, 3);
    expect(resultado.resumen.anclada.rentabilidadPct).toBeCloseTo(25.66902476, 3);
  });

  it('reproduce los totales de Media Res / Luz desde la imagen de ejemplo', () => {
    const plantilla = PLANTILLAS_DESPIECE_PREDETERMINADAS.find((p) => p.slug === 'media-res-luz');
    expect(plantilla).toBeTruthy();

    const resultado = calcular4Estrategias({
      nombre: plantilla!.nombre,
      costoKgPadre: plantilla!.padre.costoKg,
      pesoTotalKg: plantilla!.padre.pesoTotalKg,
      rentabilidadObjetivoPct: plantilla!.rentabilidadObjetivoPct,
      cortes: plantilla!.cortes.map((corte) => ({
        nombre: corte.nombre,
        kgRendimiento: corte.kgRendimiento,
        factorAjustePct: corte.factorAjustePct,
        precioAnclado: corte.precioAnclado,
      })),
    });

    expect(resultado.costoTotal).toBeCloseTo(1153290, 2);
    expect(resultado.kgRendimientoTotal).toBeCloseTo(107.025, 3);
    expect(resultado.precioBaseKgRendido).toBeCloseTo(10775.893483, 3);
    expect(resultado.resumen.variable.ventaTotal).toBeCloseTo(1506435, 2);
    expect(resultado.resumen.variable.gananciaBruta).toBeCloseTo(353145, 2);
    expect(resultado.resumen.variable.rentabilidadPct).toBeCloseTo(30.620659, 4);
    expect(resultado.resumen.anclada.ventaTotal).toBeCloseTo(1506435, 2);
    expect(resultado.cortes.find((corte) => corte.nombre === 'Desperdicio')?.anclada.importe).toBe(0);
  });

  it('reproduce los totales de las planillas normalizadas de noviembre 25', () => {
    const casos = [
      {
        slug: 'media-res-nt-nov25',
        costoTotal: 410700,
        kgRendimientoTotal: 107.88,
        ventaTotal: 539958.775,
        rentabilidadPct: 31.47,
      },
      {
        slug: 'media-res-res-nov25',
        costoTotal: 1123500,
        kgRendimientoTotal: 111.604,
        ventaTotal: 1468334,
        rentabilidadPct: 30.69,
      },
      {
        slug: 'cajon-pollo-nov25',
        costoTotal: 70000,
        kgRendimientoTotal: 17.8,
        ventaTotal: 98861.1,
        rentabilidadPct: 41.23,
      },
    ];

    for (const caso of casos) {
      const plantilla = PLANTILLAS_DESPIECE_PREDETERMINADAS.find((p) => p.slug === caso.slug);
      expect(plantilla).toBeTruthy();

      const resultado = calcular4Estrategias({
        nombre: plantilla!.nombre,
        costoKgPadre: plantilla!.padre.costoKg,
        pesoTotalKg: plantilla!.padre.pesoTotalKg,
        rentabilidadObjetivoPct: plantilla!.rentabilidadObjetivoPct,
        cortes: plantilla!.cortes.map((corte) => ({
          nombre: corte.nombre,
          kgRendimiento: corte.kgRendimiento,
          factorAjustePct: corte.factorAjustePct,
          precioAnclado: corte.precioAnclado,
        })),
      });

      expect(resultado.costoTotal).toBeCloseTo(caso.costoTotal, 2);
      expect(resultado.kgRendimientoTotal).toBeCloseTo(caso.kgRendimientoTotal, 3);
      expect(resultado.resumen.anclada.ventaTotal).toBeCloseTo(caso.ventaTotal, 2);
      expect(resultado.resumen.anclada.rentabilidadPct).toBeCloseTo(caso.rentabilidadPct, 2);
      expect(resultado.resumen.variable.ventaTotal).toBeCloseTo(caso.ventaTotal, 2);
    }
  });

  it('configura el cajon de pollo de noviembre 25 como unidad base', () => {
    const plantilla = PLANTILLAS_DESPIECE_PREDETERMINADAS.find((p) => p.slug === 'cajon-pollo-nov25');

    expect(plantilla?.padre.pesoTotalKg).toBe(19);
    expect(plantilla?.unidadBase).toEqual({
      tipo: 'unidad',
      nombre: 'cajon',
      cantidad: 1,
      contenedorNombre: null,
      unidadesPorContenedor: null,
    });
  });

  it('rechaza inputs que no cierran para evitar precios silenciosamente inválidos', () => {
    expect(() =>
      calcular4Estrategias({
        costoKgPadre: 0,
        pesoTotalKg: 47,
        rentabilidadObjetivoPct: 50,
        cortes: [{ nombre: 'Matambre', kgRendimiento: 0, factorAjustePct: -1.2 }],
      }),
    ).toThrow(DespieceValidationError);
  });
});
