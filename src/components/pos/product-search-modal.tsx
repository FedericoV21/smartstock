'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/formatters';

export type ProductSearchResult = {
  id: string;
  codigo: string;
  codigo_barras?: string | null;
  nombre: string;
  precio_venta: number;
  stock_actual: number;
  es_pesable?: boolean;
  unidad?: string;
  iva_porcentaje?: number | null;
};

interface ProductSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (producto: ProductSearchResult) => void;
  /** Optional pre-filled search term, used when the modal is opened as a
   *  fallback from the barcode input. */
  initialQuery?: string;
}

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

export function ProductSearchModal({
  open,
  onClose,
  onSelect,
  initialQuery = '',
}: ProductSearchModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [highlight, setHighlight] = useState(0);

  // Reset state when opening/closing, and pre-fill from initialQuery
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setError('');
      setHighlight(0);
      return;
    }
    setQuery(initialQuery);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open, initialQuery]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError('');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/pos/buscar-productos?q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setError(err.error ?? 'Error al buscar productos');
          setResults([]);
          return;
        }
        const data = await res.json();
        const list = (data.productos ?? []) as ProductSearchResult[];
        setResults(list);
        setHighlight(0);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError('Error de conexión');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [query, open]);

  const handleSelect = useCallback(
    (producto: ProductSearchResult) => {
      onSelect(producto);
      onClose();
    },
    [onSelect, onClose],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const producto = results[highlight];
      if (producto) handleSelect(producto);
    }
  }

  if (!open) return null;

  const showEmpty =
    query.trim().length >= MIN_QUERY_LENGTH && !loading && !error && results.length === 0;
  const showHint = query.trim().length < MIN_QUERY_LENGTH;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24">
      <div className="w-[32rem] max-w-[90vw] rounded-xl border bg-background shadow-xl overflow-hidden">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">Buscar producto</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscá por nombre, código o SKU…"
            className="h-11 text-base"
            autoFocus
          />
        </div>

        <div className="max-h-96 overflow-y-auto">
          {showHint && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Escribí al menos {MIN_QUERY_LENGTH} caracteres para buscar.
            </p>
          )}
          {loading && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Buscando…
            </p>
          )}
          {error && (
            <p className="px-4 py-6 text-center text-sm text-destructive">{error}</p>
          )}
          {showEmpty && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No se encontraron productos para &quot;{query.trim()}&quot;.
            </p>
          )}
          {!loading && !error && results.length > 0 && (
            <ul>
              {results.map((p, i) => {
                const sinStock = p.stock_actual <= 0;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(p)}
                      onMouseEnter={() => setHighlight(i)}
                      className={cn(
                        'w-full text-left px-4 py-2.5 border-b last:border-0 transition-colors',
                        i === highlight ? 'bg-muted' : 'hover:bg-muted/50',
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium truncate">{p.nombre}</span>
                        <span className="text-sm font-semibold tabular-nums shrink-0">
                          {formatCurrency(p.precio_venta)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{p.codigo}</span>
                        {p.es_pesable && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            Pesable
                          </span>
                        )}
                        <span
                          className={cn(
                            'ml-auto tabular-nums',
                            sinStock && 'text-destructive',
                          )}
                        >
                          Stock: {p.stock_actual}
                          {p.unidad ? ` ${p.unidad}` : ''}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <span>
            <kbd className="rounded border bg-background px-1 py-0.5 font-mono">↑↓</kbd>{' '}
            navegar ·{' '}
            <kbd className="rounded border bg-background px-1 py-0.5 font-mono">Enter</kbd>{' '}
            agregar ·{' '}
            <kbd className="rounded border bg-background px-1 py-0.5 font-mono">Esc</kbd>{' '}
            cerrar
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
