import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BusquedaCatalogoProductos } from '@/components/productos/busqueda-catalogo-productos';

function okJson(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

function setupFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/categorias')) return okJson({ categorias: [] });
    if (url.startsWith('/api/proveedores')) return okJson({ proveedores: [] });
    if (url.startsWith('/api/productos')) {
      return okJson({
        productos: [
          {
            id: 'prod-1',
            codigo: 'ANT',
            nombre: 'Producto anterior',
            precio_venta: 100,
            precio_costo: 50,
            stock_actual: 8,
          },
        ],
      });
    }
    throw new Error(`Fetch inesperado: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('BusquedaCatalogoProductos', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('no agrega el primer resultado con Enter cuando la seleccion debe ser explicita', async () => {
    const fetchMock = setupFetch();
    const onElegir = vi.fn();

    render(
      <BusquedaCatalogoProductos
        onElegir={onElegir}
        agregarPrimeroConEnter={false}
      />,
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).startsWith('/api/productos?')),
      ).toBe(true);
    });

    const input = screen.getByPlaceholderText(/Buscar:/i);
    fireEvent.change(input, { target: { value: '7791234567890' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onElegir).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('q=7791234567890')),
    ).toBe(true);
  });
});
