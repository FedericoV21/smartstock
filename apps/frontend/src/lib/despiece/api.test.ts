import { describe, expect, it } from 'vitest';

import {
  costoCatalogoDesdePrecioVentaDespiece,
  parsePlantillaPayload,
  prepararCambiosCatalogoDespiece,
  resolverPesoIngresoKgDesdePayload,
  validarConflictosPluCatalogo,
  validarPlantillaPayload,
  validarProductosCorteElegibles,
  type CorteCatalogoSync,
  type DespiecePlantillaPayload,
  type PlantillaConRelaciones,
} from './api';
import { PLANTILLAS_DESPIECE_PREDETERMINADAS } from './predeterminadas';

const plantillaPollo: PlantillaConRelaciones = {
  id: 'plantilla-pollo',
  nombre: 'Cajon de pollo - 7 pollos',
  producto_padre_id: null,
  peso_total_kg: 18,
  unidad_base_tipo: 'unidad',
  unidad_base_nombre: 'pollos',
  unidad_base_cantidad: 7,
  unidad_contenedor_nombre: 'cajon',
  unidad_contenedor_cantidad: 7,
  rentabilidad_objetivo_pct: 70,
  activo: true,
  notas: null,
  created_at: '',
  updated_at: '',
  cortes: [],
};

describe('despiece unidad base', () => {
  it('convierte cantidad de pollos y cajones a kg equivalentes', () => {
    expect(resolverPesoIngresoKgDesdePayload(plantillaPollo, { cantidad_unidad_base: 7 }).pesoKg).toBeCloseTo(18, 6);
    expect(
      resolverPesoIngresoKgDesdePayload(plantillaPollo, {
        cantidad_contenedores: 1,
        unidades_por_contenedor: 10,
      }).pesoKg,
    ).toBeCloseTo(25.714286, 5);
  });

  it('mantiene la plantilla predeterminada de pollo basada en el cajon real de 7 pollos', () => {
    const plantilla = PLANTILLAS_DESPIECE_PREDETERMINADAS.find((p) => p.slug === 'cajon-pollo-7');

    expect(plantilla?.padre.pesoTotalKg).toBe(18);
    expect(plantilla?.unidadBase?.cantidad).toBe(7);
    expect(plantilla?.cortes.reduce((acc, corte) => acc + corte.kgRendimiento, 0)).toBeCloseTo(18, 3);
  });
});

const payloadBase: DespiecePlantillaPayload = {
  nombre: 'Media res',
  producto_padre_id: 'padre-1',
  peso_total_kg: 100,
  unidad_base_tipo: 'kg',
  unidad_base_nombre: null,
  unidad_base_cantidad: 1,
  unidad_contenedor_nombre: null,
  unidad_contenedor_cantidad: null,
  rentabilidad_objetivo_pct: 30,
  activo: true,
  notas: null,
  cortes: [
    {
      producto_hijo_id: 'corte-1',
      nombre_en_plantilla: 'Asado especial',
      plu_sugerido: '00123',
      kg_rendimiento: 20,
      factor_ajuste_pct: 0.1,
      precio_anclado: 5000,
      peso_promedio_unidad_kg: null,
      orden: 0,
    },
  ],
};

describe('despiece plantilla payload', () => {
  it('normaliza nombre de plantilla y PLU sugerido por corte', () => {
    const payload = parsePlantillaPayload({
      nombre: ' Media res ',
      producto_padre_id: 'padre-1',
      peso_total_kg: 100,
      unidad_base_tipo: 'kg',
      unidad_base_cantidad: 1,
      rentabilidad_objetivo_pct: 30,
      cortes: [
        {
          producto_hijo_id: 'corte-1',
          nombre_en_plantilla: ' Asado especial ',
          plu_sugerido: '12a',
          kg_rendimiento: 20,
        },
      ],
    });

    expect(payload.nombre).toBe('Media res');
    expect(payload.cortes?.[0].nombre_en_plantilla).toBe('Asado especial');
    expect(payload.cortes?.[0].plu_sugerido).toBe('00012');
  });

  it('rechaza cortes hijos repetidos', () => {
    const payload: DespiecePlantillaPayload = {
      ...payloadBase,
      cortes: [
        { ...payloadBase.cortes![0], producto_hijo_id: 'corte-1', orden: 0 },
        { ...payloadBase.cortes![0], producto_hijo_id: 'corte-1', orden: 1 },
      ],
    };

    expect(validarPlantillaPayload(payload)).toContain('producto repetido');
  });
});

