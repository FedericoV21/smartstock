import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import {
  columnasExportacionDesdeMapeo,
  nombreArchivoConvertido,
  tablaMapeadaACsv,
  tablaMapeadaAXlsxArrayBuffer,
} from '@/lib/importar/exportar-tabla-mapeada';
import type { MapeoColumna } from '@/lib/normalizador/mapear';

function col(
  headerOriginal: string,
  campoDetectado: MapeoColumna['campoDetectado'],
  opts?: Partial<MapeoColumna>,
): MapeoColumna {
  return {
    headerOriginal,
    campoDetectado,
    confianza: 'exacta',
    ignorar: false,
    ...opts,
  };
}

describe('exportar tabla mapeada', () => {
  it('genera CSV UTF-8 con columnas compatibles y valores escapados', () => {
    const mapeo = [
      col('COD ART', 'codigo'),
      col('DESCRIPCION', 'nombre'),
      col('Costo lista', 'precio_costo'),
      col('Notas proveedor', null, { ignorar: true }),
    ];
    const csv = tablaMapeadaACsv(
      [
        {
          'COD ART': 'A-1',
          DESCRIPCION: 'Jabon liquido, "premium"',
          'Costo lista': '1.234,56',
          'Notas proveedor': 'no sale',
        },
      ],
      mapeo,
    );

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('codigo,nombre,precio_costo');
    expect(csv).toContain('A-1,"Jabon liquido, ""premium""","1.234,56"');
    expect(csv).not.toContain('Notas proveedor');
    expect(csv).not.toContain('no sale');
  });

  it('incluye columnas sinteticas agregadas si estan mapeadas', () => {
    const mapeo = [
      col('Producto', 'nombre'),
      col('__ss_iva_porcentaje_123', 'iva_porcentaje', { sintetica: true }),
      col('__ss_porcentaje_ganancia_456', 'porcentaje_ganancia', { sintetica: true }),
    ];

    expect(columnasExportacionDesdeMapeo(mapeo)).toEqual([
      { campo: 'nombre', headerOriginal: 'Producto' },
      { campo: 'iva_porcentaje', headerOriginal: '__ss_iva_porcentaje_123' },
      { campo: 'porcentaje_ganancia', headerOriginal: '__ss_porcentaje_ganancia_456' },
    ]);

    const csv = tablaMapeadaACsv(
      [
        {
          Producto: 'Item',
          __ss_iva_porcentaje_123: 21,
          __ss_porcentaje_ganancia_456: 35,
        },
      ],
      mapeo,
    );

    expect(csv).toContain('nombre,iva_porcentaje,porcentaje_ganancia');
    expect(csv).toContain('Item,21,35');
  });

  it('genera XLSX con headers y filas editadas', () => {
    const mapeo = [
      col('Codigo original', 'codigo'),
      col('Nombre original', 'nombre'),
      col('Costo editado', 'precio_costo'),
      col('Ignorar', 'categoria', { ignorar: true }),
    ];

    const buffer = tablaMapeadaAXlsxArrayBuffer(
      [
        {
          'Codigo original': 'SKU-9',
          'Nombre original': 'Tornillo zincado',
          'Costo editado': 1500,
          Ignorar: 'Ferreteria',
        },
      ],
      mapeo,
    );

    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]!];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

    expect(rows).toEqual([
      {
        codigo: 'SKU-9',
        nombre: 'Tornillo zincado',
        precio_costo: 1500,
      },
    ]);
  });

  it('normaliza el nombre del archivo descargado', () => {
    expect(nombreArchivoConvertido('lista/proveedor?.pdf', 'xlsx')).toBe(
      'lista_proveedor_-convertida.xlsx',
    );
    expect(nombreArchivoConvertido('   ', 'csv')).toBe('lista-convertida.csv');
  });
});
