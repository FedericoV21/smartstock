import { cruzarPorProductoId, buildFilaComparativa } from './comparar-listas.util';
import type { ItemConProveedor } from './comparar-listas.util';

describe('comparar-listas.util', () => {
  it('cruza items con mismo producto_id en listas distintas', () => {
    const itemsPorLista = new Map<string, ItemConProveedor[]>([
      [
        'lista-a',
        [
          {
            lista_id: 'lista-a',
            proveedor_id: 'p1',
            proveedor_nombre: 'Prov A',
            item_id: 'i1',
            nombre_raw: 'Aceite',
            nombre_normalizado: null,
            codigo_proveedor: null,
            precio_lista: 100,
            producto_id: 'prod-1',
          },
        ],
      ],
      [
        'lista-b',
        [
          {
            lista_id: 'lista-b',
            proveedor_id: 'p2',
            proveedor_nombre: 'Prov B',
            item_id: 'i2',
            nombre_raw: 'Aceite 1L',
            nombre_normalizado: null,
            codigo_proveedor: null,
            precio_lista: 90,
            producto_id: 'prod-1',
          },
        ],
      ],
    ]);

    const { grupos, sinCruzar } = cruzarPorProductoId(itemsPorLista);
    expect(grupos.size).toBe(1);
    expect(grupos.get('prod-1')).toHaveLength(2);
    expect(sinCruzar).toHaveLength(0);

    const fila = buildFilaComparativa('Aceite', grupos.get('prod-1')!, 'prod-1');
    expect(fila.mejor_precio).toBe(90);
    expect(fila.ahorro_vs_peor).toBe(10);
  });
});