describe('despiece productos de corte', () => {
  it('acepta solo productos activos, pesables y con unidad kg o gramo', () => {
    expect(
      validarProductosCorteElegibles(payloadBase.cortes!, [
        { id: 'corte-1', nombre: 'Asado', activo: true, es_pesable: true, unidad: 'kg' },
      ]),
    ).toBeNull();

    expect(
      validarProductosCorteElegibles(payloadBase.cortes!, [
        { id: 'corte-1', nombre: 'Asado', activo: false, es_pesable: true, unidad: 'kg' },
      ]),
    ).toContain('no esta activo');

    expect(
      validarProductosCorteElegibles(payloadBase.cortes!, [
        { id: 'corte-1', nombre: 'Asado', activo: true, es_pesable: false, unidad: 'kg' },
      ]),
    ).toContain('debe ser pesable');

    expect(
      validarProductosCorteElegibles(payloadBase.cortes!, [
        { id: 'corte-1', nombre: 'Asado', activo: true, es_pesable: true, unidad: 'unidad' },
      ]),
    ).toContain('debe ser pesable');
  });
});

describe('despiece sincronizacion catalogo', () => {
  const cortes: CorteCatalogoSync[] = [
    {
      producto_hijo_id: 'corte-1',
      nombre_en_plantilla: 'Asado premium',
      precio_anclado: 5100,
      plu_sugerido: '123',
      producto_hijo: {
        id: 'corte-1',
        nombre: 'Asado',
        precio_costo: 3000,
        precio_venta: 5000,
        plu: '00011',
        activo: true,
        es_pesable: true,
        unidad: 'kg',
      },
    },
  ];

  it('prepara cambios de nombre, precio, PLU y combinados', () => {
    expect(
      prepararCambiosCatalogoDespiece(cortes, [{ producto_id: 'corte-1', aplicar_nombre: true }]).cambios[0],
    ).toMatchObject({ nombre_nuevo: 'Asado premium' });

    expect(
      prepararCambiosCatalogoDespiece(
        cortes,
        [{ producto_id: 'corte-1', aplicar_precio: true, precio_nuevo: 5200 }],
        30,
      ).cambios[0],
    ).toMatchObject({ precio_nuevo: 5200, precio_costo_nuevo: 3619.91 });

    expect(
      prepararCambiosCatalogoDespiece(cortes, [{ producto_id: 'corte-1', aplicar_plu: true }]).cambios[0],
    ).toMatchObject({ plu_nuevo: '00123' });

    expect(
      prepararCambiosCatalogoDespiece(cortes, [
        { producto_id: 'corte-1', aplicar_nombre: true, aplicar_precio: true, aplicar_plu: true },
      ]).cambios[0],
    ).toMatchObject({ nombre_nuevo: 'Asado premium', precio_nuevo: 5100, plu_nuevo: '00123' });
  });

  it('no prepara cambios no solicitados y detecta conflictos de PLU', () => {
    expect(prepararCambiosCatalogoDespiece(cortes, [{ producto_id: 'corte-1' }]).cambios).toEqual([]);

    expect(
      validarConflictosPluCatalogo(
        [
          { producto_id: 'corte-1', plu_nuevo: '00123' },
          { producto_id: 'corte-2', plu_nuevo: '00123' },
        ],
        [],
      ),
    ).toContain('mas de un producto');

    expect(
      validarConflictosPluCatalogo([{ producto_id: 'corte-1', plu_nuevo: '00123' }], [
        { id: 'otro', nombre: 'Otro corte', plu: '00123' },
      ]),
    ).toContain('ya lo usa');
  });
});

describe('despiece costo de catalogo desde venta', () => {
  it('descuenta IVA 10.5 y margen de plantilla para sostener el margen visible', () => {
    expect(costoCatalogoDesdePrecioVentaDespiece(5735, 31.47)).toBeCloseTo(3947.7, 2);
  });
});
