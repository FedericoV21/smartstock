import { describe, expect, it } from 'vitest';

import {
  claveNombreCategoria,
  listarCategoriasUnificadasTenant,
} from '@/lib/categorias/tenant-scope';

describe('categorias tenant-scope', () => {
  it('normaliza nombres de categoría', () => {
    expect(claveNombreCategoria('  Carnes  ')).toBe('carnes');
    expect(claveNombreCategoria('Fiambre')).toBe('fiambre');
  });

  it('deduplica categorías por nombre entre sucursales', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: () => ({
                order: async () => ({
                  data: [
                    {
                      id: 'cat-thian-carnes',
                      nombre: 'Carnes',
                      descripcion: null,
                      activa: true,
                      sucursal_id: 'suc-thian',
                    },
                    {
                      id: 'cat-bonita-carnes',
                      nombre: 'Carnes',
                      descripcion: null,
                      activa: true,
                      sucursal_id: 'suc-bonita',
                    },
                    {
                      id: 'cat-thian-fiambre',
                      nombre: 'Fiambre',
                      descripcion: null,
                      activa: true,
                      sucursal_id: 'suc-thian',
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    };

    const unificadas = await listarCategoriasUnificadasTenant(
      supabase as never,
      'tenant-1',
      ['suc-thian', 'suc-bonita'],
      'suc-thian',
    );

    expect(unificadas).toHaveLength(2);
    expect(unificadas.every((c) => c.activa === true)).toBe(true);
    expect(unificadas.find((c) => c.nombre === 'Carnes')?.id).toBe('cat-thian-carnes');
    expect(unificadas.find((c) => c.nombre === 'Fiambre')?.id).toBe('cat-thian-fiambre');
  });
});
