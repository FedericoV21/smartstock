'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { BarcodeInput, type BarcodeInputRef } from '@/components/pos/barcode-input';
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

const IDLE_MS = 1000;
const MIN_QUERY_LENGTH = 2;

/** Cadenas solo numéricas largas: probable EAN/código de barras; se espera Enter, no búsqueda por pausa. */
function looksLikeLongNumericBarcode(trimmed: string): boolean {
  return trimmed.length >= 8 && /^[0-9]+$/.test(trimmed);
}

type PosScanInlineSearchProps = {
  onScan: (codigo: string) => void;
  onSelectProduct: (producto: ProductSearchResult) => void;
  disabled?: boolean;
  pauseRefocus?: boolean;
  placeholder?: string;
};

export type PosScanInlineSearchRef = {
  focus: () => void;
  blur: () => void;
  clear: () => void;
  /** Búsqueda inmediata (p. ej. texto con espacio/acento o código no encontrado). */
  searchWithQuery: (q: string) => void;
};

export const PosScanInlineSearch = forwardRef<PosScanInlineSearchRef, PosScanInlineSearchProps>(
  function PosScanInlineSearch(
    { onScan, onSelectProduct, disabled, pauseRefocus, placeholder },
    ref,
  ) {
    const innerRef = useRef<BarcodeInputRef>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const fetchSeq = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    const [liveBuffer, setLiveBuffer] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [results, setResults] = useState<ProductSearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [highlight, setHighlight] = useState(0);
    /** Query mostrada cuando el input ya se vació (p. ej. tras Enter). */
    const [pinnedLabel, setPinnedLabel] = useState<string | null>(null);

    const runFetch = useCallback(async (raw: string) => {
      const seq = ++fetchSeq.current;
      const q = raw.replace(/\s+/g, ' ').trim();
      if (q.length < MIN_QUERY_LENGTH) {
        if (seq === fetchSeq.current) {
          setResults([]);
          setDropdownOpen(false);
          setError('');
          setLoading(false);
        }
        return;
      }

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      if (seq === fetchSeq.current) {
        setDropdownOpen(true);
        setLoading(true);
        setError('');
      }

      try {
        const res = await fetch(`/api/pos/buscar-productos?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        if (seq !== fetchSeq.current) return;
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setError(err.error ?? 'Error al buscar productos');
          setResults([]);
          return;
        }
        const data = await res.json();
        if (seq !== fetchSeq.current) return;
        const list = (data.productos ?? []) as ProductSearchResult[];
        setResults(list);
        setHighlight(0);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        if (seq !== fetchSeq.current) return;
        setError('Error de conexión');
        setResults([]);
      } finally {
        if (seq === fetchSeq.current) setLoading(false);
      }
    }, []);

    const searchWithQuery = useCallback(
      (q: string) => {
        const t = q.trim();
        setPinnedLabel(t.length >= MIN_QUERY_LENGTH ? t : null);
        void runFetch(q);
      },
      [runFetch],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => innerRef.current?.focus(),
        blur: () => innerRef.current?.blur(),
        clear: () => {
          fetchSeq.current += 1;
          abortRef.current?.abort();
          innerRef.current?.clear();
          setLiveBuffer('');
          setPinnedLabel(null);
          setDropdownOpen(false);
          setResults([]);
          setError('');
          setLoading(false);
        },
        searchWithQuery,
      }),
      [searchWithQuery],
    );

    // Pausa ~1 s sin tipear → búsqueda automática por nombre/código (no solo números largos tipo EAN).
    useEffect(() => {
      const t = liveBuffer.trim();
      if (t.length < MIN_QUERY_LENGTH) {
        setDropdownOpen(false);
        setResults([]);
        setError('');
        setLoading(false);
        return;
      }
      if (looksLikeLongNumericBarcode(t)) {
        setDropdownOpen(false);
        return;
      }

      const timer = setTimeout(() => {
        setPinnedLabel(null);
        void runFetch(liveBuffer);
      }, IDLE_MS);

      return () => clearTimeout(timer);
    }, [liveBuffer, runFetch]);

    useLayoutEffect(() => {
      const el = rowRefs.current[highlight];
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [highlight, results]);

    useEffect(() => {
      function onDocMouseDown(e: MouseEvent) {
        if (!wrapRef.current?.contains(e.target as Node)) {
          setDropdownOpen(false);
        }
      }
      document.addEventListener('mousedown', onDocMouseDown);
      return () => document.removeEventListener('mousedown', onDocMouseDown);
    }, []);

    const pickProduct = useCallback(
      (p: ProductSearchResult) => {
        onSelectProduct(p);
        innerRef.current?.clear();
        setLiveBuffer('');
        setPinnedLabel(null);
        setDropdownOpen(false);
        setResults([]);
        setError('');
      },
      [onSelectProduct],
    );

    function handleKeyDownCapture(e: React.KeyboardEvent) {
      if (!dropdownOpen) return;

      if (loading) {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Escape') setDropdownOpen(false);
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDropdownOpen(false);
        return;
      }

      const canPick = results.length > 0 && !error;

      if (e.key === 'ArrowDown') {
        if (!canPick) return;
        e.preventDefault();
        e.stopPropagation();
        setHighlight((h) => Math.min(h + 1, results.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        if (!canPick) return;
        e.preventDefault();
        e.stopPropagation();
        setHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (e.key === 'Enter' && canPick) {
        const p = results[highlight];
        if (p) {
          e.preventDefault();
          e.stopPropagation();
          pickProduct(p);
        }
      }
    }

    const displayQuery = pinnedLabel ?? liveBuffer.trim();

    const showPanel =
      dropdownOpen &&
      (loading ||
        error ||
        results.length > 0 ||
        displayQuery.length >= MIN_QUERY_LENGTH);

    return (
      <div ref={wrapRef} className="relative flex min-h-0 w-full flex-col">
        <div onKeyDownCapture={handleKeyDownCapture}>
          <BarcodeInput
            ref={innerRef}
            onScan={onScan}
            onBufferChange={(value) => {
              setLiveBuffer(value);
              setPinnedLabel(null);
            }}
            disabled={disabled}
            pauseRefocus={pauseRefocus}
            placeholder={placeholder}
            className="focus-visible:border-[color:var(--brand-primary)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)]/35 focus-visible:ring-offset-2"
          />
        </div>

        {showPanel && (
          <div
            className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[min(42vh,22rem)] overflow-y-auto overflow-x-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
            role="listbox"
            aria-label="Resultados de búsqueda"
          >
            {displayQuery.length >= MIN_QUERY_LENGTH && (
              <div className="sticky top-0 z-[1] border-b bg-popover px-3 py-1.5 text-xs text-muted-foreground">
                {loading ? 'Buscando' : 'Coincidencias'} «{displayQuery}»
              </div>
            )}
            {error && !loading && (
              <p className="px-3 py-2 text-center text-sm text-destructive">{error}</p>
            )}
            {!loading && !error && results.length === 0 && displayQuery.length >= MIN_QUERY_LENGTH && (
              <p className="px-3 py-2 text-center text-sm text-muted-foreground">
                Sin resultados.
              </p>
            )}
            {!loading && !error &&
              results.map((p, i) => {
                const sinStock = p.stock_actual <= 0;
                return (
                  <button
                    key={p.id}
                    ref={(node) => {
                      rowRefs.current[i] = node;
                    }}
                    type="button"
                    role="option"
                    aria-selected={i === highlight}
                    onClick={() => pickProduct(p)}
                    onMouseEnter={() => setHighlight(i)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left text-sm last:border-0',
                      i === highlight
                        ? 'border-l-2 border-l-[color:var(--brand-primary)] bg-[color:var(--brand-tint)]'
                        : 'hover:bg-muted/60',
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium leading-snug">{p.nombre}</span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {formatCurrency(p.precio_venta)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span className="font-mono">{p.codigo}</span>
                      {p.es_pesable && (
                        <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                          Pesable
                        </span>
                      )}
                      <span
                        className={cn('ml-auto tabular-nums', sinStock && 'text-destructive')}
                      >
                        Stock: {p.stock_actual}
                        {p.unidad ? ` ${p.unidad}` : ''}
                      </span>
                    </div>
                  </button>
                );
              })}
          </div>
        )}
      </div>
    );
  },
);
