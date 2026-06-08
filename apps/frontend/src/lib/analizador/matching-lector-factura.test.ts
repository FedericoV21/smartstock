import { describe, expect, it } from 'vitest';

import { matchearItemsPrevia } from './matching';

describe('matchearItemsPrevia para lector de facturas', () => {
  const ctx = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    allowIa: false,
    origenLog: 'lector_factura' as const,
    codigoDuplicadoEstrategia: 'elegir_primero_por_id' as const,
  };

  it('matchea por codigo exacto antes que por nombre', async () => {
    const result = await matchearItemsPrevia(
      {} as any,
      [{ id: 'fact-0', codigo_proveedor: 'ABC-1', nombre_raw: 'Otro nombre' }],
      [
        { id: 'prod-2', codigo: 'ZZZ', nombre: 'Otro nombre' },
        { id: 'prod-1', codigo: 'ABC-1', nombre: 'Producto correcto' },
      ],
      ctx,
    );

    expect(result.porItemId.get('fact-0')).toMatchObject({
      producto_id: 'prod-1',
      confidence: 1,
      metodo: 'codigo_exacto',
    });
  });

  it('tolera codigos con guiones y espacios distintos', async () => {
    const result = await matchearItemsPrevia(
      {} as any,
      [{ id: 'fact-0', codigo_proveedor: 'MAR 101', nombre_raw: 'Producto' }],
      [{ id: 'prod-1', codigo: 'MAR-101', nombre: 'Producto' }],
      ctx,
    );

    expect(result.porItemId.get('fact-0')?.producto_id).toBe('prod-1');
    expect(result.porItemId.get('fact-0')?.metodo).toBe('codigo_exacto');
  });

  it('elige deterministicamente el menor id si hay codigo duplicado', async () => {
    const result = await matchearItemsPrevia(
      {} as any,
      [{ id: 'fact-0', codigo_proveedor: 'DUP', nombre_raw: 'Producto' }],
      [
        { id: 'b-prod', codigo: 'DUP', nombre: 'Producto B' },
        { id: 'a-prod', codigo: 'DUP', nombre: 'Producto A' },
      ],
      ctx,
    );

    expect(result.porItemId.get('fact-0')).toMatchObject({
      producto_id: 'a-prod',
      metodo: 'codigo_exacto',
    });
  });

  it('marca sin_match cuando codigo y nombre no alcanzan', async () => {
    const result = await matchearItemsPrevia(
      {} as any,
      [{ id: 'fact-0', codigo_proveedor: 'NOPE', nombre_raw: 'Linea desconocida' }],
      [{ id: 'prod-1', codigo: 'ABC', nombre: 'Producto catalogo' }],
      ctx,
    );

    expect(result.porItemId.get('fact-0')).toMatchObject({
      producto_id: null,
      confidence: 0,
      metodo: 'sin_match',
    });
  });
});
