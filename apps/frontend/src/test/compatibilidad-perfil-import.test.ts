import { describe, expect, it } from 'vitest';

import {
  analizarCompatibilidadPerfilImport,
  perfilTieneMapeoDeColumnas,
} from '@/lib/normalizador/compatibilidad-perfil-import';

describe('analizarCompatibilidadPerfilImport', () => {
  it('es compatible cuando todos los headers del perfil están en el archivo', () => {
    const out = analizarCompatibilidadPerfilImport(['COD', 'NOMBRE', 'OBS'], {
      mapeo: { codigo: 'COD', nombre: 'NOMBRE' },
      columnas_ignoradas: ['OBS'],
    });
    expect(out.compatible).toBe(true);
    expect(out.faltantes).toEqual([]);
    expect(out.columnasNuevasEnArchivo).toEqual([]);
  });

  it('detecta columnas esperadas ausentes', () => {
    const out = analizarCompatibilidadPerfilImport(['COD', 'DESCRIPCION'], {
      mapeo: { codigo: 'COD', nombre: 'NOMBRE' },
    });
    expect(out.compatible).toBe(false);
    expect(out.faltantes).toEqual([
      { campo: 'nombre', headerEsperado: 'NOMBRE' },
    ]);
  });

  it('lista encabezados nuevos no referenciados en el perfil', () => {
    const out = analizarCompatibilidadPerfilImport(['COD', 'NOMBRE', 'PRECIO_NUEVO'], {
      mapeo: { codigo: 'COD', nombre: 'NOMBRE' },
      columnas_ignoradas: [],
    });
    expect(out.compatible).toBe(true);
    expect(out.columnasNuevasEnArchivo).toEqual(['PRECIO_NUEVO']);
  });
});

describe('perfilTieneMapeoDeColumnas', () => {
  it('false sin perfil, con mapeo vacío o sólo valores nulos/blancos', () => {
    expect(perfilTieneMapeoDeColumnas(null)).toBe(false);
    expect(perfilTieneMapeoDeColumnas(undefined)).toBe(false);
    expect(perfilTieneMapeoDeColumnas({})).toBe(false);
    expect(perfilTieneMapeoDeColumnas({ mapeo: {} })).toBe(false);
    expect(perfilTieneMapeoDeColumnas({ mapeo: { nombre: null, codigo: '' } })).toBe(false);
  });

  it('true cuando hay al menos un encabezado asignado', () => {
    expect(perfilTieneMapeoDeColumnas({ mapeo: { nombre: '  Desc  ' } })).toBe(true);
    expect(perfilTieneMapeoDeColumnas({ mapeo: { codigo: 'SKU' } })).toBe(true);
  });
});
