import { describe, expect, it } from 'vitest';

import {
  buscarEnCatalogoPos,
  listarCatalogoProveedorPos,
  rankPosCatalogoItem,
  type PosCatalogoBusquedaItem,
} from '@/lib/pos/catalogo-busqueda-local';

function item(overrides: Partial<PosCatalogoBusquedaItem>): PosCatalogoBusquedaItem {
  return {
    id: overrides.id ?? overrides.producto_id ?? 'p-1',
    producto_id: overrides.producto_id ?? overrides.id ?? 'p-1',
    producto_variante_id: overrides.producto_variante_id ?? null,
    codigo: overrides.codigo ?? 'SKU-1',
    codigo_barras: overrides.codigo_barras ?? null,
    plu: overrides.plu ?? null,
    nombre: overrides.nombre ?? 'Producto test',
    texto_buscable: overrides.texto_buscable ?? null,
    precio_venta: overrides.precio_venta ?? 100,
    stock_actual: overrides.stock_actual ?? 0,
    stock_minimo: overrides.stock_minimo ?? 0,
    unidad: overrides.unidad ?? 'unidad',
    sucursal_id: overrides.sucursal_id ?? 'suc-1',
    proveedor: overrides.proveedor ?? null,
    categoria: overrides.categoria ?? null,
    variante: overrides.variante ?? null,
  };
}

describe('busqueda local POS catalogo', () => {
  it('normaliza acentos y mayusculas al buscar por nombre', () => {
    const cafe = item({ id: 'p-cafe', nombre: 'Cafe molido premium' });

    expect(rankPosCatalogoItem(cafe, 'CAFÉ')).toBe(4);
  });

  it('prioriza codigo exacto por encima de coincidencias por nombre', () => {
    const rows = [
      item({ id: 'nombre', codigo: 'ABC', nombre: 'Yerba SKU-42' }),
      item({ id: 'codigo', codigo: 'SKU-42', nombre: 'Galletitas' }),
    ];

    expect(buscarEnCatalogoPos(rows, 'sku-42').map((x) => x.id)).toEqual(['codigo', 'nombre']);
  });

  it('encuentra variantes por codigo, barra y texto de atributos', () => {
    const rows = [
      item({
        id: 'camisa',
        producto_id: 'camisa',
        producto_variante_id: 'v-rojo-l',
        codigo: 'CAM-L-ROJO',
        codigo_barras: '7790000000011',
        nombre: 'Camisa - Rojo / L',
        texto_buscable: 'camisa cam-l-rojo 7790000000011 rojo l',
        variante: {
          id: 'v-rojo-l',
          codigo: 'CAM-L-ROJO',
          codigo_barras: '7790000000011',
          atributos: { color: 'Rojo', talle: 'L' },
          etiqueta: 'Rojo / L',
        },
      }),
    ];

    expect(buscarEnCatalogoPos(rows, '7790000000011')[0]?.producto_variante_id).toBe('v-rojo-l');
    expect(buscarEnCatalogoPos(rows, 'rojo')[0]?.producto_variante_id).toBe('v-rojo-l');
  });

  it('filtra por proveedor y deduplica por sucursal/stock', () => {
    const rows = [
      item({
        id: 'p-a',
        codigo: 'DUP-1',
        nombre: 'Dulce',
        stock_actual: 2,
        sucursal_id: 'suc-2',
        proveedor: { id: 'prov-1', nombre: 'Proveedor 1' },
      }),
      item({
        id: 'p-b',
        codigo: 'DUP-1',
        nombre: 'Dulce',
        stock_actual: 10,
        sucursal_id: 'suc-1',
        proveedor: { id: 'prov-1', nombre: 'Proveedor 1' },
      }),
      item({
        id: 'p-c',
        codigo: 'OTRO',
        nombre: 'Dulce otro proveedor',
        proveedor: { id: 'prov-2', nombre: 'Proveedor 2' },
      }),
    ];

    expect(
      buscarEnCatalogoPos(rows, 'dulce', { proveedorId: 'prov-1', sucursalId: 'suc-1' }).map(
        (x) => x.id,
      ),
    ).toEqual(['p-b']);
    expect(listarCatalogoProveedorPos(rows, { proveedorId: 'prov-2' }).map((x) => x.id)).toEqual([
      'p-c',
    ]);
  });

  it('encuentra PLU por numero entero sin ceros a la izquierda', () => {
    const rows = [
      item({
        id: 'queso',
        nombre: 'Queso fresco',
        plu: '00023',
        texto_buscable: 'queso fresco sku-1 00023',
      }),
      item({
        id: 'otro',
        nombre: 'Otro producto',
        plu: '00101',
        texto_buscable: 'otro producto sku-2 00101 101',
      }),
    ];

    expect(buscarEnCatalogoPos(rows, '23').map((x) => x.id)).toEqual(['queso']);
    expect(rankPosCatalogoItem(rows[0]!, '23')).toBe(2);
    expect(rankPosCatalogoItem(rows[1]!, '101')).toBe(2);
  });

  it('no oculta productos distintos que comparten codigo interno y unidad', () => {
    const rows = [
      item({
        id: 'bombilla',
        codigo: '9',
        nombre: 'bombilla de plastico',
        proveedor: { id: 'prov-1', nombre: 'BASE DATOS' },
      }),
      item({
        id: 'hilo',
        codigo: '9',
        nombre: 'hilo de barrilete naranja',
        proveedor: { id: 'prov-1', nombre: 'BASE DATOS' },
      }),
      item({
        id: 'keterolac',
        codigo: '9',
        codigo_barras: '12345678',
        nombre: 'Keterolac',
        proveedor: { id: 'prov-1', nombre: 'BASE DATOS' },
      }),
    ];

    expect(buscarEnCatalogoPos(rows, '9', { proveedorId: 'prov-1' }).map((x) => x.id)).toEqual([
      'bombilla',
      'hilo',
      'keterolac',
    ]);
    expect(buscarEnCatalogoPos(rows, 'keter', { proveedorId: 'prov-1' })[0]?.id).toBe(
      'keterolac',
    );
  });
});
