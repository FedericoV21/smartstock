import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { parsearJsonFacturaGemini, validarTotalesFactura } from './extraccion';
import { construirHojasFacturaVision, fusionarPayloadsFactura } from './multipagina';

const baseFactura = {
  tipo_comprobante: 'factura_a',
  letra: 'A',
  punto_venta: '0003',
  numero: '00002995',
  fecha_emision: '2026-05-08',
  fecha_vencimiento: null,
  emisor: {
    razon_social: 'VAL-UR',
    cuit: '27260512078',
    domicilio: null,
    condicion_iva: 'responsable_inscripto',
    ingresos_brutos: null,
    inicio_actividades: null,
  },
  receptor: {
    razon_social: 'LUNA CESAR JAVIER - CHAVO',
    cuit_dni: '20293777676',
    domicilio: 'MEXICO 208',
    condicion_iva: 'responsable_inscripto',
  },
  iva_10_5: null,
  iva_27: null,
  percepcion_iibb: null,
  percepcion_iva: null,
  impuesto_interno: null,
  otros_impuestos: null,
  condicion_pago: 'Contado',
  cae: '86194679171578',
  cae_vencimiento: '2026-05-18',
  observaciones: null,
};

describe('parsearJsonFacturaGemini', () => {
  it('tolera texto alrededor, fence markdown y comas finales en el JSON del modelo', () => {
    const raw = [
      'Claro, este es el JSON extraido:',
      '```json',
      JSON.stringify({
        ...baseFactura,
        items: [
          {
            codigo: 'ABC',
            descripcion: 'PRODUCTO FACTURA',
            cantidad: 2,
            unidad: 'unidad',
            precio_unitario: 100,
            bonificacion: null,
            subtotal: 200,
          },
        ],
        subtotal: 200,
        iva_21: 42,
        total: 242,
      }, null, 2)
        .replace(/\n  \]/, '\n  ],')
        .replace(/\n\}/, '\n,}'),
      '```',
      'Listo.',
    ].join('\n');

    const parsed = parsearJsonFacturaGemini(raw);

    expect(parsed.numero).toBe(2995);
    expect(parsed.items[0]).toMatchObject({
      codigo: 'ABC',
      descripcion: 'PRODUCTO FACTURA',
      cantidad: 2,
      subtotal: 200,
    });
    expect(parsed.total).toBe(242);
  });

  it('parsea montos argentinos como string sin convertir presentaciones x gramos en cantidad', () => {
    const parsed = parsearJsonFacturaGemini(JSON.stringify({
      ...baseFactura,
      items: [
        {
          codigo: '116',
          descripcion: 'NUEZ MARIPOSA X 100 GR (P)',
          cantidad: '8',
          unidad: null,
          precio_unitario: '2.196,91',
          bonificacion: '0,00',
          subtotal: '17.575,27',
        },
      ],
      subtotal: '294.152,02',
      iva_21: '61.771,92',
      total: '355.923,94',
    }));

    expect(parsed.punto_venta).toBe(3);
    expect(parsed.numero).toBe(2995);
    expect(parsed.items[0]).toMatchObject({
      codigo: '116',
      descripcion: 'NUEZ MARIPOSA X 100 GR (P)',
      cantidad: 8,
      precio_unitario: 2196.91,
      bonificacion: 0,
      subtotal: 17575.27,
    });
    expect(parsed.total).toBe(355923.94);
  });

  it('extrae percepciones IIBB/IVA y las considera en el total', () => {
    const parsed = parsearJsonFacturaGemini(JSON.stringify({
      ...baseFactura,
      items: [
        {
          codigo: '611',
          descripcion: 'LYSOFORM AEROSOL FRUTOS DEL',
          cantidad: 12,
          unidad: 'cajas',
          precio_unitario: 1341.48,
          bonificacion: 35,
          subtotal: 10464.54,
        },
        {
          codigo: '1118',
          descripcion: 'MR MUSCULO PLATINUM DP 450ML',
          cantidad: 15,
          unidad: 'cajas',
          precio_unitario: 1983.14,
          bonificacion: 20,
          subtotal: 23797.71,
        },
      ],
      subtotal: '109.853,67',
      iva_21: '23.069,27',
      percepcion_iibb: '4.394,15',
      percepcion_iva: '3.295,61',
      total: '140.612,70',
    }));

    expect(parsed.percepcion_iibb).toBe(4394.15);
    expect(parsed.percepcion_iva).toBe(3295.61);

    const validacion = validarTotalesFactura({
      ...parsed,
      items: [
        { ...parsed.items[0]!, subtotal: 109853.67 },
      ],
    });

    expect(validacion.totales_cuadran).toBe(true);
    expect(validacion.advertencias).toEqual([]);
  });

  it('extrae impuesto interno y lo considera en el total', () => {
    const parsed = parsearJsonFacturaGemini(JSON.stringify({
      ...baseFactura,
      items: [
        {
          codigo: null,
          descripcion: 'MARLBORO BOX',
          cantidad: 60,
          unidad: null,
          precio_unitario: 8544.64,
          bonificacion: null,
          subtotal: 512678.17,
        },
      ],
      subtotal: '512.678,17',
      iva_21: '107.662,42',
      percepcion_iibb: '97.284,90',
      impuesto_interno: '1.919.444,37',
      total: '2.637.069,86',
    }));

    expect(parsed.impuesto_interno).toBe(1919444.37);
    expect(validarTotalesFactura(parsed).totales_cuadran).toBe(true);
  });

  it('corrige PU a precio final cuando el subtotal no cuadra con P.UNITARIO', () => {
    const parsed = parsearJsonFacturaGemini(JSON.stringify({
      ...baseFactura,
      items: [
        {
          codigo: null,
          descripcion: 'GALLETA RELLENA CHOCO BAUDUCCO 30X1',
          cantidad: '3.00',
          unidad: null,
          precio_unitario: 1155.62,
          bonificacion: null,
          subtotal: 3189.51,
        },
      ],
      subtotal: 59561.48,
      iva_21: 12507.91,
      total: 72069.39,
    }));

    expect(parsed.items[0]?.cantidad).toBe(3);
    expect(parsed.items[0]?.precio_unitario).toBe(1063.17);
    expect(parsed.items[0]?.subtotal).toBe(3189.51);
  });

  it('detecta una lectura alucinada de costos unitarios cuando los renglones no suman al total impreso', () => {
    const parsed = parsearJsonFacturaGemini(JSON.stringify({
      ...baseFactura,
      emisor: {
        ...baseFactura.emisor,
        razon_social: 'LUCAS IVAN MOLINA',
        cuit: '20374798635',
      },
      numero: '00007754',
      items: [
        {
          codigo: null,
          descripcion: 'KINDER BUENO',
          cantidad: 6,
          unidad: null,
          precio_unitario: 790.17,
          bonificacion: null,
          subtotal: 4741.02,
        },
        {
          codigo: null,
          descripcion: 'TIC TAC MIX FRUTAS X12',
          cantidad: 6,
          unidad: null,
          precio_unitario: 114.45,
          bonificacion: null,
          subtotal: 686.7,
        },
        {
          codigo: null,
          descripcion: 'NESTLE DOLCA BANANITA CHICA 12(16X1)',
          cantidad: 6,
          unidad: null,
          precio_unitario: 114.45,
          bonificacion: null,
          subtotal: 686.7,
        },
        {
          codigo: null,
          descripcion: 'NESTLE DOLCA BANANITA GRANDE 12(16X)',
          cantidad: 6,
          unidad: null,
          precio_unitario: 114.45,
          bonificacion: null,
          subtotal: 686.7,
        },
        {
          codigo: null,
          descripcion: 'KIT KAT 4 FINGER LECHE 4 (24X41,5G)',
          cantidad: 6,
          unidad: null,
          precio_unitario: 1550.98,
          bonificacion: null,
          subtotal: 9305.9,
        },
      ],
      subtotal: 59561.48,
      iva_21: 12507.91,
      total: 72069.39,
    }));

    const validacion = validarTotalesFactura(parsed);

    expect(validacion.items_cuadran).toBe(false);
    expect(validacion.totales_cuadran).toBe(false);
    expect(validacion.suma_items).toBe(16107.02);
    expect(validacion.referencia_items).toBe(59561.48);
    expect(validacion.advertencias.join(' ')).toMatch(/renglones|tabla mal/i);
  });

  it('acepta renglones de Factura A cuando la suma coincide con el total a pagar', () => {
    const parsed = parsearJsonFacturaGemini(JSON.stringify({
      ...baseFactura,
      emisor: {
        ...baseFactura.emisor,
        razon_social: 'LUCAS IVAN MOLINA',
        cuit: '20374798635',
      },
      numero: '00007754',
      items: [
        { codigo: null, descripcion: 'PRINGLES ORIGINAL 12UN X 37G', cantidad: 3, unidad: null, precio_unitario: 2143.5, bonificacion: null, subtotal: 6430.51 },
        { codigo: null, descripcion: 'GALLETA RELLENA CHOCO BAUDUCCO 30X1', cantidad: 3, unidad: null, precio_unitario: 1063.17, bonificacion: null, subtotal: 3189.51 },
        { codigo: null, descripcion: 'GALLETA RELLENA FRESA BAUDUCCO 30X1', cantidad: 3, unidad: null, precio_unitario: 1063.17, bonificacion: null, subtotal: 3189.51 },
        { codigo: null, descripcion: 'COOKIES CHOCOLATE 24X60GR', cantidad: 3, unidad: null, precio_unitario: 790.17, bonificacion: null, subtotal: 2370.5 },
        { codigo: null, descripcion: 'COOKIES ORIGINAL 24X60GR', cantidad: 3, unidad: null, precio_unitario: 790.17, bonificacion: null, subtotal: 2370.5 },
        { codigo: null, descripcion: 'KINDER BUENO', cantidad: 1, unidad: null, precio_unitario: 3109.66, bonificacion: null, subtotal: 3109.66 },
        { codigo: null, descripcion: 'TIC TAC MIX FRUTAS X12', cantidad: 1, unidad: null, precio_unitario: 11688.41, bonificacion: null, subtotal: 11688.41 },
        { codigo: null, descripcion: 'NESTLE DOLCA BANANITA CHICA 12(16X1)', cantidad: 1, unidad: null, precio_unitario: 11150.05, bonificacion: null, subtotal: 11150.05 },
        { codigo: null, descripcion: 'NESTLE DOLCA BANANITA GRANDE 12(16X)', cantidad: 1, unidad: null, precio_unitario: 19264.84, bonificacion: null, subtotal: 19264.84 },
        { codigo: null, descripcion: 'KIT KAT 4 FINGER LECHE 4 (24X41,5G)', cantidad: 6, unidad: null, precio_unitario: 1550.98, bonificacion: null, subtotal: 9305.9 },
      ],
      subtotal: 59561.48,
      iva_21: 12507.91,
      total: 72069.39,
    }));

    const validacion = validarTotalesFactura(parsed);

    expect(validacion.items_cuadran).toBe(true);
    expect(validacion.totales_cuadran).toBe(true);
    expect(validacion.suma_items).toBe(72069.39);
    expect(validacion.advertencias).toEqual([]);
  });
});

