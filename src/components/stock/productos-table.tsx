'use client';

import Link from 'next/link';

import { formatCurrency } from '@/lib/utils/formatters';

export type ProductoTabla = {
  id: string;
  codigo: string;
  nombre: string;
  stock_actual: number;
  stock_minimo: number;
  precio_costo: number;
  precio_venta: number;
  unidad: string;
  categoria: { id: string; nombre: string } | null;
  proveedor: { id: string; nombre: string } | null;
  fecha_vencimiento?: string | null;
  comprometido?: number;
  disponible?: number;
  codigo_barras?: string | null;
  es_pesable?: boolean;
  rubro?: string | null;
  subrubro?: string | null;
};

interface Props {
  productos: ProductoTabla[];
  selectable?: boolean;
  selected?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
}

export function ProductosTable({ productos, selectable, selected, onSelectionChange }: Props) {
  const allIds = productos.map((p) => p.id);
  const allSelected = selectable && selected && allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggleAll() {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(allIds));
    }
  }

  function toggleOne(id: string) {
    if (!onSelectionChange || !selected) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-brand-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {selectable && (
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={!!allSelected}
                  onChange={toggleAll}
                  className="size-4 rounded border-input"
                />
              </th>
            )}
            <th className="px-4 py-3 font-medium">Código</th>
            <th className="px-4 py-3 font-medium">Producto</th>
            <th className="px-4 py-3 font-medium">Categoría</th>
            <th className="hidden px-4 py-3 font-medium lg:table-cell">Rubro</th>
            <th className="px-4 py-3 text-right font-medium">Stock</th>
            <th className="px-4 py-3 text-right font-medium">Disponible</th>
            <th className="px-4 py-3 text-right font-medium">Costo</th>
            <th className="px-4 py-3 text-right font-medium">Venta</th>
            <th className="px-4 py-3 text-right font-medium">Margen</th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => {
            const margen =
              p.precio_costo > 0
                ? (((p.precio_venta - p.precio_costo) / p.precio_costo) * 100).toFixed(1)
                : '—';
            const stockBajo = p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo;
            const disp = p.disponible ?? p.stock_actual;

            return (
              <tr key={p.id} className="border-b last:border-0 hover:bg-muted/50">
                {selectable && (
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected?.has(p.id) ?? false}
                      onChange={() => toggleOne(p.id)}
                      className="size-4 rounded border-input"
                    />
                  </td>
                )}
                <td className="px-4 py-3 font-mono text-xs">{p.codigo}</td>
                <td className="px-4 py-3">
                  <Link href={`/productos/${p.id}`} className="font-medium hover:underline">
                    {p.nombre}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {p.categoria?.nombre ?? '—'}
                </td>
                <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                  {p.rubro ?? '—'}
                  {p.subrubro ? <span className="text-xs"> / {p.subrubro}</span> : null}
                </td>
                <td
                  className={`px-4 py-3 text-right font-mono ${stockBajo ? 'font-semibold text-amber-600' : ''}`}
                >
                  {p.stock_actual}
                  {p.unidad !== 'unidad' ? ` ${p.unidad}` : ''}
                </td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground">{disp}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(p.precio_costo)}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(p.precio_venta)}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{margen}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
