import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CadenaDeOrden } from '@/components/facturacion/cadena-de-orden';

function mockFetch(payload: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => payload,
  } as unknown as Response);
}

describe('CadenaDeOrden', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // noop
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('no renderiza si no hay numeroOrden', () => {
    const { container } = render(
      <CadenaDeOrden numeroOrden={null} documentoActualId="a" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('no renderiza si la cadena tiene un solo documento', async () => {
    globalThis.fetch = mockFetch({
      numero_orden: 10,
      documentos: [
        {
          id: 'doc-a',
          tipo: 'factura_b',
          numero: 1,
          numero_formateado: '0001-00000001',
          fecha: '2026-04-20',
          estado: 'emitido',
          total: 1000,
          url_detalle: '/facturacion/doc-a',
        },
      ],
    });

    const { container } = render(
      <CadenaDeOrden numeroOrden={10} documentoActualId="doc-a" />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('cadena-orden-loading')).not.toBeInTheDocument();
    });
    expect(container.querySelector('[data-testid="cadena-orden"]')).toBeNull();
  });

  it('renderiza cadena completa con documento actual marcado', async () => {
    globalThis.fetch = mockFetch({
      numero_orden: 1284,
      documentos: [
        {
          id: 'pres-1',
          tipo: 'presupuesto',
          numero: 45,
          numero_formateado: '0001-00000045',
          fecha: '2026-04-15',
          estado: 'emitido',
          total: 18500,
          url_detalle: '/presupuestos/pres-1',
        },
        {
          id: 'ped-1',
          tipo: 'pedido',
          numero: null,
          numero_formateado: 'PED-ABCDEF12',
          fecha: '2026-04-16',
          estado: 'entregado',
          total: 18500,
          url_detalle: '/pedidos/ped-1',
        },
        {
          id: 'fac-1',
          tipo: 'factura_b',
          numero: 234,
          numero_formateado: '0001-00000234',
          fecha: '2026-04-20',
          estado: 'emitido',
          total: 18500,
          url_detalle: '/facturacion/fac-1',
        },
      ],
    });

    render(<CadenaDeOrden numeroOrden={1284} documentoActualId="fac-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('cadena-orden')).toBeInTheDocument();
    });

    expect(screen.getByText(/Orden #1284/i)).toBeInTheDocument();

    const actual = screen.getByTestId('cadena-orden-actual');
    expect(actual.textContent ?? '').toContain('Factura B');
    expect(actual.textContent ?? '').toContain('← estás acá');

    const linkPresupuesto = screen.getByRole('link', { name: /Presupuesto/i });
    expect(linkPresupuesto).toHaveAttribute('href', '/presupuestos/pres-1');

    const linkPedido = screen.getByRole('link', { name: /Pedido/i });
    expect(linkPedido).toHaveAttribute('href', '/pedidos/ped-1');
  });

  it('no rompe la vista si falla el fetch', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom'));

    const { container } = render(
      <CadenaDeOrden numeroOrden={10} documentoActualId="a" />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('cadena-orden-loading')).not.toBeInTheDocument();
    });
    expect(container.querySelector('[data-testid="cadena-orden"]')).toBeNull();
  });
});