describe('fusionarPayloadsFactura', () => {
  it('concatena items en orden y toma los totales de la ultima hoja', () => {
    const hoja1 = parsearJsonFacturaGemini(JSON.stringify({
      ...baseFactura,
      numero: null,
      items: [
        {
          codigo: 'A1',
          descripcion: 'Producto primera hoja',
          cantidad: 1,
          unidad: null,
          precio_unitario: 100,
          bonificacion: null,
          subtotal: 100,
        },
      ],
      subtotal: null,
      iva_21: null,
      total: null,
      cae: null,
      condicion_pago: null,
    }));
    const hoja2 = parsearJsonFacturaGemini(JSON.stringify({
      ...baseFactura,
      numero: '00001234',
      items: [
        {
          codigo: 'B2',
          descripcion: 'Producto segunda hoja',
          cantidad: 2,
          unidad: null,
          precio_unitario: 100,
          bonificacion: null,
          subtotal: 200,
        },
      ],
      subtotal: 300,
      iva_21: 63,
      total: 363,
      cae: '12345678901234',
      condicion_pago: 'Cuenta corriente',
    }));

    const merged = fusionarPayloadsFactura([hoja1, hoja2]);

    expect(merged.items.map((it) => it.codigo)).toEqual(['A1', 'B2']);
    expect(merged.numero).toBe(1234);
    expect(merged.subtotal).toBe(300);
    expect(merged.iva_21).toBe(63);
    expect(merged.total).toBe(363);
    expect(merged.cae).toBe('12345678901234');
    expect(merged.condicion_pago).toBe('Cuenta corriente');
    expect(validarTotalesFactura(merged).totales_cuadran).toBe(true);
  });

  it('completa cabecera, emisor y receptor desde hojas posteriores si faltan en la primera', () => {
    const hojaSinCabecera = parsearJsonFacturaGemini(JSON.stringify({
      ...baseFactura,
      punto_venta: null,
      numero: null,
      fecha_emision: null,
      emisor: {
        razon_social: null,
        cuit: null,
        domicilio: null,
        condicion_iva: null,
        ingresos_brutos: null,
        inicio_actividades: null,
      },
      receptor: {
        razon_social: null,
        cuit_dni: null,
        domicilio: null,
        condicion_iva: null,
      },
      items: [
        { codigo: 'A1', descripcion: 'Producto', cantidad: 1, unidad: null, precio_unitario: 100, bonificacion: null, subtotal: 100 },
      ],
      subtotal: null,
      iva_21: null,
      total: null,
    }));
    const hojaConCabecera = parsearJsonFacturaGemini(JSON.stringify({
      ...baseFactura,
      punto_venta: '0007',
      numero: '00008888',
      fecha_emision: '2026-05-10',
      items: [],
      subtotal: 100,
      iva_21: 21,
      total: 121,
    }));

    const merged = fusionarPayloadsFactura([hojaSinCabecera, hojaConCabecera]);

    expect(merged.punto_venta).toBe(7);
    expect(merged.numero).toBe(8888);
    expect(merged.fecha_emision).toBe('2026-05-10');
    expect(merged.emisor.razon_social).toBe(baseFactura.emisor.razon_social);
    expect(merged.emisor.cuit).toBe(baseFactura.emisor.cuit);
    expect(merged.receptor.cuit_dni).toBe(baseFactura.receptor.cuit_dni);
  });

  it('mantiene advertencia si las hojas fusionadas no cuadran contra los totales', () => {
    const hoja1 = parsearJsonFacturaGemini(JSON.stringify({
      ...baseFactura,
      items: [
        { codigo: 'A1', descripcion: 'Producto', cantidad: 1, unidad: null, precio_unitario: 100, bonificacion: null, subtotal: 100 },
      ],
      subtotal: null,
      iva_21: null,
      total: null,
    }));
    const hoja2 = parsearJsonFacturaGemini(JSON.stringify({
      ...baseFactura,
      items: [],
      subtotal: 500,
      iva_21: 105,
      total: 605,
    }));

    const validacion = validarTotalesFactura(fusionarPayloadsFactura([hoja1, hoja2]));

    expect(validacion.items_cuadran).toBe(false);
    expect(validacion.totales_cuadran).toBe(false);
    expect(validacion.diferencia_items).toBe(-400);
    expect(validacion.advertencias.join(' ')).toMatch(/renglones|tabla mal/i);
  });
});

describe('construirHojasFacturaVision', () => {
  it('parte un PDF de dos paginas en dos hojas visionables ordenadas', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    pdf.addPage([200, 200]);
    const bytes = await pdf.save();

    const hojas = await construirHojasFacturaVision([
      {
        name: 'factura.pdf',
        type: 'application/pdf',
        size: bytes.byteLength,
        bytes,
      },
    ]);

    expect(hojas).toHaveLength(2);
    expect(hojas.map((h) => h.indice)).toEqual([0, 1]);
    expect(hojas.map((h) => h.pagina)).toEqual([1, 2]);
    expect(hojas.every((h) => h.mimeType === 'application/pdf')).toBe(true);
  });
});
